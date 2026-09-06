import { getPortfolioDb } from "./portfolio-store";
import { PagesError, type PagesFile } from "./pages-client";

export type PagesSite = { id: string; project: string; production_branch: string; production_url: string; current_job: string | null; previous_job: string | null; current_deploy: string | null; previous_deploy: string | null; public_revision: number; last_success_at: string | null };
export type PagesJob = { id: string; source_revision: number; candidate_json: string; candidate_hash: string; template_hash: string; artifact_hash: string | null; status: string; lock_token: string | null; lock_until: number; preview_attempted: number; production_attempted: number; preview_id: string | null; preview_url: string | null; production_id: string | null; production_url: string | null; lookup_count: number; error_code: string | null; error_summary: string | null; created_at: string; completed_at: string | null };
export type PagesFileRow = { job_id: string; path: string; byte_size: number; content_type: string; inline_base64: string | null; object_key: string | null; storage_backend: string | null; source_etag: string | null; sha256: string | null; asset_key: string | null; uploaded: number; upload_attempts: number; preview_verified:number; production_verified:number; canonical_verified:number };
export const getPagesSite = () => getPortfolioDb().prepare("SELECT * FROM pages_site WHERE id='default'").first<PagesSite>();
export const getPagesJob = (id: string) => getPortfolioDb().prepare("SELECT * FROM pages_jobs WHERE id=?").bind(id).first<PagesJob>();
export const getActivePagesJob = () => getPortfolioDb().prepare("SELECT * FROM pages_jobs WHERE status NOT IN ('PUBLISHED','FAILED_FINAL') ORDER BY created_at DESC LIMIT 1").first<PagesJob>();
export async function getPagesFiles(id: string) { return (await getPortfolioDb().prepare("SELECT * FROM pages_files WHERE job_id=? ORDER BY path").bind(id).all<PagesFileRow>()).results; }
export function asPagesFile(row: PagesFileRow): PagesFile { if (!row.sha256 || !row.asset_key) throw new PagesError("PAGES_FILE_UNHASHED", "静态文件尚未核验"); return { path: row.path, byteSize: row.byte_size, contentType: row.content_type, sha256: row.sha256, key: row.asset_key }; }
export async function pagesView() {
  const [site, job] = await Promise.all([getPagesSite(), getActivePagesJob()]);
  return { configured: Boolean(site), status: job ? "publishing" : site?.current_deploy ? "published" : site ? "configured" : "unconfigured",
    productionUrl: site?.current_deploy ? site.production_url : null, publicRevision: site?.public_revision ?? 0,
    activeJob: job && job.status!=="FAILED_RETRYABLE" ? { id:job.id,status:job.status,phase:job.status,previewUrl:job.status === "ARTIFACT_VERIFIED" ? job.preview_url : null } : null,
    retryableJob:job?.status==="FAILED_RETRYABLE"?{id:job.id,status:job.status,phase:job.status}:null,lastSuccessAt:site?.last_success_at ?? null,lastError:job?.error_code ? {code:job.error_code,summary:job.error_summary}:null,
    mediaTotalBytes:Number((await getPortfolioDb().prepare("SELECT COALESCE(SUM(byte_size),0) total FROM portfolio_media WHERE status='uploaded'").first<{total:number}>())?.total ?? 0),qrAvailable:Boolean(site?.current_deploy) };
}
export async function claimPagesStep(id: string) {
  const token = crypto.randomUUID(), now = Date.now();
  const result = await getPortfolioDb().prepare("UPDATE pages_jobs SET lock_token=?, lock_until=? WHERE id=? AND lock_until < ? AND status NOT IN ('PUBLISHED','FAILED_FINAL')")
    .bind(token,now+180_000,id,now).run();
  if (result.meta.changes !== 1) throw new PagesError("PAGES_STEP_BUSY", "同一任务正在处理，请稍后读取状态");
  return token;
}
export async function releasePagesStep(id: string, token: string) { await getPortfolioDb().prepare("UPDATE pages_jobs SET lock_token=NULL,lock_until=0 WHERE id=? AND lock_token=?").bind(id,token).run(); }
export async function pagesUpdate(id: string, token: string, values: Record<string, string | number | null>) {
  const allowed = new Set(["status","artifact_hash","preview_attempted","production_attempted","preview_id","preview_url","production_id","production_url","lookup_count","error_code","error_summary","completed_at"]);
  for (const key of Object.keys(values)) if (!allowed.has(key)) throw new Error("Invalid job field");
  const result = await getPortfolioDb().prepare(`UPDATE pages_jobs SET ${Object.keys(values).map(k=>`${k}=?`).join(",")} WHERE id=? AND lock_token=? AND lock_until>?`)
    .bind(...Object.values(values),id,token,Date.now()).run();
  if (result.meta.changes !== 1) throw new PagesError("PAGES_STEP_CONFLICT", "任务锁已变化，停止本步");
}
