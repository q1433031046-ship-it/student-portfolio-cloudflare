import { env } from "cloudflare:workers";
import { authorizeLocalAdmin, isSitesAuthPlatform } from "./admin-auth";

type AuthBindings = {
  AUTH_PLATFORM?: "sites" | "password";
  UPLOAD_API_TOKEN?: string;
};

export type AdminIdentity = {
  kind: "sites" | "password" | "token";
  user: string;
  subject?: string;
};

export async function authorizeAdmin(request: Request): Promise<AdminIdentity | null> {
  const bindings = env as unknown as AuthBindings;
  const sitesEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (isSitesAuthPlatform() && sitesEmail) {
    if (!sameOriginForBrowserWrite(request)) return null;
    return { kind: "sites", user: sitesEmail };
  }

  if (!isSitesAuthPlatform() && sameOriginForBrowserWrite(request)) {
    const local = await authorizeLocalAdmin(request);
    if (local) return local;
  }

  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (bindings.UPLOAD_API_TOKEN && supplied && await constantTimeEqual(bindings.UPLOAD_API_TOKEN, supplied)) {
    return { kind: "token", user: "service-token" };
  }
  return null;
}

export async function authorizeUpload(request: Request): Promise<AdminIdentity | null> {
  return authorizeAdmin(request);
}

export function canManagePortfolio(identity: AdminIdentity, ownerEmail: string) {
  return identity.kind === "token" || identity.user === ownerEmail.toLowerCase();
}

function sameOriginForBrowserWrite(request: Request) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return true;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
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
