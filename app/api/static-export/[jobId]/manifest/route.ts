import { getStaticPublishingSecret } from "../../../_lib/app-secret";
import { exportLeaseAllows, privateExportHeaders, tokenDigest, verifyExportLease } from "../../../_lib/static-site-export";
import { getStaticJobMedia, getStaticPublishJob } from "../../../_lib/static-site-store";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) { return serve(request, context, false); }
export async function HEAD(request: Request, context: { params: Promise<{ jobId: string }> }) { return serve(request, context, true); }

async function serve(request: Request, context: { params: Promise<{ jobId: string }> }, headOnly: boolean) {
  const headers = privateExportHeaders();
  try {
    const { jobId } = await context.params;
    const auth = await authorize(request, jobId);
    if (!auth) throw new Error("denied");
    const media = await getStaticJobMedia(jobId);
    const body = JSON.stringify({
      schemaVersion: 1, jobId, generation: auth.job.export_generation, publicRevision: auth.job.public_revision,
      providerRequestKey: auth.job.provider_request_key, candidateSha256: auth.job.candidate_sha256,
      sourceCommitSha: auth.bindingCommitSha, candidate: JSON.parse(auth.job.candidate_json),
      media: media.map((item) => ({ id: item.media_id, publicPath: item.public_path, contentType: item.content_type, byteSize: item.byte_size, sourceEtag: item.source_etag })),
    });
    headers.set("Content-Type", "application/json; charset=utf-8"); headers.set("Content-Length", String(new TextEncoder().encode(body).byteLength));
    return new Response(headOnly ? null : body, { headers });
  } catch { return Response.json({ code: "EXPORT_ACCESS_DENIED", error: "导出资源不可用" }, { status: 403, headers }); }
}

async function authorize(request: Request, jobId: string) {
  const raw = request.headers.get("authorization") ?? "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7) : "";
  const claims = token ? await verifyExportLease(token, getStaticPublishingSecret("STATIC_EXPORT_SIGNING_KEY")) : null;
  const job = claims ? await getStaticPublishJob(jobId) : null;
  if (!claims || !job || !job.lease_id_sha256 || !exportLeaseAllows({ claims, jobId, generation: job.export_generation,
    leaseIdDigest: job.lease_id_sha256, leaseExpiresAt: job.lease_expires_at ?? "", status: job.status,
    method: request.method }, await tokenDigest(claims.leaseId))) return null;
  const binding = await import("../../../_lib/static-site-store").then((module) => module.getStaticSiteBinding());
  if (!binding) return null;
  return { job, bindingCommitSha: binding.expected_commit_sha };
}
