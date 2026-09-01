import { getStaticPublishingSecret } from "./app-secret";
import { writeAuditLog } from "./audit";
import { NetlifyClient, NetlifyClientError, type NetlifyDeploy } from "./netlify-client";
import { cleanupUnreferencedMedia } from "./media-cleanup";
import { getPortfolioDb, getPortfolioRecord } from "./portfolio-store";
import { getBucket, type UploadBucket } from "./storage";
import { bootstrapExpiresAt, createOpaqueToken, tokenDigest } from "./static-site-export";
import { freezeStaticCandidate, sha1Hex, sha256Hex, type StaticMediaRecord } from "./static-site-contract";
import { assertProductionReadback, StaticArtifactError, verifyArtifact, type ArtifactManifest } from "./static-publish-verify";
import {
  beginStaticRollback,
  commitStaticPublishSuccess,
  commitStaticRollbackSuccess,
  getStaticJobMedia,
  getStaticPublishJob,
  getStaticSiteBinding,
  insertFrozenStaticJob,
  noteStaticJobError,
  restartStaticJobGeneration,
  setStaticBindingStatus,
  transitionStaticJob,
  type StaticPublishJobRow,
} from "./static-site-store";

type SourceMediaRow = {
  id: string; object_key: string; content_type: string; byte_size: number; storage_backend: "kv" | "r2";
  chunk_count: number; status: string; source_etag: string | null;
};

type JsonEvidence<T> = { value: T; text: string; sha256: string; providerSha1: string; byteSize: number };

export class StaticPublishError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}

export async function freezeAndTriggerStaticPublish(revision: number, actorEmail: string) {
  const [record, binding] = await Promise.all([getPortfolioRecord(), getStaticSiteBinding()]);
  if (!record || record.revision !== revision) throw new StaticPublishError("STATIC_REVISION_CONFLICT", "草稿已变化，请刷新后再发布");
  assertUsableBinding(binding);
  const client = await netlifyClientForBinding(binding);

  const rows = await getPortfolioDb().prepare(`SELECT id, object_key, content_type, byte_size, storage_backend, chunk_count, status,
    (SELECT source_etag FROM legacy_media_migrations WHERE media_id = portfolio_media.id) AS source_etag
    FROM portfolio_media WHERE status != 'deleted'`).all<SourceMediaRow>();
  const frozen = await freezeStaticCandidate(record.draft, await mediaRecordsFromRows(rows.results ?? []));
  const jobId = `job_${crypto.randomUUID().replaceAll("-", "")}`;
  const idempotencyKey = `${binding.site_id}:${revision}:${frozen.candidateSha256}`;
  const providerRequestKey = await requestKey(binding.site_id, jobId, idempotencyKey, 1);
  const bootstrapToken = createOpaqueToken();
  const created = await insertFrozenStaticJob({
    jobId, sourceDocumentRevision: revision, candidate: frozen, idempotencyKey, providerRequestKey,
    bootstrapTokenSha256: await tokenDigest(bootstrapToken), bootstrapExpiresAt: bootstrapExpiresAt(),
  });
  if (!created.inserted) return { job: created.job, repeated: true as const };

  await transitionStaticJob(jobId, "FROZEN", "BUILD_TRIGGERED", "build");
  const hookBody = { jobId, generation: 1, providerRequestKey, bootstrapGrant: bootstrapToken };
  try {
    await client.triggerDraftBuild(getStaticPublishingSecret("NETLIFY_DRAFT_BUILD_HOOK"), hookBody, providerRequestKey);
    await writeAuditLog({ actorEmail, action: "static_site.publish.triggered", targetType: "static_publish_job", targetId: jobId,
      summary: { sourceRevision: revision, candidateSha256: frozen.candidateSha256, providerRequestKey } });
  } catch (error) {
    await noteStaticJobError(jobId, "BUILD_TRIGGERED", errorCode(error), "Build Hook 结果不确定；将按 request key 找回原 Deploy，不会创建第二个 Build");
    await writeFailureAudit(actorEmail, jobId, "build", error);
  }
  return { job: await getStaticPublishJob(jobId), repeated: false as const };
}

export async function advanceStaticPublish(jobId: string, actorEmail: string) {
  let job = requireJob(await getStaticPublishJob(jobId));
  const binding = await getStaticSiteBinding();
  assertUsableBinding(binding, true);
  const client = await netlifyClientForBinding(binding);

  try {
    if (job.status === "BUILD_TRIGGERED") {
      const deploy = await client.findDeployByRequestKey(binding.site_id, job.provider_request_key, new Date(job.updated_at));
      if (!deploy) return { job, waiting: true as const, reason: "NETLIFY_DEPLOY_PENDING" };
      assertDeployIdentity(deploy, binding.site_id);
      job = requireJob(await transitionStaticJob(job.id, "BUILD_TRIGGERED", "DRAFT_DEPLOY_LOCATED", "locate", {
        deployId: deploy.id, deployPermalink: validatedDeployPermalink(deploy),
      }));
    }

    if (job.status === "DRAFT_DEPLOY_LOCATED") {
      const deploy = await client.getDeploy(binding.site_id, requiredValue(job.deploy_id, "Deploy ID"));
      if (deploy.state !== "ready") {
        if (isTerminalFailedDeploy(deploy)) throw new StaticPublishError("NETLIFY_DRAFT_DEPLOY_FAILED", "Netlify draft Deploy 构建失败");
        return { job, waiting: true as const, reason: "NETLIFY_DEPLOY_NOT_READY" };
      }
      job = requireJob(await transitionStaticJob(job.id, "DRAFT_DEPLOY_LOCATED", "DRAFT_DEPLOY_READY", "artifact", {
        deployId: deploy.id, deployPermalink: validatedDeployPermalink(deploy),
      }));
    }

    if (job.status === "DRAFT_DEPLOY_READY") {
      const deploy = await client.getDeploy(binding.site_id, requiredValue(job.deploy_id, "Deploy ID"));
      const permalink = validatedDeployPermalink(deploy);
      const [manifestEvidence, markerEvidence, providerFiles] = await Promise.all([
        readJsonEvidence<ArtifactManifest>(permalink, "artifact-manifest.json"),
        readJsonEvidence<Record<string, unknown>>(permalink, "__static-release.json"),
        client.listDeployFiles(binding.site_id, deploy.id),
      ]);
      const verified = await verifyArtifact({ manifest: manifestEvidence.value, marker: markerEvidence.value, deploy, providerFiles,
        manifestFileEvidence: manifestEvidence, markerFileEvidence: markerEvidence,
        expectedCandidateSha256: job.candidate_sha256, expectedSourceCommitSha: binding.expected_commit_sha,
        expectedProviderRequestKey: job.provider_request_key, expectedPublicRevision: job.public_revision });
      job = requireJob(await transitionStaticJob(job.id, "DRAFT_DEPLOY_READY", "ARTIFACT_VERIFIED", "publish", {
        deployId: deploy.id, deployPermalink: permalink, artifactManifestJson: manifestEvidence.text,
        artifactSha256: verified.artifactSha256, artifactManifestFileSha256: manifestEvidence.sha256,
      }));
    }

    if (job.status === "ARTIFACT_VERIFIED") {
      job = requireJob(await transitionStaticJob(job.id, "ARTIFACT_VERIFIED", "PUBLISH_REQUESTED", "publish"));
    }

    if (job.status === "PUBLISH_REQUESTED") {
      const deployId = requiredValue(job.deploy_id, "Deploy ID");
      const artifactSha256 = requiredValue(job.artifact_sha256, "制品摘要");
      const site = await publishAndReadBackExistingDeploy(client, binding.site_id, deployId);
      if (site.published_deploy?.id !== deployId) return { job, waiting: true as const, reason: "NETLIFY_PUBLISH_READBACK_PENDING" };
      const productionUrl = validatedProductionUrl(binding.production_url);
      const marker = await readJsonEvidence<Record<string, unknown>>(productionUrl, "__static-release.json");
      assertProductionReadback(marker.value, deployId, artifactSha256);
      job = requireJob(await transitionStaticJob(job.id, "PUBLISH_REQUESTED", "PRODUCTION_READBACK_VERIFIED", "commit"));
    }

    if (job.status === "PRODUCTION_READBACK_VERIFIED") {
      const manifest = parseArtifactManifest(job.artifact_manifest_json);
      const mediaByPath = new Map(manifest.files.map((file) => [normalizePath(file.path), file]));
      const verifiedMedia = (await getStaticJobMedia(job.id)).map((media) => {
        const evidence = mediaByPath.get(normalizePath(media.public_path));
        if (!evidence) throw new StaticArtifactError("STATIC_MEDIA_EVIDENCE_MISSING", "静态媒体制品证据不完整");
        return { mediaId: media.media_id, sha256: evidence.sha256, providerSha1: evidence.providerSha1 };
      });
      job = requireJob(await commitStaticPublishSuccess({ jobId: job.id, expectedStatus: "PRODUCTION_READBACK_VERIFIED",
        productionUrl: validatedProductionUrl(binding.production_url), deployId: requiredValue(job.deploy_id, "Deploy ID"),
        artifactManifestJson: requiredValue(job.artifact_manifest_json, "制品清单"), artifactSha256: requiredValue(job.artifact_sha256, "制品摘要"),
        artifactManifestFileSha256: requiredValue(job.artifact_manifest_file_sha256, "制品清单摘要"), verifiedMedia }));
      await writeAuditLog({ actorEmail, action: "static_site.publish.completed", targetType: "static_publish_job", targetId: job.id,
        summary: { publicRevision: job.public_revision, providerRequestKey: job.provider_request_key, deployIdHash: await shortHash(requiredValue(job.deploy_id, "Deploy ID")) } });
      const current = await getPortfolioRecord();
      if (current) {
        try { await cleanupUnreferencedMedia(current.draft, current.revision); }
        catch (error) {
          await writeAuditLog({ actorEmail, action: "static_site.media_cleanup.warning", targetType: "static_publish_job", targetId: job.id,
            summary: { code: errorCode(error) } });
        }
      }
    }
    return { job, waiting: false as const };
  } catch (error) {
    await failJob(job, error);
    await writeFailureAudit(actorEmail, job.id, job.phase, error);
    throw normalizeError(error);
  }
}

export async function retryStaticPublish(jobId: string, actorEmail: string) {
  let job = requireJob(await getStaticPublishJob(jobId));
  if (job.status !== "FAILED_RETRYABLE") return advanceStaticPublish(jobId, actorEmail);
  const binding = await getStaticSiteBinding();
  assertUsableBinding(binding, true);
  const client = await netlifyClientForBinding(binding);
  if (job.artifact_sha256 && job.deploy_id) {
    await transitionStaticJob(job.id, "FAILED_RETRYABLE", "ARTIFACT_VERIFIED", "publish");
    return advanceStaticPublish(job.id, actorEmail);
  }
  if (job.deploy_id) {
    await transitionStaticJob(job.id, "FAILED_RETRYABLE", "DRAFT_DEPLOY_LOCATED", "locate");
    return advanceStaticPublish(job.id, actorEmail);
  }
  const found = await client.findDeployByRequestKey(binding.site_id, job.provider_request_key, new Date(job.updated_at));
  if (found && !isTerminalFailedDeploy(found)) {
    await transitionStaticJob(job.id, "FAILED_RETRYABLE", "DRAFT_DEPLOY_LOCATED", "locate", {
      deployId: found.id, deployPermalink: validatedDeployPermalink(found),
    });
    return advanceStaticPublish(job.id, actorEmail);
  }
  if (!found && Date.parse(job.bootstrap_expires_at) > Date.now()) {
    throw new StaticPublishError("NETLIFY_ORIGINAL_DEPLOY_UNCERTAIN", "原 Build 仍在可找回窗口内，暂不能创建新的 Build");
  }
  const generation = job.export_generation + 1;
  const bootstrapToken = createOpaqueToken();
  const providerRequestKey = await requestKey(binding.site_id, job.id, job.idempotency_key, generation);
  job = requireJob(await restartStaticJobGeneration({ jobId: job.id, expectedGeneration: job.export_generation,
    providerRequestKey, bootstrapTokenSha256: await tokenDigest(bootstrapToken), bootstrapExpiresAt: bootstrapExpiresAt() }));
  try {
    await client.triggerDraftBuild(getStaticPublishingSecret("NETLIFY_DRAFT_BUILD_HOOK"), {
      jobId: job.id, generation, providerRequestKey, bootstrapGrant: bootstrapToken,
    }, providerRequestKey);
  } catch (error) {
    await noteStaticJobError(job.id, "BUILD_TRIGGERED", errorCode(error), "重试 Build Hook 结果不确定；将按新 request key 找回同一尝试");
  }
  await writeAuditLog({ actorEmail, action: "static_site.publish.retried", targetType: "static_publish_job", targetId: job.id,
    summary: { generation, providerRequestKey } });
  return { job: await getStaticPublishJob(job.id), waiting: true as const, reason: "NETLIFY_DEPLOY_PENDING" };
}

export async function rollbackStaticPublish(targetDeployId: string, actorEmail: string) {
  const binding = await getStaticSiteBinding();
  assertUsableBinding(binding, true);
  const client = await netlifyClientForBinding(binding);
  const currentDeployId = requiredValue(binding.current_deploy_id, "当前 Deploy");
  const { target } = await beginStaticRollback(currentDeployId, targetDeployId);
  try {
    const site = await publishAndReadBackExistingDeploy(client, binding.site_id, targetDeployId);
    if (site.published_deploy?.id !== targetDeployId) {
      throw new StaticPublishError("NETLIFY_ROLLBACK_READBACK_PENDING", "回滚已请求，固定 Site 尚未读回目标 Deploy", 503);
    }
    const productionUrl = validatedProductionUrl(binding.production_url);
    const marker = await readJsonEvidence<Record<string, unknown>>(productionUrl, "__static-release.json");
    assertProductionReadback(marker.value, targetDeployId, requiredValue(target.artifact_sha256, "回滚制品摘要"));
    const result = await commitStaticRollbackSuccess({ currentDeployId, targetJob: target, productionUrl });
    await writeAuditLog({ actorEmail, action: "static_site.rollback.completed", targetType: "static_site_binding", targetId: "default",
      summary: { targetDeployIdHash: await shortHash(targetDeployId), publicRevision: target.public_revision } });
    return result;
  } catch (error) {
    await writeFailureAudit(actorEmail, target.id, "rollback", error);
    throw normalizeError(error);
  }
}

export async function mediaRecordsFromRows(rows: SourceMediaRow[], bucket?: UploadBucket): Promise<Array<Omit<StaticMediaRecord, "publicPath"> & { status: string }>> {
  const result = [];
  for (const row of rows) {
    let sourceEtag = row.id;
    if (row.storage_backend === "r2") {
      const range = new Headers({ Range: "bytes=0-0" });
      const object = await (bucket ?? getBucket()).get(row.object_key, { range });
      if (!object) throw new StaticPublishError("STATIC_R2_SOURCE_MISSING", "旧 R2 媒体无法冻结");
      const etag = object.httpEtag?.trim();
      const providerType = object.httpMetadata?.contentType?.split(";", 1)[0]?.trim().toLowerCase();
      const valid = object.size === row.byte_size && object.range?.offset === 0 && object.range?.length === 1
        && etag && (!row.source_etag || row.source_etag === etag)
        && (!providerType || providerType === row.content_type.toLowerCase());
      await object.body.cancel().catch(() => undefined);
      if (!valid) throw new StaticPublishError("STATIC_R2_SOURCE_CHANGED", "旧 R2 媒体身份已变化，无法冻结本次候选");
      sourceEtag = etag;
    }
    result.push({ id: row.id, objectKey: row.object_key, contentType: row.content_type, byteSize: row.byte_size,
      storageBackend: row.storage_backend, sourceEtag, status: row.status });
  }
  return result;
}

export async function publishAndReadBackExistingDeploy(
  client: Pick<NetlifyClient, "getSite" | "publishExistingDeploy">,
  siteId: string,
  deployId: string,
) {
  const before = await client.getSite(siteId);
  if (before.published_deploy?.id === deployId) return before;
  try {
    await client.publishExistingDeploy(siteId, deployId);
  } catch (error) {
    const afterUnknownResult = await client.getSite(siteId);
    if (afterUnknownResult.published_deploy?.id === deployId) return afterUnknownResult;
    throw error;
  }
  return client.getSite(siteId);
}

function netlifyClient() { return new NetlifyClient(getStaticPublishingSecret("NETLIFY_AUTH_TOKEN")); }
async function requestKey(siteId: string, jobId: string, idempotencyKey: string, generation: number) {
  return `sp-${(await sha256Hex(`${siteId}:${jobId}:${idempotencyKey}:${generation}`)).slice(0, 24)}`;
}
function requireJob(job: StaticPublishJobRow | null): StaticPublishJobRow {
  if (!job) throw new StaticPublishError("STATIC_JOB_NOT_FOUND", "静态发布任务不可用", 404);
  return job;
}
function assertUsableBinding(binding: Awaited<ReturnType<typeof getStaticSiteBinding>>, allowPublished = false): asserts binding is NonNullable<typeof binding> {
  if (!binding) throw new StaticPublishError("STATIC_SITE_UNCONFIGURED", "尚未配置唯一 Netlify Site");
  if (binding.status === "reauthorization_required") throw new StaticPublishError("NETLIFY_REAUTHORIZATION_REQUIRED", "Netlify 需要重新授权");
  if (binding.status === "reverification_required") throw new StaticPublishError("NETLIFY_REVERIFICATION_REQUIRED", "Netlify Site 身份需要重新核验");
  if (!allowPublished && binding.status === "rollback_in_progress") throw new StaticPublishError("STATIC_ROLLBACK_IN_PROGRESS", "静态站正在回滚");
  if (binding.provider !== "netlify" || binding.build_branch !== "static-build/v1.3.1-b") throw new StaticPublishError("STATIC_SITE_IDENTITY_INVALID", "静态 Site 合同无效");
  if (!/^[a-f0-9]{40}$/u.test(binding.expected_commit_sha)) throw new StaticPublishError("STATIC_SOURCE_IDENTITY_INVALID", "静态构建源码身份无效");
  validatedProductionUrl(binding.production_url);
}

export async function assertNetlifyBindingSite(
  binding: NonNullable<Awaited<ReturnType<typeof getStaticSiteBinding>>>,
  site: Awaited<ReturnType<NetlifyClient["getSite"]>>,
) {
  if (!site.account_id || await sha256Hex(site.account_id) !== binding.account_identity_hash) {
    throw new StaticPublishError("NETLIFY_SITE_ACCOUNT_MISMATCH", "Netlify Site 所属账号与冻结身份不一致");
  }
  if (site.name !== binding.site_slug) throw new StaticPublishError("NETLIFY_SITE_SLUG_MISMATCH", "Netlify Site 名称与冻结身份不一致");
  const providerUrl = validatedProductionUrl(site.ssl_url ?? site.url ?? null);
  if (providerUrl !== validatedProductionUrl(binding.production_url)) {
    throw new StaticPublishError("NETLIFY_SITE_URL_MISMATCH", "Netlify 固定网址与冻结身份不一致");
  }
}

async function netlifyClientForBinding(binding: NonNullable<Awaited<ReturnType<typeof getStaticSiteBinding>>>) {
  const client = netlifyClient();
  try {
    await assertNetlifyBindingSite(binding, await client.getSite(binding.site_id));
    return client;
  } catch (error) {
    const code = errorCode(error);
    const next = code === "NETLIFY_REAUTHORIZATION_REQUIRED" ? "reauthorization_required"
      : /NETLIFY_SITE_.*(?:MISMATCH|INVALID)/u.test(code) ? "reverification_required" : null;
    if (next && binding.status !== next) {
      await setStaticBindingStatus(binding.status, next, { errorCode: code,
        errorSummary: next === "reauthorization_required" ? "Netlify 需要重新授权" : "Netlify Site 身份需要重新核验" });
    }
    throw normalizeError(error);
  }
}
function assertDeployIdentity(deploy: NetlifyDeploy, siteId: string) {
  if (deploy.site_id !== siteId) throw new StaticPublishError("NETLIFY_DEPLOY_SITE_MISMATCH", "Deploy 不属于已绑定 Site");
}
function validatedDeployPermalink(deploy: NetlifyDeploy) {
  const value = deploy.permalink ?? deploy.deploy_ssl_url;
  if (!value) throw new StaticPublishError("NETLIFY_DEPLOY_PERMALINK_MISSING", "Deploy 缺少不可变地址");
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".netlify.app") || url.pathname !== "/" || url.search || url.hash) {
    throw new StaticPublishError("NETLIFY_DEPLOY_PERMALINK_INVALID", "Deploy 不可变地址无效");
  }
  return url.toString();
}
function validatedProductionUrl(value: string | null) {
  if (!value) throw new StaticPublishError("NETLIFY_PRODUCTION_URL_MISSING", "固定 Netlify 地址尚未冻结");
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".netlify.app") || url.pathname !== "/" || url.search || url.hash) {
    throw new StaticPublishError("NETLIFY_PRODUCTION_URL_INVALID", "固定 Netlify 地址无效");
  }
  return url.toString();
}
async function readJsonEvidence<T>(baseUrl: string, file: string): Promise<JsonEvidence<T>> {
  const url = new URL(file, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const response = await fetch(url, { redirect: "error", cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new StaticPublishError("STATIC_ARTIFACT_READBACK_FAILED", "静态制品读回失败", 503);
  const text = await response.text();
  const bytes = new TextEncoder().encode(text);
  try { return { value: JSON.parse(text) as T, text, sha256: await sha256Hex(bytes), providerSha1: await sha1Hex(bytes), byteSize: bytes.byteLength }; }
  catch { throw new StaticPublishError("STATIC_ARTIFACT_JSON_INVALID", "静态制品无法解析"); }
}
function parseArtifactManifest(value: string | null) {
  try {
    const parsed = JSON.parse(requiredValue(value, "制品清单")) as ArtifactManifest;
    if (!Array.isArray(parsed.files)) throw new Error("invalid");
    return parsed;
  } catch { throw new StaticPublishError("STATIC_ARTIFACT_MANIFEST_INVALID", "已保存的制品清单无效"); }
}
async function failJob(job: StaticPublishJobRow, error: unknown) {
  const latest = await getStaticPublishJob(job.id);
  if (!latest || new Set(["PUBLISHED", "FAILED_RETRYABLE", "FAILED_FINAL", "ROLLED_BACK"]).has(latest.status)) return;
  const final = error instanceof StaticArtifactError || (error instanceof StaticPublishError && /IDENTITY|MISMATCH|INVALID|AMBIGUOUS/u.test(error.code));
  await transitionStaticJob(latest.id, latest.status, final ? "FAILED_FINAL" : "FAILED_RETRYABLE", latest.phase, {
    errorCode: errorCode(error), errorSummary: final ? "制品或身份核验失败，上一正式站保持不变" : "操作未完成，可在确认远端状态后重试",
  });
  if (error instanceof NetlifyClientError && error.code === "NETLIFY_REAUTHORIZATION_REQUIRED") {
    const binding = await getStaticSiteBinding();
    if (binding && binding.status !== "reauthorization_required") {
      await setStaticBindingStatus(binding.status, "reauthorization_required", { errorCode: error.code, errorSummary: "Netlify 需要重新授权" });
    }
  }
}
function isTerminalFailedDeploy(deploy: NetlifyDeploy) { return new Set(["error", "failed", "canceled", "cancelled"]).has(deploy.state); }
function requiredValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined || value === "") throw new StaticPublishError("STATIC_EVIDENCE_MISSING", `${label}缺失`);
  return value;
}
function normalizePath(path: string) { return path.replaceAll("\\", "/").replace(/^\/+/, ""); }
function errorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "STATIC_OPERATION_FAILED";
}
function normalizeError(error: unknown) {
  return error instanceof StaticPublishError || error instanceof NetlifyClientError || error instanceof StaticArtifactError
    ? error : new StaticPublishError("STATIC_OPERATION_FAILED", "静态发布操作暂时失败", 503);
}
async function writeFailureAudit(actorEmail: string, jobId: string, phase: string, error: unknown) {
  await writeAuditLog({ actorEmail, action: "static_site.operation.failed", targetType: "static_publish_job", targetId: jobId,
    summary: { phase, code: errorCode(error) } });
}
async function shortHash(value: string) { return (await sha256Hex(value)).slice(0, 16); }
