import { env } from "cloudflare:workers";
import { FIXED_INITIAL_ADMIN_CODE, PROGRAM_VERSION } from "../../program-version";
import { createDefaultPortfolioDocument } from "../../portfolio/default-document";
import { getInitialAdminCode, getPurposeSecret } from "./app-secret";
import { getPortfolioDb } from "./portfolio-store";

const CREDENTIAL_ID = "default";
const OWNER_ID = "default";
const OWNER_HANDLE = "site-owner";
const COOKIE_NAME = "__Host-portfolio_admin_session";
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;
const PBKDF2_ITERATIONS = 75_000;

type CredentialRow = {
  password_hash: string;
  password_salt: string;
  recovery_hash: string;
  recovery_salt: string;
  failed_attempts: number;
  locked_until: string | null;
  auth_scheme: "v1" | "v2";
  security_version: string;
};

type SessionMaterial = {
  token: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  userAgentHash: string | null;
  cookie: string;
};

export type LocalAdministratorState =
  | { state: "initial_setup" }
  | { state: "password_reset_required"; currentVersion: string }
  | { state: "ready"; currentVersion: string };

export type LocalAdminSession = {
  kind: "password";
  user: typeof OWNER_HANDLE;
};

export function isSitesAuthPlatform() {
  return String(Reflect.get(env, "AUTH_PLATFORM")) === "sites";
}

export async function localCredentialsExist() {
  const row = await getPortfolioDb()
    .prepare("SELECT id FROM admin_credentials WHERE id = ? LIMIT 1")
    .bind(CREDENTIAL_ID)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function getLocalAdministratorState(): Promise<LocalAdministratorState> {
  const row = await readCredentials();
  if (!row) return { state: "initial_setup" };
  if (requiresSecurityReset(row)) {
    return { state: "password_reset_required", currentVersion: PROGRAM_VERSION };
  }
  return { state: "ready", currentVersion: PROGRAM_VERSION };
}

export async function createLocalAdministrator(input: {
  initialCode: string;
  password: string;
  request: Request;
}) {
  validatePassword(input.password);
  if (await localCredentialsExist()) {
    throw new AuthError("管理员已经创建，请使用管理员密码登录", 409, "ADMIN_ALREADY_INITIALIZED");
  }

  const configuredCode = getInitialAdminCode();
  if (!await constantTimeEqual(configuredCode, FIXED_INITIAL_ADMIN_CODE)) {
    throw new AuthError(
      `Cloudflare 中的 INITIAL_ADMIN_CODE 必须设置为 ${FIXED_INITIAL_ADMIN_CODE}`,
      503,
      "INITIAL_CODE_CONFIGURATION_INVALID",
    );
  }
  if (!await constantTimeEqual(input.initialCode.trim(), configuredCode)) {
    throw new AuthError("一次性部署口令不正确", 401, "INITIAL_CODE_INVALID");
  }
  if (await constantTimeEqual(input.password, configuredCode)) {
    throw new AuthError("管理员密码不能与一次性部署口令相同", 400, "PASSWORD_MATCHES_INITIAL_CODE");
  }

  const passwordSalt = randomToken(18);
  const recoverySalt = randomToken(18);
  const recoveryCode = createRecoveryCode();
  const [passwordHash, recoveryHash, session] = await Promise.all([
    protectedHashV2("password", input.password, passwordSalt),
    protectedHashV2("recovery", normalizeRecoveryCode(recoveryCode), recoverySalt),
    createSessionMaterial(input.request),
  ]);
  const now = new Date().toISOString();
  const draft = JSON.stringify(createDefaultPortfolioDocument());
  const db = getPortfolioDb();

  try {
    await db.batch([
      db.prepare(`INSERT INTO admin_credentials (
        id, password_hash, password_salt, recovery_hash, recovery_salt,
        failed_attempts, initialized_at, password_changed_at, recovery_code_created_at,
        updated_at, auth_scheme, security_version
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'v2', ?)`)
        .bind(CREDENTIAL_ID, passwordHash, passwordSalt, recoveryHash, recoverySalt, now, now, now, now, PROGRAM_VERSION),
      db.prepare("INSERT OR IGNORE INTO site_ownership (id, owner_email, auth_provider, bound_at, onboarding_email_sent_at, onboarding_email_id) VALUES (?, ?, 'password', ?, ?, 'local-password')")
        .bind(OWNER_ID, OWNER_HANDLE, now, now),
      db.prepare("INSERT OR IGNORE INTO portfolio_documents (id, owner_email, revision, draft_json, updated_at) VALUES (?, ?, 1, ?, ?)")
        .bind(OWNER_ID, OWNER_HANDLE, draft, now),
      db.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at, user_agent_hash) VALUES (?, ?, ?, ?)")
        .bind(session.tokenHash, session.createdAt, session.expiresAt, session.userAgentHash),
    ]);
  } catch (error) {
    if (await localCredentialsExist()) {
      throw new AuthError("管理员已经创建，请使用刚才设置的密码登录", 409, "ADMIN_ALREADY_INITIALIZED");
    }
    throw error;
  }
  return { recoveryCode, sessionCookie: session.cookie };
}

export async function loginWithPassword(password: string, request: Request) {
  const row = await readCredentials();
  if (!row) throw new AuthError("网站尚未完成管理员初始化", 428, "ADMIN_NOT_INITIALIZED");
  if (requiresSecurityReset(row)) {
    throw new AuthError("网站升级后需要使用最新恢复码重置一次管理员密码", 428, "PASSWORD_RESET_REQUIRED");
  }
  enforceLock(row);
  const valid = await verifyProtectedHashV2("password", password, row.password_salt, row.password_hash);
  if (!valid) {
    await recordLoginFailure(row.failed_attempts);
    throw new AuthError("管理员密码不正确", 401, "PASSWORD_INVALID");
  }

  const session = await createSessionMaterial(request);
  const db = getPortfolioDb();
  await db.batch([
    db.prepare("UPDATE admin_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), CREDENTIAL_ID),
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(new Date().toISOString()),
    db.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at, user_agent_hash) VALUES (?, ?, ?, ?)")
      .bind(session.tokenHash, session.createdAt, session.expiresAt, session.userAgentHash),
  ]);
  return session.cookie;
}

export async function resetPasswordWithRecovery(input: {
  recoveryCode: string;
  password: string;
  request: Request;
}) {
  validatePassword(input.password);
  const row = await readCredentials();
  if (!row) throw new AuthError("网站尚未完成管理员初始化", 428, "ADMIN_NOT_INITIALIZED");
  enforceLock(row);

  const normalizedRecoveryCode = normalizeRecoveryCode(input.recoveryCode);
  const valid = row.auth_scheme === "v2"
    ? await verifyProtectedHashV2("recovery", normalizedRecoveryCode, row.recovery_salt, row.recovery_hash)
    : await verifyProtectedHashLegacy("recovery", normalizedRecoveryCode, row.recovery_salt, row.recovery_hash);
  if (!valid) {
    await recordLoginFailure(row.failed_attempts);
    throw new AuthError("系统恢复码不正确，请使用最新的一份", 401, "RECOVERY_CODE_INVALID");
  }

  const configuredCode = safeInitialAdminCode();
  if (configuredCode && await constantTimeEqual(input.password, configuredCode)) {
    throw new AuthError("新密码不能与一次性部署口令相同", 400, "PASSWORD_MATCHES_INITIAL_CODE");
  }

  const passwordSalt = randomToken(18);
  const recoverySalt = randomToken(18);
  const recoveryCode = createRecoveryCode();
  const [passwordHash, recoveryHash, session] = await Promise.all([
    protectedHashV2("password", input.password, passwordSalt),
    protectedHashV2("recovery", normalizeRecoveryCode(recoveryCode), recoverySalt),
    createSessionMaterial(input.request),
  ]);
  const now = new Date().toISOString();
  const db = getPortfolioDb();
  await db.batch([
    db.prepare(`UPDATE admin_credentials SET
      password_hash = ?, password_salt = ?, recovery_hash = ?, recovery_salt = ?,
      failed_attempts = 0, locked_until = NULL, password_changed_at = ?,
      recovery_code_created_at = ?, updated_at = ?, auth_scheme = 'v2', security_version = ?
      WHERE id = ?`)
      .bind(passwordHash, passwordSalt, recoveryHash, recoverySalt, now, now, now, PROGRAM_VERSION, CREDENTIAL_ID),
    db.prepare("DELETE FROM admin_sessions"),
    db.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at, user_agent_hash) VALUES (?, ?, ?, ?)")
      .bind(session.tokenHash, session.createdAt, session.expiresAt, session.userAgentHash),
  ]);
  return { recoveryCode, sessionCookie: session.cookie };
}

export async function authorizeLocalAdmin(request: Request): Promise<LocalAdminSession | null> {
  const token = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (!token || !/^[A-Za-z0-9_-]{40,100}$/u.test(token)) return null;
  const credential = await readCredentials();
  if (!credential || requiresSecurityReset(credential)) return null;

  const tokenHash = await sessionHash(token);
  const row = await getPortfolioDb()
    .prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ? LIMIT 1")
    .bind(tokenHash)
    .first<{ expires_at: string }>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    if (row) await getPortfolioDb().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return { kind: "password", user: OWNER_HANDLE };
}

export async function logoutLocalAdmin(request: Request) {
  const token = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (token) {
    const [currentHash, legacyHash] = await Promise.all([
      sessionHash(token),
      protectedHashLegacy("session", token, "v1").catch(() => ""),
    ]);
    const db = getPortfolioDb();
    await db.batch([
      db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(currentHash),
      db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(legacyHash),
    ]);
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
  if (password.length < 10 || password.length > 128) {
    throw new AuthError("密码需要10至128个字符", 400, "PASSWORD_LENGTH_INVALID");
  }
  if (password !== password.trim()) {
    throw new AuthError("密码开头和结尾不能有空格", 400, "PASSWORD_SURROUNDING_SPACE");
  }
  if (/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u2060\ufeff]/u.test(password)) {
    throw new AuthError("密码中不能包含换行或隐藏字符", 400, "PASSWORD_HIDDEN_CHARACTER");
  }
  if (!/[A-Za-z\p{Script=Han}]/u.test(password) || !/\d/u.test(password)) {
    throw new AuthError("密码至少需要包含文字和数字", 400, "PASSWORD_COMPLEXITY_INVALID");
  }
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "AUTH_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function createSessionMaterial(request: Request): Promise<SessionMaterial> {
  const token = randomToken(32);
  const tokenHash = await sessionHash(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000);
  const userAgent = request.headers.get("user-agent") ?? "";
  const userAgentHash = userAgent ? await digestText(`portfolio-user-agent-v2\n${userAgent}`) : null;
  return {
    token,
    tokenHash,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    userAgentHash,
    cookie: `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
  };
}

async function readCredentials() {
  return getPortfolioDb()
    .prepare(`SELECT password_hash, password_salt, recovery_hash, recovery_salt,
      failed_attempts, locked_until, auth_scheme, security_version
      FROM admin_credentials WHERE id = ? LIMIT 1`)
    .bind(CREDENTIAL_ID)
    .first<CredentialRow>();
}

function requiresSecurityReset(row: CredentialRow) {
  return row.auth_scheme !== "v2" || row.security_version !== PROGRAM_VERSION;
}

function enforceLock(row: CredentialRow) {
  if (!row.locked_until) return;
  const remaining = Math.ceil((Date.parse(row.locked_until) - Date.now()) / 1000);
  if (remaining > 0) throw new AuthError(`尝试次数过多，请${Math.ceil(remaining / 60)}分钟后再试`, 429, "AUTH_LOCKED");
}

async function recordLoginFailure(previousFailures: number) {
  const failures = previousFailures + 1;
  const lockedUntil = failures >= MAX_FAILURES
    ? new Date(Date.now() + LOCK_SECONDS * 1000).toISOString()
    : null;
  await getPortfolioDb()
    .prepare("UPDATE admin_credentials SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?")
    .bind(failures >= MAX_FAILURES ? 0 : failures, lockedUntil, new Date().toISOString(), CREDENTIAL_ID)
    .run();
}

async function protectedHashV2(purpose: "password" | "recovery", value: string, salt: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`portfolio-${purpose}-v2\n${value}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const digest = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: new TextEncoder().encode(`portfolio-auth-v2\n${salt}`),
    },
    material,
    256,
  );
  return base64Url(new Uint8Array(digest));
}

async function verifyProtectedHashV2(purpose: "password" | "recovery", value: string, salt: string, expected: string) {
  return constantTimeEqual(await protectedHashV2(purpose, value, salt), expected);
}

async function protectedHashLegacy(purpose: string, value: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getPurposeSecret("auth")),
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

async function verifyProtectedHashLegacy(purpose: string, value: string, salt: string, expected: string) {
  return constantTimeEqual(await protectedHashLegacy(purpose, value, salt), expected);
}

async function sessionHash(token: string) {
  return digestText(`portfolio-session-v2\n${token}`);
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

function safeInitialAdminCode() {
  try {
    return getInitialAdminCode();
  } catch {
    return null;
  }
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
