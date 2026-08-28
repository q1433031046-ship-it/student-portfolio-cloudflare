import { env } from "cloudflare:workers";
import { verifyCloudflareAccessJwt } from "./cloudflare-access";

type AuthBindings = {
  ADMIN_EMAILS?: string;
  AUTH_PLATFORM?: "sites" | "cloudflare";
  CF_ACCESS_AUD?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  UPLOAD_API_TOKEN?: string;
};

export type AdminIdentity = {
  kind: "sites" | "cloudflare-access" | "token";
  user: string;
  subject?: string;
};

export async function authorizeAdmin(request: Request): Promise<AdminIdentity | null> {
  const bindings = env as unknown as AuthBindings;
  const sitesEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (bindings.AUTH_PLATFORM === "sites" && sitesEmail) {
    if (!sameOriginForBrowserWrite(request)) return null;
    const identity: AdminIdentity = { kind: "sites", user: sitesEmail };
    return isAllowedAdmin(identity, bindings.ADMIN_EMAILS) ? identity : null;
  }

  const accessToken = request.headers.get("cf-access-jwt-assertion");
  if (accessToken && bindings.CF_ACCESS_TEAM_DOMAIN && bindings.CF_ACCESS_AUD) {
    if (!sameOriginForBrowserWrite(request)) return null;
    try {
      const payload = await verifyCloudflareAccessJwt(
        accessToken,
        bindings.CF_ACCESS_TEAM_DOMAIN,
        bindings.CF_ACCESS_AUD,
      );
      const identity: AdminIdentity = { kind: "cloudflare-access", user: payload.email, subject: payload.subject };
      return isAllowedAdmin(identity, bindings.ADMIN_EMAILS) ? identity : null;
    } catch (error) {
      console.error(JSON.stringify({ message: "cloudflare access verification failed", error: errorMessage(error) }));
      return null;
    }
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

export function isAllowedAdmin(identity: AdminIdentity, configuredEmails?: string) {
  if (identity.kind === "token") return true;
  const allowed = configuredEmails
    ?.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean) ?? [];
  if (identity.kind === "cloudflare-access" && allowed.length === 0) return false;
  return allowed.length === 0 || allowed.includes(identity.user);
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
  type TimingSafeSubtle = SubtleCrypto & { timingSafeEqual(left: ArrayBuffer, right: ArrayBuffer): boolean };
  return (crypto.subtle as TimingSafeSubtle).timingSafeEqual(leftHash, rightHash);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
