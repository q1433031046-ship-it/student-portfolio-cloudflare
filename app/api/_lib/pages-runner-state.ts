import { PagesError } from './pages-errors';
import type { RunnerIdentity } from './pages-runner-auth';
import type { SourceIdentity, PagesGitHub } from './pages-github';
export type Phase = 'preview' | 'production';
export type PhaseState = { marker: string; dispatch: 'intent' | 'sent' | 'unknown'; lookups: number; run: string | null; attempt: number; lease: string; expires: number; seq: number; scope: 'execute' | 'recover' | 'read'; rerunAttempt?: number; deployment: { run: string; attempt: number; marker: string } | null; receipt: { digest: string; run: string; attempt: number; result: Record<string, unknown> } | null };
export class RunnerState {
  constructor(readonly db: D1Database, readonly github: PagesGitHub, readonly now = () => Date.now()) {}
  async source(job: string) {
    const source = await this.db.prepare('SELECT head,ref,template FROM pages_runner_sources WHERE job_id=? AND safe_ready=1').bind(job).first<SourceIdentity>();
    if (!source) throw new PagesError('RUNNER_JOB', '安全快照尚未就绪'); return source;
  }
  async read(job: string, phase: Phase) {
    const row = await this.db.prepare('SELECT version,state_json FROM pages_runner_phases WHERE job_id=? AND phase=?').bind(job, phase).first<{ version: number; state_json: string }>();
    if (!row) throw new PagesError('RUNNER_PHASE', '此任务阶段未经管理员许可', 403);
    return { version: row.version, state: JSON.parse(row.state_json) as PhaseState };
  }
  async cas(job: string, phase: Phase, version: number, state: PhaseState) {
    const result = await this.db.prepare('UPDATE pages_runner_phases SET state_json=?,version=version+1 WHERE job_id=? AND phase=? AND version=?').bind(JSON.stringify(state), job, phase, version).run();
    if (result.meta.changes !== 1) throw new PagesError('RUNNER_CAS', '执行状态已变化');
  }
  async createPhase(job: string, phase: Phase) {
    const state: PhaseState = { marker: crypto.randomUUID().replaceAll('-', ''), dispatch: 'intent', lookups: 0, run: null, attempt: 0, lease: '', expires: 0, seq: 0, scope: 'read', deployment: null, receipt: null };
    // A production row can only be created by the authenticated administrator path.
    const [r] = await this.db.batch([this.db.prepare(`INSERT INTO pages_runner_phases(job_id,phase,state_json)
      SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM pages_jobs j JOIN pages_runner_sources s ON s.job_id=j.id WHERE j.id=? AND s.safe_ready=1 AND (?='preview' AND j.status='FROZEN' OR ?='production' AND j.status='ARTIFACT_VERIFIED' AND s.manifest_final=1))
      ON CONFLICT(job_id,phase) DO NOTHING`).bind(job, phase, JSON.stringify(state), job, phase, phase),
      this.db.prepare('UPDATE pages_jobs SET status=? WHERE id=? AND changes()=1').bind(phase === 'production' ? 'PUBLISH_REQUESTED' : 'BUILD_TRIGGERED', job),
    ]);
    if (r.meta.changes !== 1) return false;
    // The durable intent is consumed even when the following request fails or its response is lost.
    try { await this.github.dispatch(job, phase, state.marker, await this.source(job)); state.dispatch = 'sent'; }
    catch { state.dispatch = 'unknown'; }
    // A runner can claim before dispatch returns. Never overwrite its lease.
    await this.cas(job, phase, 0, state).catch(() => undefined); return true;
  }
  async claim(i: RunnerIdentity, readOnly = false) {
    if (i.seq !== 0 || i.lease !== '') throw new PagesError('RUNNER_CLAIM', '领取参数无效');
    const row = await this.read(i.job, i.phase), s = row.state;
    await this.github.verifyRun(i.run, i.attempt, i.job, i.phase, s.marker, await this.source(i.job));
    if (s.run && (s.run !== i.run || i.attempt < s.attempt)) throw new PagesError('RUNNER_RUN_CONFLICT', '只能恢复原GitHub执行');
    if (s.lease && s.expires > this.now()) throw new PagesError('RUNNER_LEASE_BUSY', '原执行租约仍有效');
    if (s.receipt) throw new PagesError('RUNNER_ALREADY_RECEIVED', '此阶段已收到结果');
    const nonce = await this.db.prepare('INSERT OR IGNORE INTO pages_runner_nonces(job_id,phase,nonce) VALUES(?,?,?)').bind(i.job, i.phase, i.nonce).run();
    if (nonce.meta.changes !== 1) throw new PagesError('RUNNER_REPLAY', '领取消息已经使用', 403);
    s.run = i.run; s.attempt = i.attempt; s.lease = crypto.randomUUID(); s.expires = this.now() + 20 * 60_000; s.seq = 0;
    s.scope = readOnly ? 'read' : s.deployment ? 'recover' : 'execute';
    await this.cas(i.job, i.phase, row.version, s);
    return { lease: s.lease, expires: s.expires, scope: s.scope, deployment: s.deployment, source: await this.source(i.job) };
  }
  async consume(i: RunnerIdentity, allowed: Array<PhaseState['scope']>) {
    const row = await this.read(i.job, i.phase), s = row.state;
    if (s.run !== i.run || s.attempt !== i.attempt || s.lease !== i.lease || s.expires <= this.now() || i.seq !== s.seq + 1 || !allowed.includes(s.scope)) throw new PagesError('RUNNER_LEASE', '执行身份、顺序或租约不符', 403);
    // Nonce and sequence both persist; a lost response cannot replay a permission.
    await this.db.batch([
      this.db.prepare('INSERT INTO pages_runner_nonces(job_id,phase,nonce) VALUES(?,?,?)').bind(i.job, i.phase, i.nonce),
      this.db.prepare('UPDATE pages_runner_phases SET state_json=?,version=version+1 WHERE job_id=? AND phase=? AND version=?').bind(JSON.stringify({ ...s, seq: i.seq }), i.job, i.phase, row.version),
      this.db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END AS guarded"),
    ]);
    return { version: row.version + 1, state: { ...s, seq: i.seq } };
  }
  async deploymentPermit(i: RunnerIdentity) {
    const row = await this.consume(i, ['execute']);
    if (row.state.deployment) throw new PagesError('RUNNER_DEPLOYMENT_USED', '唯一部署尝试已使用');
    const job = await this.db.prepare('SELECT artifact_hash FROM pages_jobs j JOIN pages_runner_sources s ON s.job_id=j.id WHERE j.id=? AND s.manifest_final=1').bind(i.job).first<{ artifact_hash: string }>();
    if (!job?.artifact_hash) throw new PagesError('RUNNER_MANIFEST', '完整冻结清单尚未登记');
    row.state.deployment = { run: i.run, attempt: i.attempt, marker: `portfolio:${i.job}:${job.artifact_hash}:${i.phase}` };
    row.state.scope = 'recover';
    await this.cas(i.job, i.phase, row.version, row.state);
    return { send: true, ...row.state.deployment };
  }
  async retryOriginal(job: string, phase: Phase) {
    const row = await this.read(job, phase), s = row.state;
    if (!s.run || s.receipt || s.rerunAttempt === s.attempt) throw new PagesError('RUNNER_RETRY_UNKNOWN', '原执行尚未唯一核定或恢复请求已使用，请只读核对');
    const run = await this.github.verifyRun(s.run, s.attempt, job, phase, s.marker, await this.source(job), true);
    if (!['failure', 'cancelled', 'timed_out', 'action_required', 'success'].includes(run.conclusion ?? '')) throw new PagesError('RUNNER_RETRY_STATE', '原执行尚不适合恢复');
    s.rerunAttempt = s.attempt; s.expires = 0;
    await this.cas(job, phase, row.version, s);
    // Persisted before POST. Unknown receipt cannot authorize another rerun of this attempt.
    await this.github.rerun(s.run);
  }
}
