import { sha256Hex } from "./static-site-contract";

const BOOTSTRAP_SECONDS = 30 * 60;
const LEASE_SECONDS = 120 * 60;
const EXPORTABLE_STATUSES = new Set(["FROZEN", "BUILD_TRIGGERED", "DRAFT_DEPLOY_LOCATED", "DRAFT_DEPLOY_READY"]);

export type ExportGrantClaims = {
  jobId: string;
  generation: number;
  leaseId: string;
  methods: Array<"GET" | "HEAD">;
  exp: number;
};

export function createOpaqueToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64Url(bytes);
}

export async function tokenDigest(token: string) {
  return sha256Hex(token);
}

export function bootstrapExpiresAt(now = new Date()) {
  return new Date(now.getTime() + BOOTSTRAP_SECONDS * 1000).toISOString();
}

export function leaseExpiresAt(now = new Date()) {
  return new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString();
}

export async function signExportLease(claims: ExportGrantClaims, secret: string) {
  validateClaims(claims);
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await hmac(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifyExportLease(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !constantTimeEqual(signature, await hmac(payload, secret))) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as ExportGrantClaims;
    validateClaims(claims);
    return claims.exp > nowSeconds ? claims : null;
  } catch {
    return null;
  }
}

export function exportLeaseAllows(input: {
  claims: ExportGrantClaims;
  jobId: string;
  generation: number;
  leaseIdDigest: string;
  leaseExpiresAt: string;
  status: string;
  method: string;
  nowSeconds?: number;
}, actualLeaseIdDigest: string) {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  return input.claims.jobId === input.jobId
    && input.claims.generation === input.generation
    && input.claims.exp > nowSeconds
    && Math.floor(Date.parse(input.leaseExpiresAt) / 1000) === input.claims.exp
    && input.claims.methods.includes(input.method as "GET" | "HEAD")
    && EXPORTABLE_STATUSES.has(input.status)
    && input.leaseIdDigest === actualLeaseIdDigest;
}

export function frozenR2ObjectMatches(input: {
  size: number;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}, frozen: { byteSize: number; sourceEtag: string; contentType: string }) {
  const providerType = input.httpMetadata?.contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return Number(input.size) === frozen.byteSize
    && input.httpEtag.trim() === frozen.sourceEtag.trim()
    && (!providerType || providerType === frozen.contentType.toLowerCase());
}

export function privateExportHeaders() {
  return new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
}

export function parseExportRange(value: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!Number.isSafeInteger(size) || size < 1 || !match || (!match[1] && !match[2])) return "invalid";
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start
    ? { start, end: Math.min(end, size - 1) } : "invalid";
}

function validateClaims(claims: ExportGrantClaims) {
  if (!/^job_[a-f0-9]{32}$/u.test(claims.jobId)
    || !Number.isSafeInteger(claims.generation) || claims.generation < 1
    || !/^[A-Za-z0-9_-]{20,}$/u.test(claims.leaseId)
    || !Array.isArray(claims.methods) || claims.methods.some((method) => method !== "GET" && method !== "HEAD")
    || !Number.isSafeInteger(claims.exp)) throw new Error("导出租约无效");
}

async function hmac(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
