import { getPurposeSecret } from "./app-secret";

export function getMediaSigningKey() {
  return getPurposeSecret("media");
}

export async function signPlaybackGrant(key: string, expiresAt: number, secret: string) {
  const cryptoKey = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, grantPayload(key, expiresAt));
  return base64UrlEncode(new Uint8Array(signature));
}

export async function verifyPlaybackGrant(key: string, expiresAt: number, signature: string, secret: string) {
  if (!Number.isInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) || expiresAt > Math.floor(Date.now() / 1000) + 3600) {
    return false;
  }
  let decoded: Uint8Array;
  try {
    decoded = base64UrlDecode(signature);
  } catch {
    return false;
  }
  const cryptoKey = await importHmacKey(secret, ["verify"]);
  return crypto.subtle.verify("HMAC", cryptoKey, Uint8Array.from(decoded), grantPayload(key, expiresAt));
}

async function importHmacKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

function grantPayload(key: string, expiresAt: number) {
  return new TextEncoder().encode(`v1\n${key}\n${expiresAt}`);
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid base64url");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
