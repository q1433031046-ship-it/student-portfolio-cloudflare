import { getPortfolioDb } from "./portfolio-store";
import type { FrozenStaticCandidate } from "./static-site-contract";

export const STATIC_JOB_TERMINAL_STATES = new Set(["PUBLISHED", "FAILED_RETRYABLE", "FAILED_FINAL", "ROLLED_BACK"]);
export const STATIC_JOB_EXPORT_STATES = new Set(["FROZEN", "BUILD_TRIGGERED", "DRAFT_DEPLOY_LOCATED", "DRAFT_DEPLOY_READY"]);

export type StaticJobStatus =
  | "FROZEN" | "BUILD_TRIGGERED" | "DRAFT_DEPLOY_LOCATED" | "DRAFT_DEPLOY_READY"
  | "ARTIFACT_VERIFIED" | "PUBLISH_REQUESTED" | "PRODUCTION_READBACK_VERIFIED" | "PUBLISHED"
  | "FAILED_RETRYABLE" | "FAILED_FINAL" | "ROLLBACK_IN_PROGRESS" | "ROLLED_BACK";

const STATIC_JOB_TRANSITIONS: Record<StaticJobStatus, ReadonlySet<StaticJobStatus>> = {
  FROZEN: new Set(["BUILD_TRIGGERED", "FAILED_RETRYABLE", "FAILED_FINAL"]),
  BUILD_TRIGGERED: new Set(["DRAFT_DEPLOY_LOCATED", "FAILED_RETRYABLE", "FAILED_FINAL"]),
  DRAFT_DEPLOY_LOCATED: new Set(["DRAFT_DEPLOY_READY", "FAILED_RETRYABLE", "FAILED_FINAL"]),
  DRAFT_DEPLOY_READY: new Set(["ARTIFACT_VERIFIED", "FAILED_RETRYABLE", "FAILED_FINAL"]),
  ARTIFACT_VERIFIED: new Set(["PUBLISH_REQUESTED", "FAILED_RETRYABLE", "FAILED_FINAL"]),
  PUBLISH_REQUESTED: new Set(["PRODUCTION_READBACK_VERIFIED", "FAILED_RETRYABLE", "FAILED_FINAL"]),
  PRODUCTION_READBACK_VERIFIED: new Set(["PUBLISHED", "FAILED_RETRYABLE", "FAILED_FINAL"]),
  PUBLISHED: new Set(["ROLLBACK_IN_PROGRESS"]),
  FAILED_RETRYABLE: new Set(["BUILD_TRIGGERED", "DRAFT_DEPLOY_LOCATED", "ARTIFACT_VERIFIED"]),
  FAILED_FINAL: new Set(),
  ROLLBACK_IN_PROGRESS: new Set(["ROLLED_BACK", "FAILED_RETRYABLE"]),
  ROLLED_BACK: new Set(),
};

export type StaticSiteBindingRow = {
  id: string; provider: "netlify"; account_identity_hash: string; site_id: string; site_slug: string;
  production_url: string | null; build_branch: string; expected_commit_sha: string; status: string;
  current_deploy_id: string | null; previous_deploy_id: string | null; current_public_revision: number;
  last_verified_at: string | null; last_error_code: string | null; last_error_summary: string | null;
  created_at: string; updated_at: string; first_published_at: string | null; last_success_at: string | null;
};

export type StaticPublishJobRow = {
  id: string; site_binding_id: string; source_document_revision: number; public_revision: number;
  candidate_json: string; candidate_sha256: string; idempotency_key: string; status: StaticJobStatus; phase: string;
  provider_request_key: string; deploy_id: string | null; deploy_permalink: string | null;
  artifact_manifest_json: string | null; artifact_sha256: string | null; artifact_manifest_file_sha256: string | null;
  export_generation: number; bootstrap_token_sha256: string; bootstrap_expires_at: string; bootstrap_consumed_at: string | null;
  lease_id_sha256: string | null; lease_expires_at: string | null; error_code: string | null; error_summary: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
};

export type StaticPublishMediaRow = {
  job_id: string; media_id: string; object_key: string; public_path: string; content_type: string; byte_size: number;
  storage_backend: "kv" | "r2"; source_etag: string; sha256: string | null; provider_sha1: string | null;
  artifact_verified_at: string | null; status: string;
};

export class StaticStateConflictError extends Error {
  readonly code = "STATIC_STATE_CONFLICT";
  constructor(message = "静态发布状态已变化，请刷新后重试") { super(message); }
}

export async function getStaticSiteBinding() {
  return getPortfolioDb().prepare("SELECT * FROM static_site_bindings WHERE id = 'default' LIMIT 1").first<StaticSiteBindingRow>();
}

export async function getStaticPublishJob(jobId: string) {
  return getPortfolioDb().prepare("SELECT * FROM static_publish_jobs WHERE id = ? LIMIT 1").bind(jobId).first<StaticPublishJobRow>();
}

export async function getPublishedStaticJobByDeploy(deployId: string) {
  return getPortfolioDb().prepare(`SELECT * FROM static_publish_jobs WHERE site_binding_id = 'default'
    AND deploy_id = ? AND status IN ('PUBLISHED','ROLLED_BACK') AND artifact_sha256 IS NOT NULL
    ORDER BY completed_at DESC LIMIT 1`).bind(deployId).first<StaticPublishJobRow>();
}

export async function getActiveStaticPublishJob() {
  return getPortfolioDb().prepare(`SELECT * FROM static_publish_jobs WHERE site_binding_id = 'default'
    AND status NOT IN ('PUBLISHED','FAILED_RETRYABLE','FAILED_FINAL','ROLLED_BACK') ORDER BY created_at DESC LIMIT 1`).first<StaticPublishJobRow>();
}

export async function getLatestStaticPublishJob() {
  return getPortfolioDb().prepare(`SELECT * FROM static_publish_jobs WHERE site_binding_id = 'default'
    ORDER BY created_at DESC LIMIT 1`).first<StaticPublishJobRow>();
}

export async function getStaticSiteView() {
  const [binding, activeJob, latestJob, stats] = await Promise.all([
    getStaticSiteBinding(),
    getActiveStaticPublishJob(),
    getLatestStaticPublishJob(),
    getPortfolioDb().prepare("SELECT COALESCE(SUM(byte_size),0) AS total_bytes FROM portfolio_media WHERE status = 'uploaded'").first<{ total_bytes: number }>(),
  ]);
  return {
    configured: Boolean(binding),
    status: binding?.status ?? "unconfigured",
    productionUrl: Number(binding?.current_public_revision ?? 0) > 0 ? binding?.production_url ?? null : null,
    publicRevision: binding?.current_public_revision ?? 0,
    currentDeployIdHash: binding?.current_deploy_id ? await shortHash(binding.current_deploy_id) : null,
    activeJob: activeJob ? sanitizeJob(activeJob) : null,
    retryableJob: latestJob?.status === "FAILED_RETRYABLE" ? sanitizeJob(latestJob) : null,
    lastSuccessAt: binding?.last_success_at ?? null,
    lastError: latestJob?.error_code ? { code: latestJob.error_code, summary: latestJob.error_summary }
      : binding?.last_error_code ? { code: binding.last_error_code, summary: binding.last_error_summary } : null,
    mediaTotalBytes: Number(stats?.total_bytes ?? 0),
    qrAvailable: Boolean(binding?.production_url) && Number(binding?.current_public_revision ?? 0) > 0,
  };
}

export async function insertFrozenStaticJob(input: {
  jobId: string;
  sourceDocumentRevision: number;
  candidate: FrozenStaticCandidate;
  idempotencyKey: string;
  providerRequestKey: string;
  bootstrapTokenSha256: string;
  bootstrapExpiresAt: string;
  now?: string;
}) {
  const db = getPortfolioDb();
  const binding = await getStaticSiteBinding();
  if (!binding) throw new StaticStateConflictError("尚未配置唯一 Netlify Site");
  const existing = await db.prepare("SELECT * FROM static_publish_jobs WHERE idempotency_key = ? LIMIT 1").bind(input.idempotencyKey).first<StaticPublishJobRow>();
  if (existing) return { job: existing, inserted: false as const };
  if (await getActiveStaticPublishJob()) throw new StaticStateConflictError("已有静态发布正在进行");
  const now = input.now ?? new Date().toISOString();
  const revisionCeiling = await db.prepare("SELECT COALESCE(MAX(public_revision), 0) AS value FROM static_publish_jobs WHERE site_binding_id = 'default'")
    .first<{ value: number }>();
  const publicRevision = Math.max(binding.current_public_revision, Number(revisionCeiling?.value ?? 0)) + 1;
  const statements = [
    db.prepare(`INSERT INTO static_publish_jobs
      (id, site_binding_id, source_document_revision, public_revision, candidate_json, candidate_sha256, idempotency_key,
       status, phase, provider_request_key, export_generation, bootstrap_token_sha256, bootstrap_expires_at, created_at, updated_at)
      SELECT ?, 'default', ?, ?, ?, ?, ?, 'FROZEN', 'freeze', ?, 1, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM portfolio_documents WHERE id = 'default' AND revision = ?)
        AND EXISTS (SELECT 1 FROM static_site_bindings WHERE id = 'default' AND current_public_revision = ?)
        AND NOT EXISTS (SELECT 1 FROM static_publish_jobs WHERE site_binding_id = 'default'
          AND status NOT IN ('PUBLISHED','FAILED_RETRYABLE','FAILED_FINAL','ROLLED_BACK'))`)
      .bind(input.jobId, input.sourceDocumentRevision, publicRevision, input.candidate.canonicalJson, input.candidate.candidateSha256,
        input.idempotencyKey, input.providerRequestKey, input.bootstrapTokenSha256, input.bootstrapExpiresAt, now, now,
        input.sourceDocumentRevision, binding.current_public_revision),
    ...input.candidate.media.map((media) => db.prepare(`INSERT INTO static_publish_job_media
      (job_id, media_id, object_key, public_path, content_type, byte_size, storage_backend, source_etag, status)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'frozen' WHERE changes() = 1`)
      .bind(input.jobId, media.id, media.objectKey, media.publicPath, media.contentType, media.byteSize, media.storageBackend, media.sourceEtag)),
  ];
  const [created] = await db.batch(statements);
  if (Number(created?.meta.changes ?? 0) !== 1) throw new StaticStateConflictError();
  const job = await getStaticPublishJob(input.jobId);
  if (!job) throw new StaticStateConflictError();
  return { job, inserted: true as const };
}

export async function transitionStaticJob(jobId: string, expected: StaticJobStatus, next: StaticJobStatus, phase: string, patch: {
  deployId?: string; deployPermalink?: string; artifactManifestJson?: string; artifactSha256?: string;
  artifactManifestFileSha256?: string; errorCode?: string; errorSummary?: string;
} = {}) {
  assertStaticJobTransition(expected, next);
  const now = new Date().toISOString();
  const complete = STATIC_JOB_TERMINAL_STATES.has(next) ? now : null;
  const result = await getPortfolioDb().prepare(`UPDATE static_publish_jobs SET status = ?, phase = ?, deploy_id = COALESCE(?, deploy_id),
    deploy_permalink = COALESCE(?, deploy_permalink), artifact_manifest_json = COALESCE(?, artifact_manifest_json),
    artifact_sha256 = COALESCE(?, artifact_sha256), artifact_manifest_file_sha256 = COALESCE(?, artifact_manifest_file_sha256),
    error_code = ?, error_summary = ?, updated_at = ?, completed_at = COALESCE(?, completed_at)
    WHERE id = ? AND status = ?`)
    .bind(next, phase, patch.deployId ?? null, patch.deployPermalink ?? null, patch.artifactManifestJson ?? null,
      patch.artifactSha256 ?? null, patch.artifactManifestFileSha256 ?? null, patch.errorCode ?? null,
      patch.errorSummary ?? null, now, complete, jobId, expected).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new StaticStateConflictError();
  return getStaticPublishJob(jobId);
}

export function assertStaticJobTransition(expected: StaticJobStatus, next: StaticJobStatus) {
  if (!STATIC_JOB_TRANSITIONS[expected]?.has(next)) throw new StaticStateConflictError(`非法静态发布状态转换：${expected} → ${next}`);
}

export async function noteStaticJobError(jobId: string, expected: StaticJobStatus, errorCode: string, errorSummary: string) {
  const result = await getPortfolioDb().prepare(`UPDATE static_publish_jobs SET error_code = ?, error_summary = ?, updated_at = ?
    WHERE id = ? AND status = ?`).bind(errorCode, errorSummary, new Date().toISOString(), jobId, expected).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new StaticStateConflictError();
  return getStaticPublishJob(jobId);
}

export async function setStaticBindingStatus(expected: string, next: string, patch: { errorCode?: string; errorSummary?: string } = {}) {
  const now = new Date().toISOString();
  const result = await getPortfolioDb().prepare(`UPDATE static_site_bindings SET status = ?, last_error_code = ?,
    last_error_summary = ?, updated_at = ? WHERE id = 'default' AND status = ?`)
    .bind(next, patch.errorCode ?? null, patch.errorSummary ?? null, now, expected).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new StaticStateConflictError("静态 Site 状态已变化，请刷新后重试");
  return getStaticSiteBinding();
}

export async function restartStaticJobGeneration(input: {
  jobId: string; expectedGeneration: number; providerRequestKey: string; bootstrapTokenSha256: string; bootstrapExpiresAt: string;
}) {
  const now = new Date().toISOString();
  const result = await getPortfolioDb().prepare(`UPDATE static_publish_jobs SET status = 'BUILD_TRIGGERED', phase = 'build',
    provider_request_key = ?, export_generation = export_generation + 1, bootstrap_token_sha256 = ?, bootstrap_expires_at = ?,
    bootstrap_consumed_at = NULL, lease_id_sha256 = NULL, lease_expires_at = NULL, deploy_id = NULL, deploy_permalink = NULL,
    artifact_manifest_json = NULL, artifact_sha256 = NULL, artifact_manifest_file_sha256 = NULL,
    error_code = NULL, error_summary = NULL, completed_at = NULL, updated_at = ?
    WHERE id = ? AND status = 'FAILED_RETRYABLE' AND export_generation = ?`)
    .bind(input.providerRequestKey, input.bootstrapTokenSha256, input.bootstrapExpiresAt, now, input.jobId, input.expectedGeneration).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new StaticStateConflictError();
  return getStaticPublishJob(input.jobId);
}

export async function exchangeBootstrapGrant(input: {
  jobId: string; generation: number; bootstrapDigest: string; leaseIdDigest: string; leaseExpiresAt: string; now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const result = await getPortfolioDb().prepare(`UPDATE static_publish_jobs SET bootstrap_consumed_at = ?, lease_id_sha256 = ?, lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND export_generation = ? AND bootstrap_token_sha256 = ? AND bootstrap_consumed_at IS NULL
      AND bootstrap_expires_at > ? AND status IN ('FROZEN','BUILD_TRIGGERED','DRAFT_DEPLOY_LOCATED','DRAFT_DEPLOY_READY')`)
    .bind(now, input.leaseIdDigest, input.leaseExpiresAt, now, input.jobId, input.generation, input.bootstrapDigest, now).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new StaticStateConflictError("导出启动授权已使用、过期或失效");
  return getStaticPublishJob(input.jobId);
}

export async function getStaticJobMedia(jobId: string) {
  const rows = await getPortfolioDb().prepare("SELECT * FROM static_publish_job_media WHERE job_id = ? ORDER BY public_path ASC").bind(jobId).all<StaticPublishMediaRow>();
  return rows.results ?? [];
}

export async function commitStaticPublishSuccess(input: {
  jobId: string; expectedStatus: "PRODUCTION_READBACK_VERIFIED"; productionUrl: string; deployId: string;
  artifactManifestJson: string; artifactSha256: string; artifactManifestFileSha256: string;
  verifiedMedia: Array<{ mediaId: string; sha256: string; providerSha1: string }>;
}) {
  const job = await getStaticPublishJob(input.jobId);
  const binding = await getStaticSiteBinding();
  if (!job || !binding || job.status !== input.expectedStatus || job.deploy_id !== input.deployId
    || binding.current_public_revision + 1 !== job.public_revision) throw new StaticStateConflictError();
  const now = new Date().toISOString();
  const db = getPortfolioDb();
  const mediaById = new Map(input.verifiedMedia.map((media) => [media.mediaId, media]));
  const frozenMedia = await getStaticJobMedia(input.jobId);
  if (frozenMedia.length !== mediaById.size || frozenMedia.some((media) => !mediaById.has(media.media_id))) {
    throw new StaticStateConflictError("制品媒体证据不完整");
  }
  const statements = [
    db.prepare(`UPDATE static_publish_jobs SET status = 'PUBLISHED', phase = 'commit', artifact_manifest_json = ?, artifact_sha256 = ?,
      artifact_manifest_file_sha256 = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'PRODUCTION_READBACK_VERIFIED' AND deploy_id = ?`)
      .bind(input.artifactManifestJson, input.artifactSha256, input.artifactManifestFileSha256, now, now, input.jobId, input.deployId),
    db.prepare(`UPDATE static_site_bindings SET status = 'published', production_url = COALESCE(production_url, ?),
      previous_deploy_id = current_deploy_id, current_deploy_id = ?, current_public_revision = ?, last_verified_at = ?,
      last_error_code = NULL, last_error_summary = NULL, updated_at = ?, first_published_at = COALESCE(first_published_at, ?), last_success_at = ?
      WHERE id = 'default' AND current_public_revision = ? AND (production_url IS NULL OR production_url = ?)`)
      .bind(input.productionUrl, input.deployId, job.public_revision, now, now, now, now, binding.current_public_revision, input.productionUrl),
    db.prepare(`UPDATE portfolio_documents SET published_json = ?, static_published_source_revision = ?, published_at = ?, updated_at = ?
      WHERE id = 'default' AND revision >= ?`)
      .bind(job.candidate_json, job.source_document_revision, now, now, job.source_document_revision),
    ...frozenMedia.map((media) => {
      const evidence = mediaById.get(media.media_id)!;
      return db.prepare(`UPDATE static_publish_job_media SET sha256 = ?, provider_sha1 = ?, artifact_verified_at = ?, status = 'verified'
        WHERE job_id = ? AND media_id = ? AND status = 'frozen'`)
        .bind(evidence.sha256, evidence.providerSha1, now, input.jobId, media.media_id);
    }),
    db.prepare(`SELECT CASE WHEN
      EXISTS (SELECT 1 FROM static_publish_jobs WHERE id = ? AND status = 'PUBLISHED' AND deploy_id = ? AND artifact_sha256 = ?)
      AND EXISTS (SELECT 1 FROM static_site_bindings WHERE id = 'default' AND status = 'published' AND current_deploy_id = ? AND current_public_revision = ? AND production_url = ?)
      AND EXISTS (SELECT 1 FROM portfolio_documents WHERE id = 'default' AND static_published_source_revision = ?)
      AND (SELECT COUNT(*) FROM static_publish_job_media WHERE job_id = ? AND status = 'verified') = ?
      THEN 1 ELSE abs(-9223372036854775808) END AS committed`)
      .bind(input.jobId, input.deployId, input.artifactSha256, input.deployId, job.public_revision, input.productionUrl,
        job.source_document_revision, input.jobId, frozenMedia.length),
  ];
  let results: D1Result<unknown>[];
  try { results = await db.batch(statements); }
  catch { throw new StaticStateConflictError("静态发布提交未能原子完成，上一公开状态保持不变"); }
  if (results.slice(0, 3).some((result) => Number(result?.meta.changes ?? 0) !== 1)) throw new StaticStateConflictError();
  return getStaticPublishJob(input.jobId);
}

export async function beginStaticRollback(currentDeployId: string, targetDeployId: string) {
  const binding = await getStaticSiteBinding();
  if (!binding || !new Set(["published", "rollback_in_progress"]).has(binding.status) || binding.current_deploy_id !== currentDeployId
    || binding.previous_deploy_id !== targetDeployId) throw new StaticStateConflictError("只能回滚到上一已验证 Deploy");
  const target = await getPublishedStaticJobByDeploy(targetDeployId);
  if (!target?.artifact_sha256) throw new StaticStateConflictError("上一 Deploy 缺少已验证制品证据");
  if (binding.status === "published") await setStaticBindingStatus("published", "rollback_in_progress");
  return { binding: await getStaticSiteBinding(), target };
}

export async function commitStaticRollbackSuccess(input: {
  currentDeployId: string; targetJob: StaticPublishJobRow; productionUrl: string;
}) {
  const target = input.targetJob;
  if (!target.deploy_id || !target.artifact_sha256 || !target.artifact_manifest_json) {
    throw new StaticStateConflictError("回滚目标证据不完整");
  }
  const db = getPortfolioDb();
  const now = new Date().toISOString();
  const statements = [
    db.prepare(`UPDATE static_site_bindings SET status = 'published', current_deploy_id = ?, previous_deploy_id = ?,
      current_public_revision = ?, last_verified_at = ?, last_error_code = NULL, last_error_summary = NULL,
      updated_at = ?, last_success_at = ? WHERE id = 'default' AND status = 'rollback_in_progress'
      AND current_deploy_id = ? AND previous_deploy_id = ? AND production_url = ?`)
      .bind(target.deploy_id, input.currentDeployId, target.public_revision, now, now, now,
        input.currentDeployId, target.deploy_id, input.productionUrl),
    db.prepare(`UPDATE portfolio_documents SET published_json = ?, static_published_source_revision = ?,
      published_at = ?, updated_at = ? WHERE id = 'default' AND revision >= ?`)
      .bind(target.candidate_json, target.source_document_revision, now, now, target.source_document_revision),
    db.prepare(`UPDATE static_publish_jobs SET status = 'ROLLED_BACK', phase = 'rollback', updated_at = ?, completed_at = ?
      WHERE site_binding_id = 'default' AND deploy_id = ? AND status = 'PUBLISHED'`)
      .bind(now, now, input.currentDeployId),
    db.prepare(`UPDATE static_publish_jobs SET status = 'PUBLISHED', phase = 'commit', updated_at = ?, completed_at = ?
      WHERE site_binding_id = 'default' AND deploy_id = ? AND status IN ('PUBLISHED','ROLLED_BACK')`)
      .bind(now, now, target.deploy_id),
    db.prepare(`SELECT CASE WHEN
      EXISTS (SELECT 1 FROM static_site_bindings WHERE id = 'default' AND status = 'published'
        AND current_deploy_id = ? AND previous_deploy_id = ? AND current_public_revision = ? AND production_url = ?)
      AND EXISTS (SELECT 1 FROM portfolio_documents WHERE id = 'default' AND static_published_source_revision = ?)
      THEN 1 ELSE abs(-9223372036854775808) END AS committed`)
      .bind(target.deploy_id, input.currentDeployId, target.public_revision, input.productionUrl, target.source_document_revision),
  ];
  let results: D1Result<unknown>[];
  try { results = await db.batch(statements); }
  catch { throw new StaticStateConflictError("回滚指针未能原子提交，请重新读回固定网址后重试"); }
  if (results.slice(0, 4).some((result) => Number(result?.meta.changes ?? 0) !== 1)) throw new StaticStateConflictError();
  return getStaticSiteBinding();
}

export async function protectMediaKeysForCleanup() {
  const rows = await getPortfolioDb().prepare(`SELECT DISTINCT object_key FROM static_publish_job_media
    WHERE job_id IN (
      SELECT jobs.id FROM static_publish_jobs AS jobs
      WHERE jobs.status NOT IN ('PUBLISHED','FAILED_FINAL','ROLLED_BACK')
        OR jobs.deploy_id IN (
          SELECT current_deploy_id FROM static_site_bindings WHERE id = 'default'
          UNION SELECT previous_deploy_id FROM static_site_bindings WHERE id = 'default'
        )
    )`).all<{ object_key: string }>();
  return new Set((rows.results ?? []).map((row) => row.object_key));
}

function sanitizeJob(job: StaticPublishJobRow) {
  return {
    id: job.id, sourceDocumentRevision: job.source_document_revision, publicRevision: job.public_revision,
    status: job.status, phase: job.phase, deployBound: Boolean(job.deploy_id), createdAt: job.created_at, updatedAt: job.updated_at,
    error: job.error_code ? { code: job.error_code, summary: job.error_summary } : null,
  };
}

async function shortHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
