import { runnerConfig } from '../_lib/pages-runner-config';
import { runnerRequest } from '../_lib/pages-runner-service';
function pausedResponse(): Response { return Response.json({ code: 'STATIC_AUTOMATION_PAUSED', error: '自动静态发布已暂停' }, { status: 423, headers: { 'Cache-Control': 'no-store' } }); }
export async function POST(request: Request) {
  return pausedResponse();
  try { const c = runnerConfig(); return await runnerRequest(request, c.secret, c.state, c.origin); }
  catch { return Response.json({ code: 'RUNNER_UNAVAILABLE', error: '静态执行入口尚未就绪' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
