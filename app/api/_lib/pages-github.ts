import { PagesError } from './pages-errors';
import { readControl } from './pages-runner-auth';
export const RUNNER_REPOSITORY = 'q1433031046-ship-it/student-portfolio-cloudflare';
export const RUNNER_WORKFLOW = '.github/workflows/pages-publish.yml';
export type SourceIdentity = { head: string; ref: string; template: string };
export type GitHubRun = { id: number; run_attempt: number; workflow_id: number; path: string; head_sha: string; head_branch: string; event: string; display_title: string; status: string; conclusion: string | null; repository: { full_name: string }; head_repository: { full_name: string } };
export const dispatchTitle = (job: string, phase: string, marker: string) => `pages/${job}/${phase}/${marker}`;
export function validateSource(source: SourceIdentity) {
  if (!/^[a-f0-9]{40}$/.test(source.head) || !/^refs\/(tags|heads)\/[A-Za-z0-9_.\/-]+$/.test(source.ref) || source.ref.includes('..') || !/^[a-f0-9]{64}$/.test(source.template)) throw new PagesError('RUNNER_SOURCE', '已审执行源码尚未准确配置', 503);
}
export class PagesGitHub {
  constructor(private token: string, private send: typeof fetch = fetch) {}
  private async request(path: string, method = 'GET', body?: unknown) {
    if (!this.token) throw new PagesError('RUNNER_UNCONFIGURED', 'GitHub派发凭据尚未配置', 503);
    let response: Response;
    try { response = await this.send(`https://api.github.com/repos/${RUNNER_REPOSITORY}/actions/${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'portfolio-pages-runner', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new PagesError('GITHUB_RESPONSE_UNKNOWN', '原派发结果待核对，不自动重发', 503); }
    if (!response.ok) { await response.body?.cancel(); throw new PagesError('GITHUB_REQUEST_FAILED', 'GitHub请求未完成，保留原尝试', 503); }
    if (response.status === 204 || (method === 'POST' && response.status === 201)) { await response.body?.cancel(); return null; }
    return JSON.parse(new TextDecoder().decode(await readControl(new Request('https://local.invalid', { method: 'POST', body: response.body, duplex: 'half' } as RequestInit))));
  }
  async dispatch(job: string, phase: string, marker: string, source: SourceIdentity) {
    validateSource(source);
    await this.request(`workflows/pages-publish.yml/dispatches`, 'POST', { ref: source.ref, inputs: { jobId: job, phase, marker } });
  }
  async verifyRun(runId: string, attempt: number, job: string, phase: string, marker: string, source: SourceIdentity, completed = false): Promise<GitHubRun> {
    validateSource(source);
    const run = await this.request(`runs/${runId}/attempts/${attempt}`) as GitHubRun;
    const workflow = await this.request('workflows/pages-publish.yml') as { id: number; path: string; state: string };
    if (!run || String(run.id) !== runId || run.run_attempt !== attempt || run.workflow_id !== workflow.id || workflow.path !== RUNNER_WORKFLOW || workflow.state !== 'active'
      || run.path !== RUNNER_WORKFLOW || run.head_sha !== source.head || run.head_branch !== source.ref.replace(/^refs\/(heads|tags)\//, '')
      || run.event !== 'workflow_dispatch' || run.repository?.full_name !== RUNNER_REPOSITORY || run.head_repository?.full_name !== RUNNER_REPOSITORY
      || run.display_title !== dispatchTitle(job, phase, marker) || !(completed ? ['completed'] : ['in_progress', 'queued']).includes(run.status)) throw new PagesError('RUNNER_GITHUB_IDENTITY', 'GitHub实际执行身份不符', 403);
    return run;
  }
  async rerun(runId: string) {
    if (!/^\d{1,20}$/.test(runId)) throw new PagesError('RUNNER_RUN', '原执行编号无效');
    await this.request(`runs/${runId}/rerun`, 'POST', { enable_debug_logging: false });
  }
  async runStatus(runId: string) {
    if (!/^\d{1,20}$/.test(runId)) throw new PagesError('RUNNER_RUN', '原执行编号无效');
    const run = await this.request(`runs/${runId}`) as GitHubRun;
    if (String(run.id) !== runId || run.repository?.full_name !== RUNNER_REPOSITORY) throw new PagesError('RUNNER_RUN', '原执行身份不符');
    return run;
  }
  async locate(job: string, phase: string, marker: string, source: SourceIdentity, page = 1) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10) throw new PagesError('RUNNER_LOOKUP_LIMIT', '原执行核验已达上限');
    const result = await this.request(`workflows/pages-publish.yml/runs?event=workflow_dispatch&head_sha=${source.head}&per_page=1&page=${page}`) as { workflow_runs: GitHubRun[] };
    const runs = result.workflow_runs.filter(r => r.display_title === dispatchTitle(job, phase, marker));
    if (runs.length !== 1) throw new PagesError('RUNNER_DISPATCH_UNKNOWN', '无法唯一确认原执行任务，不重复派发');
    return runs[0];
  }
}
