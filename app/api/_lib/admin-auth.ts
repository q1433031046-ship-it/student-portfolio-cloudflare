import { env } from "cloudflare:workers";
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

type CredentialRow = {
  password_hash: string;
  password_salt: string;
  recovery_hash: string;
  recovery_salt: string;
  failed_attempts: number;
  locked_until: string | null;
};

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

export async function createLocalAdministrator(input: {
  initialCode: string;
  password: string;
  request: Request;
}) {
  validatePassword(input.password);
  const configuredCode = getInitialAdminCode();
  if (!await constantTimeEqual(input.initialCode.trim(), configuredCode)) {
    throw new AuthError("一次性部署口令不正确", 401);
  }
  if (await constantTimeEqual(input.password, configuredCode)) {
    throw new AuthError("管理员密码不能与一次性部署口令相同", 400);
  }
  if (await localCredentialsExist()) {
    throw new AuthError("管理员已经初始化，请直接登录", 409);
  }

  const passwordSalt = randomToken(18);
  const recoverySalt = randomToken(18);
  const recoveryCode = createRecoveryCode();
  const [passwordHash, recoveryHash] = await Promise.all([
    protectedHash("password", input.password, passwordSalt),
    protectedHash("recovery", normalizeRecoveryCode(recoveryCode), recoverySalt),
  ]);
  const now = new Date().toISOString();
  const draft = JSON.stringify(createDefaultPortfolioDocument());
  const db = getPortfolioDb();
  await db.batch([
    db.prepare(`INSERT INTO admin_credentials (
      id, password_hash, password_salt, recovery_hash, recovery_salt,
      failed_attempts, initialized_at, password_changed_at, recovery_code_created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
      .bind(CREDENTIAL_ID, passwordHash, passwordSalt, recoveryHash, recoverySalt, now, now, now, now),
    db.prepare("INSERT OR IGNORE INTO site_ownership (id, owner_email, auth_provider, bound_at, onboarding_email_sent_at, onboarding_email_id) VALUES (?, ?, 'password', ?, ?, 'local-password')")
      .bind(OWNER_ID, OWNER_HANDLE, now, now),
    db.prepare("INSERT OR IGNORE INTO portfolio_documents (id, owner_email, revision, draft_json, updated_at) VALUES (?, ?, 1, ?, ?)")
      .bind(OWNER_ID, OWNER_HANDLE, draft, now),
  ]);
  const session = await createSession(input.request);
  return { recoveryCode, sessionCookie: session };
}

export async function loginWithPassword(password: string, request: Request) {
  const row = await readCredentials();
  if (!row) throw new AuthError("网站尚未完成管理员初始化", 428);
  enforceLock(row);
  const valid = await verifyProtectedHash("password", password, row.password_salt, row.password_hash);
  if (!valid) {
    await recordLoginFailure(row.failed_attempts);
    throw new AuthError("管理员密码不正确", 401);
  }
  await clearLoginFailures();
  return createSession(request);
}

export async function resetPasswordWithRecovery(input: {
  recoveryCode: string;
  password: string;
  request: Request;
}) {
  validatePassword(input.password);
  const row = await readCredentials();
  if (!row) throw new AuthError("网站尚未完成管理员初始化", 428);
  enforceLock(row);
  const valid = await verifyProtectedHash(
    "recovery",
    normalizeRecoveryCode(input.recoveryCode),
    row.recovery_salt,
    row.recovery_hash,
  );
  if (!valid) {
    await recordLoginFailure(row.failed_attempts);
    throw new AuthError("系统恢复码不正确", 401);
  }
  if (await constantTimeEqual(input.password, getInitialAdminCode())) {
    throw new AuthError("新密码不能与一次性部署口令相同", 400);
  }

  const passwordSalt = randomToken(18);
  const recoverySalt = randomToken(18);
  const recoveryCode = createRecoveryCode();
  const [passwordHash, recoveryHash] = await Promise.all([
    protectedHash("password", input.password, passwordSalt),
    protectedHash("recovery", normalizeRecoveryCode(recoveryCode), recoverySalt),
  ]);
  const now = new Date().toISOString();
  const db = getPortfolioDb();
  await db.batch([
    db.prepare(`UPDATE admin_credentials SET
      password_hash = ?, password_salt = ?, recovery_hash = ?, recovery_salt = ?,
      failed_attempts = 0, locked_until = NULL, password_changed_at = ?,
      recovery_code_created_at = ?, updated_at = ? WHERE id = ?`)
      .bind(passwordHash, passwordSalt, recoveryHash, recoverySalt, now, now, now, CREDENTIAL_ID),
    db.prepare("DELETE FROM admin_sessions"),
  ]);
  const sessionCookie = await createSession(input.request);
  return { recoveryCode, sessionCookie };
}

export async function authorizeLocalAdmin(request: Request): Promise<LocalAdminSession | null> {
  const token = readCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (!token || !/^[A-Za-z0-9_-]{40,100}$/u.test(token)) return null;
  const tokenHash = await protectedHash("session", token, "v1");
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
    const tokenHash = await protectedHash("session", token, "v1");
    await getPortfolioDb().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).run();
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
    throw new AuthError("密码需要10至128个字符", 400);
  }
  if (!/[A-Za-z\p{Script=Han}]/u.test(password) || !/\d/u.test(password)) {
    throw new AuthError("密码至少需要包含文字和数字", 400);
  }
}

export class AuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function createSession(request: Request) {
  const token = randomToken(32);
  const tokenHash = await protectedHash("session", token, "v1");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000);
  const userAgent = request.headers.get("user-agent") ?? "";
  const userAgentHash = userAgent ? await protectedHash("user-agent", userAgent, "v1") : null;
  await getPortfolioDb()
    .prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at, user_agent_hash) VALUES (?, ?, ?, ?)")
    .bind(tokenHash, now.toISOString(), expiresAt.toISOString(), userAgentHash)
    .run();
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

async function readCredentials() {
  return getPortfolioDb()
    .prepare("SELECT password_hash, password_salt, recovery_hash, recovery_salt, failed_attempts, locked_until FROM admin_credentials WHERE id = ? LIMIT 1")
    .bind(CREDENTIAL_ID)
    .first<CredentialRow>();
}

function enforceLock(row: CredentialRow) {
  if (!row.locked_until) return;
  const remaining = Math.ceil((Date.parse(row.locked_until) - Date.now()) / 1000);
  if (remaining > 0) throw new AuthError(`尝试次数过多，请${Math.ceil(remaining / 60)}分钟后再试`, 429);
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

async function clearLoginFailures() {
  await getPortfolioDb()
    .prepare("UPDATE admin_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), CREDENTIAL_ID)
    .run();
}

async function protectedHash(purpose: string, value: string, salt: string) {
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

async function verifyProtectedHash(purpose: string, value: string, salt: string, expected: string) {
  return constantTimeEqual(await protectedHash(purpose, value, salt), expected);
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
