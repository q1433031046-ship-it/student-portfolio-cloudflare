const TOKEN_VERSION = "v1";
const SESSION_VERSION = "s1";

export const PORTFOLIO_ACCESS_COOKIE = "portfolio-access";

export async function createAccessToken(passId: string, secret: string) {
  const signature = await sign(`portfolio-access-token\n${TOKEN_VERSION}\n${passId}`, secret);
  return `${TOKEN_VERSION}.${passId}.${signature}`;
}

export async function verifyAccessToken(token: string, secret: string) {
  const [version, passId, supplied, ...rest] = token.split(".");
  if (rest.length > 0 || version !== TOKEN_VERSION || !isPassId(passId) || !isSignature(supplied)) return null;
  const expected = await sign(`portfolio-access-token\n${TOKEN_VERSION}\n${passId}`, secret);
  return await constantTimeEqual(expected, supplied) ? passId : null;
}

export async function createAccessSession(passId: string, expiresAtSeconds: number, secret: string) {
  const signature = await sign(`portfolio-access-session\n${SESSION_VERSION}\n${passId}\n${expiresAtSeconds}`, secret);
  return `${SESSION_VERSION}.${passId}.${expiresAtSeconds}.${signature}`;
}

export async function verifyAccessSession(value: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const [version, passId, rawExpiresAt, supplied, ...rest] = value.split(".");
  const expiresAt = Number(rawExpiresAt);
  if (rest.length > 0 || version !== SESSION_VERSION || !isPassId(passId) || !Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds || !isSignature(supplied)) return null;
  const expected = await sign(`portfolio-access-session\n${SESSION_VERSION}\n${passId}\n${expiresAt}`, secret);
  return await constantTimeEqual(expected, supplied) ? { passId, expiresAt } : null;
}

export function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); }
    catch { return null; }
  }
  return null;
}

export function accessSessionCookie(value: string, expiresAtSeconds: number) {
  const expires = new Date(expiresAtSeconds * 1000).toUTCString();
  return `${PORTFOLIO_ACCESS_COOKIE}=${encodeURIComponent(value)}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearAccessSessionCookie() {
  return `${PORTFOLIO_ACCESS_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

async function sign(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return base64UrlEncode(signature);
}

async function constantTimeEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  type TimingSafeSubtle = SubtleCrypto & { timingSafeEqual?(left: ArrayBuffer, right: ArrayBuffer): boolean };
  const timingSafeEqual = (crypto.subtle as TimingSafeSubtle).timingSafeEqual;
  if (timingSafeEqual) return timingSafeEqual.call(crypto.subtle, leftHash, rightHash);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function isPassId(value: string | undefined): value is string {
  return typeof value === "string" && /^qr_[a-f0-9]{32}$/u.test(value);
}

function isSignature(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
