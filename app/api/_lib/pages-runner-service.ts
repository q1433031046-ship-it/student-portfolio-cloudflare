import { authenticateControl, type RunnerIdentity } from './pages-runner-auth';
import { PagesError } from './pages-errors';
import { RunnerState, type PhaseState } from './pages-runner-state';
import { safeSnapshotPage } from './pages-free-freeze';
import { rawFrozenBlock } from './pages-raw-block';

const json = (value: unknown) => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
const digestPattern = /^[a-f0-9]{64}$/;
type ManifestRow = { path: string; byteSize: number; contentType: string; sha256: string; key: string; control?: string };
function manifestRow(value: unknown): asserts value is ManifestRow {
  const r = value as ManifestRow;
  if (!r || typeof r.path !== 'string' || r.path.length > 240 || !/^[A-Za-z0-9_./-]+$/.test(r.path) || r.path.split('/').some(p => !p || p === '.' || p === '..')
    || !Number.isSafeInteger(r.byteSize) || r.byteSize < 0 || r.byteSize > 25 * 1024 * 1024 || !digestPattern.test(r.sha256) || !/^[a-f0-9]{32}$/.test(r.key)
    || typeof r.contentType !== 'string' || r.contentType.length > 128 || (r.control !== undefined && (!['_headers', '_redirects'].includes(r.path) || r.control.length > 8192 || !/^[A-Za-z0-9+/]*={0,2}$/.test(r.control)))) throw new PagesError('RUNNER_MANIFEST_ROW', '冻结文件记录无效');
}
export async function runnerRequest(request: Request, secret: string, state: RunnerState, adminOrigin: string) {
  try {
    const { identity: i, body, digest } = await authenticateControl(request, secret, state.now()), a = body.args;
    if (i.op === 'claim') return json(await state.claim(i, a.readOnly === true));
    if (i.op === 'deployment-permit') return json(await state.deploymentPermit(i));
    if (i.op === 'receipt') return json(await receipt(state, i, a, digest));
    const readOps = ['snapshot', 'media', 'block', 'manifest', 'status'];
    const allowed: Array<PhaseState['scope']> = readOps.includes(i.op) ? ['read', 'execute', 'recover'] : i.op === 'report-stop' ? ['execute', 'recover'] : ['execute'];
    const consumed = await state.consume(i, allowed);
    const db = state.db;
    const mutationGuard = () => db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM pages_runner_phases WHERE job_id=? AND phase=? AND version=? AND json_extract(state_json,'$.expires')>?) THEN 1 ELSE abs(-9223372036854775808) END AS lease_guard`).bind(i.job, i.phase, consumed.version, state.now());
    if (i.op === 'report-stop') {
      await db.batch([mutationGuard(), db.prepare("UPDATE pages_jobs SET status='FAILED_RETRYABLE',error_code='RUNNER_STOPPED',error_summary=? WHERE id=? AND status NOT IN ('PUBLISHED','ARTIFACT_VERIFIED')")
        .bind(i.phase === 'production' ? '正式执行已停止；固定网址可能已变化，恢复只核对原部署。' : '预览执行已停止；恢复原任务并保留已用部署尝试。', i.job)]);
      return json({ recorded: true });
    }
    if (i.op === 'snapshot') {
      if (i.phase !== 'preview') throw new PagesError('RUNNER_PHASE_SCOPE', '生产只读取冻结预览包');
      return json(await safeSnapshotPage(db, i.job, Number(a.page)));
    }
    if (i.op === 'block') {
      if (i.phase !== 'preview') throw new PagesError('RUNNER_PHASE_SCOPE', '生产不读取原始媒体');
      return await rawFrozenBlock(db, i.job, Number(a.file), Number(a.block));
    }
    if (i.op === 'media' || i.op === 'manifest') {
      const page = Number(a.page); if (!Number.isSafeInteger(page) || page < 0 || page >= 1000) throw new PagesError('RUNNER_PAGE', '清单页无效');
      const mediaOnly = i.op === 'media';
      const result = await db.prepare(`SELECT path,byte_size byteSize,content_type contentType,sha256,asset_key key,inline_base64 control FROM pages_files WHERE job_id=? ${mediaOnly ? 'AND object_key IS NOT NULL' : 'AND sha256 IS NOT NULL'} ORDER BY path LIMIT 20 OFFSET ?`).bind(i.job, page * 20).all();
      return json({ files: result.results, offset: page * 20 });
    }
    if (i.op === 'status') {
      const job = await db.prepare('SELECT id,source_revision,candidate_hash,template_hash,artifact_hash,status,preview_id,preview_url FROM pages_jobs WHERE id=?').bind(i.job).first();
      const site = await db.prepare("SELECT project,production_branch,production_url FROM pages_site WHERE id='default'").first();
      return json({ job, site, adminUrl: `${adminOrigin}/admin`, phase: (await state.read(i.job, i.phase)).state });
    }
    if (i.op === 'manifest-register') {
      if (i.phase !== 'preview' || !Array.isArray(a.files) || a.files.length < 1 || a.files.length > 20) throw new PagesError('RUNNER_MANIFEST', '登记页无效');
      a.files.forEach(manifestRow);
      const source = await db.prepare('SELECT manifest_final FROM pages_runner_sources WHERE job_id=?').bind(i.job).first<{ manifest_final: number }>();
      if (!source || source.manifest_final) throw new PagesError('RUNNER_MANIFEST_FROZEN', '清单已经冻结');
      const statements: D1PreparedStatement[] = [mutationGuard()];
      for (const r of a.files as ManifestRow[]) {
        // Upsert only unhashed rows and preserve internal source keys and reference identity.
        statements.push(db.prepare(`INSERT INTO pages_files(job_id,path,byte_size,content_type,sha256,asset_key,inline_base64)
          SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM pages_files WHERE job_id=? AND path=? AND (sha256 IS NOT NULL OR byte_size!=? OR content_type!=?))
          AND (? NOT LIKE 'media/%' OR EXISTS(SELECT 1 FROM pages_files WHERE job_id=? AND path=? AND object_key IS NOT NULL))
          ON CONFLICT(job_id,path) DO UPDATE SET sha256=excluded.sha256,asset_key=excluded.asset_key,inline_base64=excluded.inline_base64 WHERE pages_files.sha256 IS NULL`)
          .bind(i.job, r.path, r.byteSize, r.contentType, r.sha256, r.key, r.control ?? null, i.job, r.path, r.byteSize, r.contentType, r.path, i.job, r.path));
        statements.push(db.prepare('SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END AS registered'));
      }
      await db.batch(statements); return json({ registered: a.files.length });
    }
    if (i.op === 'manifest-finalize') {
      if (i.phase !== 'preview' || !digestPattern.test(String(a.artifact)) || !digestPattern.test(String(a.candidate)) || !Number.isSafeInteger(a.count) || Number(a.count) < 3 || Number(a.count) > 20000) throw new PagesError('RUNNER_MANIFEST', '清单总摘要无效');
      const source = await state.source(i.job); if (a.template !== source.template) throw new PagesError('RUNNER_TEMPLATE', '模板身份不符');
      await db.batch([
        mutationGuard(),
        db.prepare(`UPDATE pages_runner_sources SET manifest_final=1,manifest_count=? WHERE job_id=? AND manifest_final=0
          AND (SELECT COUNT(*) FROM pages_files WHERE job_id=?)=? AND NOT EXISTS(SELECT 1 FROM pages_files WHERE job_id=? AND sha256 IS NULL)
          AND EXISTS(SELECT 1 FROM pages_files WHERE job_id=? AND path='_headers' AND inline_base64 IS NOT NULL)
          AND EXISTS(SELECT 1 FROM pages_files WHERE job_id=? AND path='data/portfolio.json') AND EXISTS(SELECT 1 FROM pages_files WHERE job_id=? AND path='index.html')`)
          .bind(Number(a.count), i.job, i.job, Number(a.count), i.job, i.job, i.job, i.job),
        db.prepare('SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END AS finalized'),
        db.prepare("UPDATE pages_jobs SET artifact_hash=?,candidate_hash=?,status='BUILD_TRIGGERED' WHERE id=?").bind(String(a.artifact), String(a.candidate), i.job),
      ]); return json({ frozen: true });
    }
    if (i.op === 'asset-permit') {
      const [, result] = await db.batch([mutationGuard(), db.prepare(`UPDATE pages_files SET upload_attempts=upload_attempts+1 WHERE job_id=? AND path=? AND upload_attempts<2 AND sha256 IS NOT NULL`).bind(i.job, String(a.path))]);
      if (result.meta.changes !== 1) throw new PagesError('RUNNER_ASSET_ATTEMPTS', '资产尝试次数已用完');
      return json({ send: true });
    }
    throw new PagesError('RUNNER_OPERATION', '执行操作无效', 400);
  } catch (error) {
    const known = error instanceof PagesError ? error : new PagesError('RUNNER_REJECTED', '本次控制操作未完成，保留原状态', 409);
    return jsonError(known);
  }
}
function jsonError(error: PagesError) { return Response.json({ code: error.code, error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } }); }
async function receipt(state: RunnerState, i: RunnerIdentity, a: Record<string, unknown>, digest: string) {
  const previous = await state.read(i.job, i.phase);
  if (previous.state.receipt) {
    const r = previous.state.receipt;
    if (r.digest === digest && r.run === i.run && r.attempt === i.attempt) return r.result;
    throw new PagesError('RUNNER_RECEIPT_CONFLICT', '此阶段结果已冻结，拒绝不同回执');
  }
  const row = await state.consume(i, ['recover']);
  if (!row.state.deployment) throw new PagesError('RUNNER_NO_ATTEMPT', '此阶段没有部署尝试');
  const job = await state.db.prepare('SELECT artifact_hash FROM pages_jobs WHERE id=?').bind(i.job).first<{ artifact_hash: string }>();
  if (!job || a.artifact !== job.artifact_hash || a.marker !== row.state.deployment.marker || a.phase !== i.phase || a.verified !== true
    || typeof a.id !== 'string' || !/^[a-f0-9-]{8,64}$/.test(a.id) || typeof a.url !== 'string' || !/^https:\/\/[a-f0-9]+\.zkyl-student-showcase\.pages\.dev$/.test(a.url)) throw new PagesError('RUNNER_RECEIPT', '回执与冻结部署不符');
  const result = { accepted: true, id: a.id, url: a.url, artifact: a.artifact, phase: i.phase };
  row.state.receipt = { digest, run: i.run, attempt: i.attempt, result };
  const db = state.db, production = i.phase === 'production', now = new Date(state.now()).toISOString();
  await db.batch([
    db.prepare('UPDATE pages_runner_phases SET state_json=?,version=version+1 WHERE job_id=? AND phase=? AND version=?').bind(JSON.stringify(row.state), i.job, i.phase, row.version),
    db.prepare('SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END AS received'),
    db.prepare(production ? "UPDATE pages_jobs SET production_id=?,production_url=?,status='PUBLISHED',completed_at=?,error_code=NULL,error_summary=NULL WHERE id=?" : "UPDATE pages_jobs SET preview_id=?,preview_url=?,status='ARTIFACT_VERIFIED',completed_at=?,error_code=NULL,error_summary=NULL WHERE id=?").bind(a.id, a.url, now, i.job),
    ...(production ? [db.prepare("UPDATE pages_site SET previous_job=current_job,previous_deploy=current_deploy,current_job=?,current_deploy=?,public_revision=public_revision+1,last_success_at=? WHERE id='default' AND current_job IS NOT ?").bind(i.job, a.id, now, i.job)] : []),
  ]);
  return result;
}
