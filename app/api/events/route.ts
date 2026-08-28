import { PUBLIC_EVENT_TYPES, recordPortfolioEvent } from "../_lib/events";
import { getAnalyticsHashKey } from "../_lib/request-context";
import { checkPortfolioAccess } from "../_lib/portfolio-access";
import { isRequestBodyError, readJsonBody } from "../_lib/request-body";

export async function POST(request: Request) {
  try {
    const access = await checkPortfolioAccess(request);
    if (!access.allowed) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
    const body = await readJsonBody(request, 8_192);
    if (!isRecord(body) || typeof body.eventType !== "string" || !PUBLIC_EVENT_TYPES.has(body.eventType)) return new Response(null, { status: 400 });
    if (typeof body.path !== "string" || !body.path.startsWith("/") || body.path.length > 300) return new Response(null, { status: 400 });
    if (typeof body.sessionId !== "string" || !/^[a-zA-Z0-9_-]{20,100}$/u.test(body.sessionId)) return new Response(null, { status: 400 });
    if (!getAnalyticsHashKey()) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
    const projectId = typeof body.projectId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(body.projectId) ? body.projectId : null;
    const mediaVersion = body.mediaVersion === "final" ? body.mediaVersion : null;
    await recordPortfolioEvent({ request, eventType: body.eventType, path: body.path, projectId, mediaVersion, sessionId: body.sessionId });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isRequestBodyError(error)) return new Response(null, { status: error.status });
    console.error(JSON.stringify({ message: "portfolio event write failed", error: errorMessage(error) }));
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
