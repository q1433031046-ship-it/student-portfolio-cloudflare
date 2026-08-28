import { getPurposeSecret } from "./app-secret";

export function getAnalyticsHashKey() {
  try { return getPurposeSecret("analytics"); }
  catch { return null; }
}

type RequestCf = {
  asn?: number;
  asOrganization?: string;
  botManagement?: { score?: number; verifiedBot?: boolean };
  city?: string;
  country?: string;
  region?: string;
};

export type RequestContext = {
  deviceType: string;
  browser: string;
  operatingSystem: string;
  country: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  asOrganization: string | null;
  networkHash: string | null;
  riskLevel: "low" | "medium" | "high";
  riskReason: string | null;
};

export async function deriveRequestContext(request: Request): Promise<RequestContext> {
  const cf = (request as Request & { cf?: RequestCf }).cf;
  const userAgent = request.headers.get("user-agent") ?? "";
  const ip = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  const hashKey = getAnalyticsHashKey();
  const networkHash = ip && hashKey ? await hmacIdentifier(ip, hashKey) : null;
  const client = parseUserAgent(userAgent);
  const botScore = cf?.botManagement?.score;
  const verifiedBot = cf?.botManagement?.verifiedBot === true;

  let riskLevel: RequestContext["riskLevel"] = "low";
  let riskReason: string | null = null;
  if (!userAgent) {
    riskLevel = "medium";
    riskReason = "missing_user_agent";
  } else if (!verifiedBot && typeof botScore === "number" && botScore < 10) {
    riskLevel = "high";
    riskReason = "low_bot_score";
  } else if (!verifiedBot && typeof botScore === "number" && botScore < 30) {
    riskLevel = "medium";
    riskReason = "suspicious_bot_score";
  }

  return {
    ...client,
    country: clean(cf?.country, 8),
    region: clean(cf?.region, 80),
    city: clean(cf?.city, 80),
    asn: typeof cf?.asn === "number" ? cf.asn : null,
    asOrganization: clean(cf?.asOrganization, 160),
    networkHash,
    riskLevel,
    riskReason,
  };
}

export async function hmacIdentifier(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(signature.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildEventDedupeKey(input: {
  sessionId: string;
  eventType: string;
  path: string;
  projectId?: string | null;
  mediaVersion?: string | null;
  action: "allow" | "block";
  now?: number;
}, secret: string) {
  const bucket = Math.floor((input.now ?? Date.now()) / 300_000);
  return hmacIdentifier([
    input.sessionId,
    input.eventType,
    input.path,
    input.projectId ?? "",
    input.mediaVersion ?? "",
    input.action,
    String(bucket),
  ].join("\n"), secret);
}

export function sanitizeReferrer(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

function parseUserAgent(value: string) {
  const lower = value.toLowerCase();
  const deviceType = /ipad|tablet/u.test(lower) ? "tablet" : /mobile|iphone|android/u.test(lower) ? "mobile" : "desktop";
  const browser = /edg\//u.test(lower) ? "Edge" : /firefox\//u.test(lower) ? "Firefox" : /chrome\//u.test(lower) ? "Chrome" : /safari\//u.test(lower) ? "Safari" : "Other";
  const operatingSystem = /iphone|ipad/u.test(lower) ? "iOS" : /android/u.test(lower) ? "Android" : /windows/u.test(lower) ? "Windows" : /mac os|macintosh/u.test(lower) ? "macOS" : /linux/u.test(lower) ? "Linux" : "Other";
  return { deviceType, browser, operatingSystem };
}

function clean(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}
