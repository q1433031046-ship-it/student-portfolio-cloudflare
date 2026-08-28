import { findPublishedMedia } from "../../../portfolio/model";
import { getMediaSigningKey, verifyPlaybackGrant } from "../../_lib/media-security";
import { getPortfolioDb, getPublishedPortfolio } from "../../_lib/portfolio-store";
import { getBucket, getMediaKv, kvChunkKey } from "../../_lib/storage";
import { checkPortfolioAccess } from "../../_lib/portfolio-access";

type MediaRow = {
  id: string;
  object_key: string;
  content_type: string;
  byte_size: number;
  storage_backend: "r2" | "kv";
  chunk_size: number | null;
  chunk_count: number;
};

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return serveMedia(request, context, false);
}

export async function HEAD(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return serveMedia(request, context, true);
}

async function serveMedia(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
  headOnly: boolean,
) {
  const { path } = await context.params;
  const key = path.join("/");
  if (!validObjectKey(key)) return new Response("Not found", { status: 404 });

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

    if (published.record.storage_backend === "kv") {
      return serveKvMedia(request, published.record, published.kind, access.restricted, headOnly);
    }
    return serveR2Media(request, published.record, published.kind, access.restricted, headOnly);
  } catch (error) {
    console.error(JSON.stringify({ message: "media read failed", error: errorMessage(error), key }));
    return new Response("Media unavailable", { status: 503 });
  }
}

async function serveKvMedia(
  request: Request,
  record: MediaRow,
  kind: "image" | "video" | "font",
  restricted: boolean,
  headOnly: boolean,
) {
  const chunkSize = record.chunk_size ?? record.byte_size;
  const range = parseRange(request.headers.get("range"), record.byte_size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${record.byte_size}` } });
  }
  const headers = mediaHeaders(record, kind, restricted);
  if (range) {
    const chunkIndex = Math.floor(range.start / chunkSize);
    const chunkStart = chunkIndex * chunkSize;
    const availableEnd = Math.min(record.byte_size - 1, chunkStart + chunkSize - 1);
    const responseEnd = Math.min(range.end, availableEnd);
    const responseLength = responseEnd - range.start + 1;
    headers.set("Content-Length", String(responseLength));
    headers.set("Content-Range", `bytes ${range.start}-${responseEnd}/${record.byte_size}`);
    if (headOnly) return new Response(null, { status: 206, headers });
    const value = await getMediaKv().get(kvChunkKey(record.object_key, chunkIndex), { type: "arrayBuffer", cacheTtl: 60 });
    if (!value) return new Response("Not found", { status: 404 });
    const offset = range.start - chunkStart;
    return new Response(value.slice(offset, offset + responseLength), { status: 206, headers });
  }

  headers.set("Content-Length", String(record.byte_size));
  if (headOnly) return new Response(null, { status: 200, headers });
  const namespace = getMediaKv();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (index >= record.chunk_count) return controller.close();
        const value = await namespace.get(kvChunkKey(record.object_key, index), { type: "arrayBuffer", cacheTtl: 60 });
        if (!value) throw new Error(`missing media chunk ${index}`);
        index += 1;
        controller.enqueue(new Uint8Array(value));
        if (index >= record.chunk_count) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, { status: 200, headers });
}

async function serveR2Media(
  request: Request,
  record: MediaRow,
  kind: "image" | "video" | "font",
  restricted: boolean,
  headOnly: boolean,
) {
  const rangeRequested = request.headers.has("range");
  const object = await getBucket().get(record.object_key, rangeRequested ? { range: request.headers } : undefined);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = mediaHeaders(record, kind, restricted);
  headers.set("ETag", object.httpEtag);
  if (object.range) {
    headers.set("Content-Length", String(object.range.length));
    headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
  } else {
    headers.set("Content-Length", String(object.size));
  }
  return new Response(headOnly ? null : object.body, { status: object.range ? 206 : 200, headers });
}

function mediaHeaders(record: MediaRow, kind: string, restricted: boolean) {
  return new Headers({
    "Content-Type": record.content_type || "application/octet-stream",
    "Cache-Control": kind === "video" || restricted ? "private, no-store" : "private, max-age=3600",
    "Accept-Ranges": "bytes",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    ETag: `"${record.id}"`,
  });
}

async function findPortfolioMedia(key: string) {
  const { document } = await getPublishedPortfolio();
  if (!document) return null;
  const published = findPublishedMedia(document, key);
  if (!published) return null;
  const record = await getPortfolioDb()
    .prepare(`SELECT id, object_key, content_type, byte_size, storage_backend, chunk_size, chunk_count
      FROM portfolio_media WHERE object_key = ? AND status = 'uploaded' LIMIT 1`)
    .bind(key)
    .first<MediaRow>();
  return record ? { kind: published.asset.kind, record } : null;
}

function parseRange(value: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match) return "invalid";
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return "invalid";
  let start: number;
  let end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

function validObjectKey(value: string) {
  return /^portfolio\/[a-zA-Z0-9/_-]+\.[a-z0-9]+$/u.test(value) && !value.includes("..");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
