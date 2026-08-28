import { recordPortfolioEvent, recentPlaybackCount } from "../_lib/events";
import { getMediaSigningKey, signPlaybackGrant } from "../_lib/media-security";
import { getPublishedPortfolio } from "../_lib/portfolio-store";
import { deriveRequestContext } from "../_lib/request-context";
import { checkPortfolioAccess } from "../_lib/portfolio-access";
import { isRequestBodyError, readJsonBody } from "../_lib/request-body";

export async function POST(request: Request) {
  try {
    const access = await checkPortfolioAccess(request);
    if (!access.allowed) return Response.json({ error: "需要有效的二维码访问" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const body = await readJsonBody(request, 8_192);
    if (!isRecord(body) || typeof body.projectId !== "string" || body.version !== "final") {
      return Response.json({ error: "播放请求无效" }, { status: 400 });
    }
    const sessionId = typeof body.sessionId === "string" && /^[a-zA-Z0-9_-]{20,100}$/u.test(body.sessionId) ? body.sessionId : null;
    const { document } = await getPublishedPortfolio();
    if (!document) return Response.json({ error: "网站尚未发布" }, { status: 404 });
    const project = document.projects.find((item) => item.id === body.projectId);
    const asset = project?.finalVideo ?? null;
    const mediaKey = asset?.key;
    if (!mediaKey) return Response.json({ error: project ? "这个版本尚未上传" : "作品不存在" }, { status: 404 });

    const requestContext = await deriveRequestContext(request);
    if (requestContext.networkHash && await safeRecentPlaybackCount(requestContext.networkHash) >= 60) {
      await safeRecordEvent({
        request, eventType: "play_request", path: new URL(request.url).pathname,
        projectId: body.projectId, mediaVersion: body.version, action: "block", context: requestContext,
        sessionId,
        forcedRisk: { level: "high", reason: "playback_rate_limit" },
      });
      return Response.json({ error: "播放请求过于频繁，请稍后再试" }, { status: 429, headers: { "Retry-After": "300" } });
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const signature = await signPlaybackGrant(mediaKey, expiresAt, getMediaSigningKey());
    await safeRecordEvent({
      request, eventType: "play_request", path: new URL(request.url).pathname,
      projectId: body.projectId, mediaVersion: body.version, context: requestContext,
      sessionId,
    });
    return Response.json({
      url: `/api/media/${mediaKey}?exp=${expiresAt}&sig=${encodeURIComponent(signature)}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isRequestBodyError(error)) return Response.json({ error: error.message }, { status: error.status });
    const message = errorMessage(error);
    console.error(JSON.stringify({ message: "playback grant failed", error: message }));
    const configurationError = message.includes("密钥");
    return Response.json({ error: configurationError ? "视频播放保护尚未配置" : "暂时无法开始播放" }, { status: configurationError ? 503 : 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function safeRecentPlaybackCount(networkHash: string) {
  try { return await recentPlaybackCount(networkHash); }
  catch (error) {
    console.error(JSON.stringify({ message: "playback rate lookup failed", error: errorMessage(error) }));
    return 0;
  }
}

async function safeRecordEvent(input: Parameters<typeof recordPortfolioEvent>[0]) {
  try { await recordPortfolioEvent(input); }
  catch (error) { console.error(JSON.stringify({ message: "playback event write failed", error: errorMessage(error) })); }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
