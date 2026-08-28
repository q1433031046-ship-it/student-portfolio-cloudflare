import { findPublishedMedia } from "../../../portfolio/model";
import { getMediaSigningKey, verifyPlaybackGrant } from "../../_lib/media-security";
import { getPublishedPortfolio } from "../../_lib/portfolio-store";
import { getBucket } from "../../_lib/storage";
import { checkPortfolioAccess } from "../../_lib/portfolio-access";

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const key = path.join("/");
  if (!/^portfolio\/[a-zA-Z0-9/_-]+\.[a-z0-9]+$/u.test(key) || key.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const access = await checkPortfolioAccess(request);
    if (!access.allowed) return new Response("Access pass required", { status: 403, headers: { "Cache-Control": "no-store" } });
    const published = await findPortfolioMedia(key);
    if (!published) return new Response("Not found", { status: 404 });

    if (published.kind === "video") {
      const url = new URL(request.url);
      const expiresAt = Number(url.searchParams.get("exp"));
      const signature = url.searchParams.get("sig") ?? "";
      if (!await verifyPlaybackGrant(key, expiresAt, signature, getMediaSigningKey())) {
        return new Response("Playback grant required", { status: 403, headers: { "Cache-Control": "no-store" } });
      }
    }

    const rangeRequested = request.headers.has("range");
    const object = await getBucket().get(key, rangeRequested ? { range: request.headers } : undefined);
    if (!object) return new Response("Not found", { status: 404 });

    const headers = new Headers({
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": published.kind === "video" || access.restricted ? "private, no-store" : "private, max-age=3600",
      "Accept-Ranges": "bytes",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      ETag: object.httpEtag,
    });
    if (object.range) {
      headers.set("Content-Length", String(object.range.length));
      headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
    } else {
      headers.set("Content-Length", String(object.size));
    }
    return new Response(object.body, { status: object.range ? 206 : 200, headers });
  } catch (error) {
    console.error(JSON.stringify({ message: "media read failed", error: errorMessage(error), key }));
    return new Response("Media unavailable", { status: 503 });
  }
}

async function findPortfolioMedia(key: string) {
  const { document } = await getPublishedPortfolio();
  if (!document) return null;
  const published = findPublishedMedia(document, key);
  return published ? { kind: published.asset.kind } : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
