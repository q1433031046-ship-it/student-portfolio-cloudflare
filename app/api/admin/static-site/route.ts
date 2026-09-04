import { advanceStaticPublish, freezeAndTriggerStaticPublish, promoteStaticPublish, retryStaticPublish, rollbackStaticPublish, StaticPublishError } from "../../_lib/static-publish";
import { getActiveStaticPublishJob, getStaticSiteView } from "../../_lib/static-site-store";
import { isRequestBodyError, readJsonBody } from "../../_lib/request-body";
import { requirePortfolioManager } from "../../_lib/site-ownership";

const noStore = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export async function GET(request: Request) {
  const access = await requirePortfolioManager(request);
  if (access instanceof Response) return access;
  try { return Response.json(await getStaticSiteView(), { headers: noStore }); }
  catch (error) { return failure(error, "静态网站状态暂时无法读取"); }
}

export async function POST(request: Request) {
  const access = await requirePortfolioManager(request);
  if (access instanceof Response) return access;
  try {
    const body = await readJsonBody(request, 8_192);
    if (!isRecord(body) || typeof body.action !== "string") return Response.json({ code: "STATIC_ACTION_INVALID", error: "静态网站操作无效" }, { status: 400, headers: noStore });
    if (body.action === "publish") {
      if (!Number.isSafeInteger(body.revision)) return Response.json({ code: "STATIC_REVISION_INVALID", error: "缺少有效的草稿修订号" }, { status: 400, headers: noStore });
      const result = await freezeAndTriggerStaticPublish(Number(body.revision), access.identity.user);
      return Response.json({ ok: true, repeated: result.repeated, job: { id: result.job?.id, status: result.job?.status } }, { status: 202, headers: noStore });
    }
    if (body.action === "retry") {
      if (typeof body.jobId !== "string" || !/^job_[a-f0-9]{32}$/u.test(body.jobId)) return Response.json({ code: "STATIC_JOB_INVALID", error: "静态发布任务无效" }, { status: 400, headers: noStore });
      const result = await retryStaticPublish(body.jobId, access.identity.user);
      return Response.json({ ok: true, waiting: result.waiting, reason: "reason" in result ? result.reason : null,
        job: { id: result.job?.id, status: result.job?.status } }, { status: result.waiting ? 202 : 200, headers: noStore });
    }
    if (body.action === "verify") {
      const active = await getActiveStaticPublishJob();
      if (!active) return Response.json({ code: "STATIC_JOB_NOT_ACTIVE", error: "当前没有待核验的静态发布任务" }, { status: 409, headers: noStore });
      const result = await advanceStaticPublish(active.id, access.identity.user);
      return Response.json({ ok: true, waiting: result.waiting, reason: "reason" in result ? result.reason : null,
        job: { id: result.job?.id, status: result.job?.status } }, { status: result.waiting ? 202 : 200, headers: noStore });
    }
    if (body.action === "promote") {
      if (typeof body.jobId !== "string" || !/^job_[a-f0-9]{32}$/u.test(body.jobId)) return Response.json({ code: "STATIC_JOB_INVALID", error: "静态发布任务无效" }, { status: 400, headers: noStore });
      const result = await promoteStaticPublish(body.jobId, access.identity.user);
      return Response.json({ ok: true, waiting: result.waiting, reason: "reason" in result ? result.reason : null,
        job: { id: result.job?.id, status: result.job?.status } }, { status: result.waiting ? 202 : 200, headers: noStore });
    }
    if (body.action === "rollback") {
      if (typeof body.deployId !== "string" || body.deployId.length < 4 || body.deployId.length > 128) return Response.json({ code: "STATIC_DEPLOY_INVALID", error: "回滚 Deploy 无效" }, { status: 400, headers: noStore });
      const result = await rollbackStaticPublish(body.deployId, access.identity.user);
      return Response.json({ ok: true, status: result?.status, publicRevision: result?.current_public_revision }, { headers: noStore });
    }
    return Response.json({ code: "STATIC_ACTION_INVALID", error: "静态网站操作无效" }, { status: 400, headers: noStore });
  } catch (error) { return failure(error, "静态网站操作失败"); }
}

function failure(error: unknown, fallback: string) {
  if (isRequestBodyError(error)) return Response.json({ code: "STATIC_REQUEST_INVALID", error: error.message }, { status: error.status, headers: noStore });
  if (error instanceof StaticPublishError) return Response.json({ code: error.code, error: error.message }, { status: error.status, headers: noStore });
  const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "STATIC_OPERATION_FAILED";
  const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 503;
  console.error(JSON.stringify({ message: fallback, code }));
  return Response.json({ code, error: fallback }, { status, headers: noStore });
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
