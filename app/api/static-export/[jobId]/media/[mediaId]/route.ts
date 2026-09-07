import { getStaticPublishingSecret } from "../../../../_lib/app-secret";
import { exportLeaseAllows, frozenR2ObjectMatches, parseExportRange, privateExportHeaders, tokenDigest, verifyExportLease } from "../../../../_lib/static-site-export";
import { getStaticJobMedia, getStaticPublishJob } from "../../../../_lib/static-site-store";
import { getBucket, getMediaKv, kvChunkKey } from "../../../../_lib/storage";

export async function GET(request: Request, context: { params: Promise<{ jobId: string; mediaId: string }> }) { return serve(request, context, false); }
export async function HEAD(request: Request, context: { params: Promise<{ jobId: string; mediaId: string }> }) { return serve(request, context, true); }

async function serve(request: Request, context: { params: Promise<{ jobId: string; mediaId: string }> }, headOnly: boolean) {
  const headers = privateExportHeaders();
  try {
    const { jobId, mediaId } = await context.params;
    const raw = request.headers.get("authorization") ?? "";
    const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
    const claims = token ? await verifyExportLease(token, getStaticPublishingSecret("STATIC_EXPORT_SIGNING_KEY")) : null;
    const job = claims ? await getStaticPublishJob(jobId) : null;
    if (!claims || !job || !job.lease_id_sha256 || !exportLeaseAllows({ claims, jobId, generation: job.export_generation,
      leaseIdDigest: job.lease_id_sha256, leaseExpiresAt: job.lease_expires_at ?? "", status: job.status, method: request.method }, await tokenDigest(claims.leaseId))) throw new Error("denied");
    const media = (await getStaticJobMedia(jobId)).find((item) => item.media_id === mediaId);
    if (!media) throw new Error("denied");
    headers.set("Content-Type", media.content_type); headers.set("Accept-Ranges", "bytes"); headers.set("ETag", `"${media.source_etag}"`);
    if (media.storage_backend === "kv") return serveKv(request, media.object_key, media.byte_size, headers, headOnly);
    const requestedRange = parseExportRange(request.headers.get("range"), media.byte_size);
    if (requestedRange === "invalid") { headers.set("Content-Range", `bytes */${media.byte_size}`); return new Response(null, { status: 416, headers }); }
    const rangeHeaders = requestedRange ? new Headers({ Range: `bytes=${requestedRange.start}-${requestedRange.end}` }) : undefined;
    const object = await getBucket().get(media.object_key, rangeHeaders ? { range: rangeHeaders } : undefined);
    if (!object) throw new Error("denied");
    if (!frozenR2ObjectMatches(object, { byteSize: media.byte_size, sourceEtag: media.source_etag, contentType: media.content_type })
      || (requestedRange && (!object.range || object.range.offset !== requestedRange.start || object.range.length !== requestedRange.end - requestedRange.start + 1))
      || (!requestedRange && object.range)) {
      await object.body.cancel().catch(() => undefined);
      throw new Error("denied");
    }
    headers.set("Content-Length", String(object.range?.length ?? object.size));
    if (object.range) headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
    if (headOnly) await object.body.cancel().catch(() => undefined);
    return new Response(headOnly ? null : object.body, { status: object.range ? 206 : 200, headers });
  } catch { return Response.json({ code: "EXPORT_ACCESS_DENIED", error: "导出资源不可用" }, { status: 403, headers }); }
}

async function serveKv(request: Request, objectKey: string, size: number, headers: Headers, headOnly: boolean) {
  const chunkSize = 4 * 1024 * 1024;
  const range = parseExportRange(request.headers.get("range"), size);
  if (range === "invalid") { headers.set("Content-Range", `bytes */${size}`); return new Response(null, { status: 416, headers }); }
  if (range) {
    const length = range.end - range.start + 1;
    headers.set("Content-Length", String(length)); headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    if (headOnly) return new Response(null, { status: 206, headers });
    const firstChunk = Math.floor(range.start / chunkSize); const lastChunk = Math.floor(range.end / chunkSize);
    const namespace = getMediaKv(); let chunkIndex = firstChunk;
    const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
      if (chunkIndex > lastChunk) return controller.close();
      const value = await namespace.get(kvChunkKey(objectKey, chunkIndex), { type: "arrayBuffer", cacheTtl: 60 });
      if (!value) return controller.error(new Error("missing"));
      const chunkStart = chunkIndex * chunkSize;
      const sliceStart = Math.max(range.start, chunkStart) - chunkStart;
      const sliceEnd = Math.min(range.end + 1, chunkStart + value.byteLength) - chunkStart;
      chunkIndex += 1; controller.enqueue(new Uint8Array(value.slice(sliceStart, sliceEnd)));
      if (chunkIndex > lastChunk) controller.close();
    }});
    return new Response(stream, { status: 206, headers });
  }
  headers.set("Content-Length", String(size)); if (headOnly) return new Response(null, { headers });
  let index = 0; const count = Math.ceil(size / chunkSize); const namespace = getMediaKv();
  const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
    if (index >= count) return controller.close(); const value = await namespace.get(kvChunkKey(objectKey, index), { type: "arrayBuffer", cacheTtl: 60 });
    if (!value) return controller.error(new Error("missing")); index += 1; controller.enqueue(new Uint8Array(value)); if (index >= count) controller.close();
  }});
  return new Response(stream, { headers });
}
