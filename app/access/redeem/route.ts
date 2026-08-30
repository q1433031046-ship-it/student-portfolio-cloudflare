import { redeemAccessPass } from "../../api/_lib/portfolio-access";

const MAX_FORM_BYTES = 2_048;
const SAFE_REASONS = new Set([
  "二维码无效",
  "二维码已停用",
  "二维码已过期",
  "二维码使用次数已用完",
  "二维码暂时不可用",
]);

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== requestUrl.origin) {
    return accessRedirect(requestUrl, "", "二维码无效");
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    !contentType.startsWith("application/x-www-form-urlencoded")
    || !Number.isFinite(declaredLength)
    || declaredLength > MAX_FORM_BYTES
  ) return accessRedirect(requestUrl, "", "二维码无效");

  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_FORM_BYTES) return accessRedirect(requestUrl, "", "二维码无效");
    const token = new URLSearchParams(rawBody).get("key") ?? "";
    if (token.length < 20 || token.length > 300) return accessRedirect(requestUrl, "", "二维码无效");
    const result = await redeemAccessPass(request, token);
    return result.ok
      ? homeRedirect(requestUrl, result.cookie ?? undefined)
      : accessRedirect(requestUrl, token, result.reason);
  } catch {
    return accessRedirect(requestUrl, "", "二维码暂时不可用");
  }
}

function homeRedirect(requestUrl: URL, cookie?: string) {
  return new Response(null, {
    status: 303,
    headers: responseHeaders(new URL("/", requestUrl.origin).toString(), cookie),
  });
}

function accessRedirect(requestUrl: URL, token: string, reason: string) {
  const destination = new URL("/access", requestUrl.origin);
  if (token.length >= 20 && token.length <= 300) destination.searchParams.set("key", token);
  destination.searchParams.set("error", SAFE_REASONS.has(reason) ? reason : "二维码暂时不可用");
  return new Response(null, {
    status: 303,
    headers: responseHeaders(destination.toString()),
  });
}

function responseHeaders(location: string, cookie?: string) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return headers;
}
