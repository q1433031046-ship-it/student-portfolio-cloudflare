import { PagesError } from './pages-errors';
import { runnerConfig } from './pages-runner-config';
import { freezeSafeSnapshot } from './pages-free-freeze';
import { getPagesSite, getPagesJobSummary } from './pages-store';
import { writeAuditLog } from './audit';
export { PagesError as StaticPublishError } from './pages-errors';
function rejectAutomaticPublish(): void { throw new PagesError('STATIC_AUTOMATION_PAUSED', '自动静态发布已暂停，请下载完整静态包后手动上传', 423); }
export async function freezeAndTriggerStaticPublish(revision: number, actor: string) {
  rejectAutomaticPublish();
  const c = runnerConfig(), site = await getPagesSite();
  if (!site || site.project !== 'zkyl-student-showcase' || site.production_url !== 'https://zkyl-student-showcase.pages.dev' || !site.production_branch) throw new PagesError('PAGES_UNCONFIGURED', '唯一Pages项目尚未准确配置');
  const id = await freezeSafeSnapshot(c.db, revision, c.source);
  await c.state.createPhase(id, 'preview');
  await writeAuditLog({ actorEmail: actor, action: 'pages.freeze.dispatch', targetType: 'pages_job', targetId: id, summary: { sourceRevision: revision } });
  return { job: await getPagesJobSummary(id), repeated: false };
}
export async function advanceStaticPublish(id: string, _actor: string) {
  rejectAutomaticPublish();
  void _actor;
  const c = runnerConfig(), job = await getPagesJobSummary(id);
  if (!job) throw new PagesError('PAGES_JOB_MISSING', '任务不存在');
  if (['PUBLISHED', 'ARTIFACT_VERIFIED'].includes(job.status)) return { job, waiting: false };
  const production = await c.db.prepare("SELECT 1 found FROM pages_runner_phases WHERE job_id=? AND phase='production'").bind(id).first();
  const phase = production ? 'production' : 'preview';
  if (!production && !await c.db.prepare("SELECT 1 found FROM pages_runner_phases WHERE job_id=? AND phase='preview'").bind(id).first()) await c.state.createPhase(id, 'preview');
  const row = await c.state.read(id, phase);
  if (!row.state.run && row.state.lookups < 10) {
    row.state.lookups++;
    await c.state.cas(id, phase, row.version, row.state);
    const run = await c.state.github.locate(id, phase, row.state.marker, await c.state.source(id), row.state.lookups);
    if (run.head_sha !== (await c.state.source(id)).head) throw new PagesError('RUNNER_GITHUB_IDENTITY', '原执行源码不符');
    const latest = await c.state.read(id, phase);
    if (!latest.state.run) { latest.state.run = String(run.id); latest.state.attempt = run.run_attempt; await c.state.cas(id, phase, latest.version, latest.state); }
  }
  const original = (await c.state.read(id, phase)).state;
  if (original.run && !original.receipt) {
    const run = await c.state.github.runStatus(original.run);
    if (run.status === 'completed') await c.db.prepare("UPDATE pages_jobs SET status='FAILED_RETRYABLE',error_code='RUNNER_STOPPED',error_summary=? WHERE id=? AND status NOT IN ('PUBLISHED','ARTIFACT_VERIFIED')")
      .bind(phase === 'production' ? '原正式执行已停止；固定网址可能已变化，请恢复原执行只读核定。' : '原预览执行已停止；可恢复原执行，保留已用部署尝试。', id).run();
  }
  return { job: await getPagesJobSummary(id), waiting: true };
}
export async function promoteStaticPublish(id: string, actor: string) {
  rejectAutomaticPublish();
  const c = runnerConfig();
  const created = await c.state.createPhase(id, 'production');
  if (!created) throw new PagesError('PAGES_PROMOTION_USED', '正式许可已存在或预览未验证；请核验原任务');
  await c.db.prepare("UPDATE pages_jobs SET status='PUBLISH_REQUESTED' WHERE id=? AND status='ARTIFACT_VERIFIED'").bind(id).run();
  await writeAuditLog({ actorEmail: actor, action: 'pages.production.dispatch', targetType: 'pages_job', targetId: id, summary: {} });
  return { job: await getPagesJobSummary(id), waiting: true };
}
export async function retryStaticPublish(id: string, actor: string) {
  rejectAutomaticPublish();
  const c = runnerConfig();
  const production = await c.db.prepare("SELECT 1 found FROM pages_runner_phases WHERE job_id=? AND phase='production'").bind(id).first();
  await c.state.retryOriginal(id, production ? 'production' : 'preview');
  await c.db.prepare('UPDATE pages_jobs SET status=?,error_code=NULL,error_summary=NULL WHERE id=? AND status=\'FAILED_RETRYABLE\'').bind(production ? 'PUBLISH_REQUESTED' : 'BUILD_TRIGGERED', id).run();
  return advanceStaticPublish(id, actor);
}
export async function rollbackStaticPublish() { throw new PagesError('PAGES_ROLLBACK_REVIEW_REQUIRED', '正式站点回滚由发布角色核定准确版本后执行'); }
