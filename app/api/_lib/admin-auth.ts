import { env } from "cloudflare:workers";
import { createDefaultPortfolioDocument } from "../../portfolio/default-document";
import { PROGRAM_VERSION } from "../../lib/program-version";
import { getInitialAdminCode } from "./app-secret";
import { getPortfolioDb } from "./portfolio-store";

const CREDENTIAL_ID = "default";
const OWNER_ID = "default";
const OWNER_HANDLE = "site-owner";
const COOKIE_NAME = "__Host-portfolio_admin_session";
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;
const LOGIN_NETWORK_BUCKET_COUNT = 4_096;
const AUTH_VERSION = 2;
// Keep password verification within the Workers Free CPU envelope while still
// making the stored verifier substantially more expensive than a plain digest.
const PBKDF2_ITERATIONS = 50_000;

type CredentialRow = {
  password_hash: string;
  password_salt: string;
  recovery_hash: string;
  recovery_salt: string;
  auth_version: number;
  confirmed_program_version: string | null;
};

type LoginThrottleRow = {
  failed_attempts: number;
  locked_until: string | null;
};

type SessionRecord = {
  token: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  userAgentHash: string | null;
};

export type LocalAdminSession = {
  kind: "password";
  user: typeof OWNER_HANDLE;
};

export type LocalCredentialState = {
  exists: boolean;
  authVersion: number | null;
  confirmedProgramVersion: string | null;
  currentProgramVersion: string;
  upgradeRequired: boolean;
};

export function isSitesAuthPlatform() {
  return String(Reflect.get(env, "AUTH_PLATFORM")) === "sites";
}

export function programResetRequired(confirmedProgramVersion: string | null, currentProgramVersion = PROGRAM_VERSION) {
  return confirmedProgramVersion !== currentProgramVersion;
}

export async function getLocalCredentialState(): Promise<LocalCredentialState> {
  await ensureAuthStateTable();
  await ensureAdminLoginThrottleTable();
  const row = await getPortfolioDb()
    .prepare(`SELECT
      CASE WHEN state.auth_version IS NOT NULL THEN state.auth_version
        WHEN credentials.password_hash LIKE 'p2.%' THEN 2 ELSE 1 END AS auth_version,
      state.confirmed_program_version
      FROM admin_credentials credentials
      LEFT JOIN admin_auth_state state ON state.id = credentials.id
      WHERE credentials.id = ? LIMIT 1`)
    .bind(CREDENTIAL_ID)
    .first<{ auth_version: number; confirmed_program_version: string | null }>();
  return {
    exists: Boolean(row),
    authVersion: row ? Number(row.auth_version ?? 1) : null,
    confirmedProgramVersion: row?.confirmed_program_version ?? null,
    currentProgramVersion: PROGRAM_VERSION,
    upgradeRequired: Boolean(row && programResetRequired(row.confirmed_program_version ?? null)),
  };
}

export async function localCredentialsExist() {
  return (await getLocalCredentialState()).exists;
}

export async function createLocalAdministrator(input: {
  initialCode: string;
  password: string;
  request: Request;
}) {
  const password = normalizePassword(input.password);
  const configuredCode = getInitialAdminCode();
  if (!await constantTimeEqual(input.initialCode.trim(), configuredCode)) {
    throw new AuthError("一次性部署口令不正确", 401);
  }
  if (await constantTimeEqual(password, configuredCode)) {
    throw new AuthError("管理员密码不能与一次性部署口令相同", 400);
  }
  if (await localCredentialsExist()) {
    throw new AuthError("管理员已经初始化，请直接登录", 409);
  }

  const passwordSalt = randomToken(18);
  const recoverySalt = randomToken(18);
  const recoveryCode = createRecoveryCode();
  const [passwordHash, recoveryHash, session] = await Promise.all([
    credentialHashV2("password", password, passwordSalt),
    credentialHashV2("recovery", normalizeRecoveryCode(recoveryCode), recoverySalt),
    createSessionRecord(input.request),
  ]);
  const now = new Date().toISOString();
  const draft = JSON.stringify(createDefaultPortfolioDocument());
  const db = getPortfolioDb();
  try {
    await db.batch([
      db.prepare(`INSERT INTO admin_credentials (
        id, password_hash, password_salt, recovery_hash, recovery_salt,
        failed_attempts, initialized_at,
        password_changed_at, recovery_code_created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`).bind(
        CREDENTIAL_ID, passwordHash, passwordSalt, recoveryHash, recoverySalt,
        now, now, now, now,
      ),
      db.prepare(`INSERT INTO admin_auth_state (id, auth_version, confirmed_program_version, updated_at)
        VALUES (?, ?, ?, ?)`)
        .bind(CREDENTIAL_ID, AUTH_VERSION, PROGRAM_VERSION, now),
      db.prepare("INSERT OR IGNORE INTO site_ownership (id, owner_email, auth_provider, bound_at, onboarding_email_sent_at, onboarding_email_id) VALUES (?, ?, 'password', ?, ?, 'local-password')")
        .bind(OWNER_ID, OWNER_HANDLE, now, now),
      db.prepare("INSERT OR IGNORE INTO portfolio_documents (id, owner_email, revision, draft_json, updated_at) VALUES (?, ?, 1, ?, ?)")
        .bind(OWNER_ID, OWNER_HANDLE, draft, now),
      db.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at, user_agent_hash) VALUES (?, ?, ?, ?)")
        .bind(session.tokenHash, session.createdAt, session.expiresAt, session.userAgentHash),
      db.prepare(`DELETE FROM admin_login_throttle WHERE EXISTS (
        SELECT 1 FROM admin_credentials WHERE id = ? AND password_hash = ? AND password_salt = ?
      )`).bind(CREDENTIAL_ID, passwordHash, passwordSalt),
    ]);
  } catch (error) {
    if (isConstraintError(error)) throw new AuthError("管理员已经初始化，请直接登录", 409);
    throw error;
  }
  return { recoveryCode, sessionCookie: sessionCookie(session.token) };
}

export async function loginWithPassword(password: string, request: Request) {
  await ensureAdminLoginThrottleTable();
  const row = await readCredentials();
  if (!row) throw new AuthError("网站尚未完成管理员初始化", 428);
  if (programResetRequired(row.confirmed_program_version)) {
    throw new AuthError("网站已经升级，请使用当前最新的系统恢复码确认升级并重设一次密码", 428);
  }
  const bucketKey = await loginNetworkBucketKey(request, row.password_hash);
  enforceLoginThrottle(await readLoginThrottle(bucketKey));
  const normalizedPassword = row.auth_version >= AUTH_VERSION ? normalizePassword(password) : password;
  const valid = row.auth_version >= AUTH_VERSION
    ? await verifyCredentialV2("password", normalizedPassword, row.password_salt, row.password_hash)
    : await verifyLegacyCredential("password", normalizedPassword, row.password_salt, row.password_hash);
  if (!valid) {
    const throttle = await recordPasswordFailure(bucketKey, row.password_hash, row.password_salt);
    enforceLoginThrottle(throttle);
    throw new AuthError("管理员密码不正确", 401);
  }
  const session = await createSessionRecord(request);
  const now = new Date().toISOString();
  const db = getPortfolioDb();
  const results = await db.batch([
    db.prepare(`UPDATE admin_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = ?
      WHERE id = ? AND password_hash = ? AND password_salt = ?`)
      .bind(now, CREDENTIAL_ID, row.password_hash, row.password_salt),
    db.prepare(`INSERT INTO admin_sessions (token_hash, created_at, expires_at, user_agent_hash)
      SELECT ?, ?, ?, ? FROM admin_credentials
      WHERE id = ? AND password_hash = ? AND password_salt = ?`)
      .bind(
        session.tokenHash, session.createdAt, session.expiresAt, session.userAgentHash,
        CREDENTIAL_ID, row.password_hash, row.password_salt,
      ),
    db.prepare(`DELETE FROM admin_login_throttle WHERE bucket_key = ? AND EXISTS (
      SELECT 1 FROM admin_credentials WHERE id = ? AND password_hash = ? AND password_salt = ?
    )`).bind(bucketKey, CREDENTIAL_ID, row.password_hash, row.password_salt),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    throw new AuthError("管理员密码不正确", 401);
  }
  return sessionCookie(session.token);
}

export async function resetPasswordWithRecovery(input: {
  recoveryCode: string;
  password: string;
  request: Request;
}) {
  await ensureAdminLoginThrottleTable();
  const password = normalizePassword(input.password);
  const row = await readCredentials();
  if (!row) throw new AuthError("网站尚未完成管理员初始化", 428);
  const recoveryValue = normalizeRecoveryCode(input.recoveryCode);
  const valid = row.auth_version >= AUTH_VERSION
    ? await verifyCredentialV2("recovery", recoveryValue, row.recovery_salt, row.recovery_hash)
    : await verifyLegacyCredential("recovery", recoveryValue, row.recovery_salt, row.recovery_hash);
  if (!valid) {
    throw new AuthError("系统恢复码不正确", 401);
  }
  if (row.auth_version < AUTH_VERSION && await constantTimeEqual(password, getInitialAdminCode())) {
    throw new AuthError("新密码不能与一次性部署口令相同", 400);
  }

  const passwordSalt = randomToken(18);
  const recoverySalt = randomToken(18);
  const recoveryCode = createRecoveryCode();
  const [passwordHash, recoveryHash, session] = await Promise.all([
    credentialHashV2("password", password, passwordSalt),
    credentialHashV2("recovery", normalizeRecoveryCode(recoveryCode), recoverySalt),
    createSessionRecord(input.request),
  ]);
  const now = new Date().toISOString();
  const db = getPortfolioDb();
  const results = await db.batch([
    db.prepare(`UPDATE admin_credentials SET
      password_hash = ?, password_salt = ?, recovery_hash = ?, recovery_salt = ?,
      failed_attempts = 0, locked_until = NULL, password_changed_at = ?,
      recovery_code_created_at = ?, updated_at = ?
      WHERE id = ? AND recovery_hash = ? AND recovery_salt = ?`)
      .bind(
        passwordHash, passwordSalt, recoveryHash, recoverySalt, now, now, now,
        CREDENTIAL_ID, row.recovery_hash, row.recovery_salt,
      ),
    db.prepare(`INSERT INTO admin_auth_state (id, auth_version, confirmed_program_version, updated_at)
      SELECT ?, ?, ?, ? FROM admin_credentials
      WHERE id = ? AND password_hash = ? AND password_salt = ?
      ON CONFLICT(id) DO UPDATE SET auth_version = excluded.auth_version,
        confirmed_program_version = excluded.confirmed_program_version,
        updated_at = excluded.updated_at`)
      .bind(CREDENTIAL_ID, AUTH_VERSION, PROGRAM_VERSION, now, CREDENTIAL_ID, passwordHash, passwordSalt),
    db.prepare(`DELETE FROM admin_sessions WHERE EXISTS (
      SELECT 1 FROM admin_credentials WHERE id = ? AND password_hash = ? AND password_salt = ?
    )`).bind(CREDENTIAL_ID, passwordHash, passwordSalt),
    db.prepare(`INSERT INTO admin_sessions (token_hash, created_at, expires_at, user_agent_hash)
      SELECT ?, ?, ?, ? FROM admin_credentials
      WHERE id = ? AND password_hash = ? AND password_salt = ?`)
      .bind(
        session.tokenHash, session.createdAt, session.expiresAt, session.userAgentHash,
        CREDENTIAL_ID, passwordHash, passwordSalt,
      ),
    db.prepare(`DELETE FROM admin_login_throttle WHERE EXISTS (
      SELECT 1 FROM admin_credentials WHERE id = ? AND password_hash = ? AND password_salt = ?
    )`).bind(CREDENTIAL_ID, passwordHash, passwordSalt),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    throw new AuthError("系统恢复码不正确", 401);
  }
  return { recoveryCode, sessionCookie: sessionCookie(session.token) };
}

export async function authorizeLocalAdmin(request: Request): Promise<LocalAdminSession | null> {
  const token = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (!token || !/^[A-Za-z0-9_-]{40,100}$/u.test(token)) return null;
  const credentials = await readCredentials();
  if (!credentials || programResetRequired(credentials.confirmed_program_version)) return null;
  const hashes = [await sessionHashV2(token)];
  if (credentials.auth_version < AUTH_VERSION) {
    try { hashes.push(await legacyProtectedHash("session", token, "v1")); }
    catch { /* The legacy deployment secret may no longer be available. */ }
  }
  for (const tokenHash of hashes) {
    const row = await getPortfolioDb()
      .prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ? LIMIT 1")
      .bind(tokenHash)
      .first<{ expires_at: string }>();
    if (!row) continue;
    if (Date.parse(row.expires_at) <= Date.now()) {
      await getPortfolioDb().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
      continue;
    }
    return { kind: "password", user: OWNER_HANDLE };
  }
  return null;
}

export async function logoutLocalAdmin(request: Request) {
  const token = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (token) {
    const hashes = [await sessionHashV2(token)];
    const credentials = await readCredentials();
    if (credentials && credentials.auth_version < AUTH_VERSION) {
      try { hashes.push(await legacyProtectedHash("session", token, "v1")); }
      catch { /* The legacy deployment secret may no longer be available. */ }
    }
    for (const tokenHash of hashes) {
      await getPortfolioDb().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
    }
  }
  return expiredSessionCookie();
}

export function sessionResponseHeaders(sessionCookie: string) {
  return { "Cache-Control": "no-store, max-age=0", "Set-Cookie": sessionCookie };
}

export function expiredSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function validatePassword(password: string) {
  normalizePassword(password);
}

export function normalizePassword(password: string) {
  const normalized = password.normalize("NFC");
  if (normalized.length < 10 || normalized.length > 128) {
    throw new AuthError("密码需要10至128个字符", 400);
  }
  if (/^\s|\s$/u.test(normalized)) {
    throw new AuthError("密码开头和结尾不能有空格", 400);
  }
  if (/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(normalized)) {
    throw new AuthError("密码中包含不可见字符，请重新输入", 400);
  }
  if (!/[A-Za-z\p{Script=Han}]/u.test(normalized) || !/\d/u.test(normalized)) {
    throw new AuthError("密码至少需要包含文字和数字", 400);
  }
  return normalized;
}

export class AuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function createSessionRecord(request: Request): Promise<SessionRecord> {
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000);
  const userAgent = request.headers.get("user-agent") ?? "";
  return {
    token,
    tokenHash: await sessionHashV2(token),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    userAgentHash: userAgent ? await digestText(`user-agent\n${userAgent}`) : null,
  };
}

function sessionCookie(token: string) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

async function readCredentials() {
  await ensureAuthStateTable();
  return getPortfolioDb()
    .prepare(`SELECT credentials.password_hash, credentials.password_salt,
      credentials.recovery_hash, credentials.recovery_salt,
      CASE WHEN state.auth_version IS NOT NULL THEN state.auth_version
        WHEN credentials.password_hash LIKE 'p2.%' THEN 2 ELSE 1 END AS auth_version,
      state.confirmed_program_version
      FROM admin_credentials credentials
      LEFT JOIN admin_auth_state state ON state.id = credentials.id
      WHERE credentials.id = ? LIMIT 1`)
    .bind(CREDENTIAL_ID)
    .first<CredentialRow>();
}

async function ensureAuthStateTable() {
  await getPortfolioDb().prepare(`CREATE TABLE IF NOT EXISTS admin_auth_state (
    id text PRIMARY KEY NOT NULL,
    auth_version integer DEFAULT 1 NOT NULL,
    confirmed_program_version text,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (id) REFERENCES admin_credentials(id) ON UPDATE no action ON DELETE cascade
  )`).run();
}

async function ensureAdminLoginThrottleTable() {
  const db = getPortfolioDb();
  await db.prepare(`CREATE TABLE IF NOT EXISTS admin_login_throttle (
    bucket_key text PRIMARY KEY NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until text,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS admin_login_throttle_locked_until_idx
    ON admin_login_throttle (locked_until)`).run();
}

function enforceLoginThrottle(row: LoginThrottleRow | null) {
  if (!row?.locked_until) return;
  const remaining = Math.ceil((Date.parse(row.locked_until) - Date.now()) / 1000);
  if (remaining > 0) throw new AuthError(`尝试次数过多，请${Math.ceil(remaining / 60)}分钟后再试`, 429);
}

async function readLoginThrottle(bucketKey: string) {
  return getPortfolioDb()
    .prepare("SELECT failed_attempts, locked_until FROM admin_login_throttle WHERE bucket_key = ? LIMIT 1")
    .bind(bucketKey)
    .first<LoginThrottleRow>();
}

async function recordPasswordFailure(bucketKey: string, expectedHash: string, expectedSalt: string) {
  const now = new Date();
  const nowIso = now.toISOString();
  const lockedUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();
  const result = await getPortfolioDb()
    .prepare(`INSERT INTO admin_login_throttle (bucket_key, failed_attempts, locked_until, updated_at)
      SELECT ?, 1, NULL, ? FROM admin_credentials
      WHERE id = ? AND password_hash = ? AND password_salt = ?
      ON CONFLICT(bucket_key) DO UPDATE SET
      failed_attempts = CASE
        WHEN admin_login_throttle.locked_until IS NOT NULL
          AND admin_login_throttle.locked_until > excluded.updated_at
          THEN admin_login_throttle.failed_attempts
        WHEN admin_login_throttle.failed_attempts + 1 >= ? THEN 0
        ELSE admin_login_throttle.failed_attempts + 1
      END,
      locked_until = CASE
        WHEN admin_login_throttle.locked_until IS NOT NULL
          AND admin_login_throttle.locked_until > excluded.updated_at
          THEN admin_login_throttle.locked_until
        WHEN admin_login_throttle.failed_attempts + 1 >= ? THEN ?
        ELSE NULL
      END,
      updated_at = excluded.updated_at
      WHERE EXISTS (
        SELECT 1 FROM admin_credentials
        WHERE id = ? AND password_hash = ? AND password_salt = ?
      )`)
    .bind(
      bucketKey, nowIso, CREDENTIAL_ID, expectedHash, expectedSalt,
      MAX_FAILURES, MAX_FAILURES, lockedUntil,
      CREDENTIAL_ID, expectedHash, expectedSalt,
    )
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) return null;
  return readLoginThrottle(bucketKey);
}

async function loginNetworkBucketKey(request: Request, passwordHash: string) {
  const suppliedNetwork = request.headers.get("cf-connecting-ip")?.trim().toLowerCase() ?? "";
  const network = suppliedNetwork ? suppliedNetwork.slice(0, 128) : "unknown";
  const material = new TextEncoder().encode(`admin-login-throttle\nv1\n${passwordHash}\n${network}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  const bucket = (((digest[0] ?? 0) << 8) | (digest[1] ?? 0)) & (LOGIN_NETWORK_BUCKET_COUNT - 1);
  return `b1-${bucket.toString(16).padStart(3, "0")}`;
}

async function credentialHashV2(purpose: "password" | "recovery", value: string, salt: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: new TextEncoder().encode(`student-portfolio\n${purpose}\n${salt}`),
  }, material, 256);
  return `p2.${PBKDF2_ITERATIONS}.${base64Url(new Uint8Array(bits))}`;
}

async function verifyCredentialV2(purpose: "password" | "recovery", value: string, salt: string, expected: string) {
  return constantTimeEqual(await credentialHashV2(purpose, value, salt), expected);
}

async function verifyLegacyCredential(purpose: "password" | "recovery", value: string, salt: string, expected: string) {
  return constantTimeEqual(await legacyProtectedHash(purpose, value, salt), expected);
}

async function legacyProtectedHash(purpose: string, value: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getInitialAdminCode()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v1\n${purpose}\n${salt}\n${value}`),
  );
  return base64Url(new Uint8Array(digest));
}

async function sessionHashV2(token: string) {
  return `s2.${await digestText(`session\n${token}`)}`;
}

async function digestText(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

async function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  type TimingSafeSubtle = SubtleCrypto & { timingSafeEqual?(left: ArrayBuffer, right: ArrayBuffer): boolean };
  const timingSafeEqual = (crypto.subtle as TimingSafeSubtle).timingSafeEqual;
  if (timingSafeEqual) return timingSafeEqual.call(crypto.subtle, leftHash, rightHash);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.min(leftBytes.length, rightBytes.length); index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function createRecoveryCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `REC-${body.match(/.{1,4}/gu)?.join("-") ?? body}`;
}

function normalizeRecoveryCode(value: string) {
  return value.trim().toUpperCase().replaceAll(/[^A-Z0-9]/gu, "");
}

function randomToken(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function isConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint|unique|primary key/iu.test(message);
}
