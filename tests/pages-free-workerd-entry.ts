import { env } from 'cloudflare:workers';
import { PagesGitHub, RUNNER_REPOSITORY, RUNNER_WORKFLOW, dispatchTitle } from '../app/api/_lib/pages-github';
import { RunnerState } from '../app/api/_lib/pages-runner-state';
import { runnerRequest } from '../app/api/_lib/pages-runner-service';
import { freezeSafeSnapshot } from '../app/api/_lib/pages-free-freeze';
import { createDefaultPortfolioDocument } from '../app/portfolio/default-document';
import { requirePagesManager } from '../app/api/_lib/pages-admin-auth';
declare const __FIXTURE_TEMPLATE_IDENTITY__: string;
const source = { head: 'a'.repeat(40), ref: 'refs/tags/local-fixture', template: __FIXTURE_TEMPLATE_IDENTITY__ };
const secret = 'local-fixture-only-not-a-real-secret';
const worker = { async fetch(request: Request) {
  const db = (env as unknown as { DB: D1Database }).DB;
  const github = new PagesGitHub('local-fixture', async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== 'api.github.com') throw new Error('unexpected host');
    if (url.pathname.endsWith('/dispatches')) {
      const body = JSON.parse(String(init?.body));
      await db.prepare('INSERT INTO fixture_dispatches(body) VALUES(?)').bind(JSON.stringify(body)).run();
      // Simulates GitHub accepted-but-response-lost; durable intent must prevent another POST.
      throw new Error('accepted response lost');
    }
    if (url.pathname.endsWith('/workflows/pages-publish.yml')) return Response.json({ id: 9, path: RUNNER_WORKFLOW, state: 'active' });
    if (url.pathname.endsWith('/rerun')) { await db.prepare("INSERT INTO fixture_dispatches(body) VALUES('rerun')").run(); return new Response(null, { status: 201 }); }
    const row = await db.prepare('SELECT job_id,phase,state_json FROM pages_runner_phases ORDER BY rowid DESC LIMIT 1').first<{ job_id: string; phase: string; state_json: string }>();
    if (!row) throw new Error('phase missing');
    const run = url.pathname.match(/runs\/(\d+)\/attempts\/(\d+)/);
    const completed = JSON.parse(row.state_json).fixtureCompleted === true;
    return Response.json({ id: Number(run?.[1]), run_attempt: Number(run?.[2]), workflow_id: 9, path: RUNNER_WORKFLOW, head_sha: run?.[1] === '999' ? 'c'.repeat(40) : source.head, head_branch: 'local-fixture', event: 'workflow_dispatch', display_title: dispatchTitle(row.job_id, row.phase, JSON.parse(row.state_json).marker), repository: { full_name: RUNNER_REPOSITORY }, head_repository: { full_name: RUNNER_REPOSITORY }, status: completed ? 'completed' : 'in_progress', conclusion: completed ? 'cancelled' : null });
  });
  const state = new RunnerState(db, github);
  if (new URL(request.url).pathname === '/manager') { const access = await requirePagesManager(request); return access instanceof Response ? access : Response.json({ authorized: true }); }
  if (new URL(request.url).pathname === '/api/pages-runner') return runnerRequest(request, secret, state, 'https://worker.example.test');
  try {
    const body = await request.json() as { op: string; id: string; phase: 'preview' | 'production' };
    if (body.op === 'default') return Response.json(createDefaultPortfolioDocument());
    if (body.op === 'freeze') return Response.json({ id: await freezeSafeSnapshot(db, 1, source) });
    if (body.op === 'dispatch') return Response.json({ created: await state.createPhase(body.id, body.phase) });
    if (body.op === 'retry') { await state.retryOriginal(body.id, body.phase); return Response.json({ retried: true }); }
    return new Response('missing', { status: 404 });
  } catch (error) { return Response.json({ error: String(error), cause: String((error as Error & { cause?: unknown }).cause) }, { status: 409 }); }
} };
export default worker;
