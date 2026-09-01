import { writeAuditLog } from "../../../_lib/audit";
import { freezeAndTriggerStaticPublish, StaticPublishError } from "../../../_lib/static-publish";
import { isRequestBodyError, readJsonBody } from "../../../_lib/request-body";
import { requirePortfolioManager } from "../../../_lib/site-ownership";

export async function POST(request: Request) {
  try {
    const access = await requirePortfolioManager(request);
    if (access instanceof Response) return access;
    const { identity } = access;
    const body = await readJsonBody(request, 8_192);
    if (!isRecord(body) || !Number.isInteger(body.revision)) return Response.json({ error: "缺少有效的修订号" }, { status: 400 });

    const result = await freezeAndTriggerStaticPublish(Number(body.revision), identity.user);
    await writeAuditLog({ actorEmail: identity.user, action: "portfolio.static_publish.requested", targetType: "static_publish_job",
      targetId: result.job?.id ?? "unknown", summary: { revision: Number(body.revision), repeated: result.repeated } });
    return Response.json({ ok: true, jobId: result.job?.id, status: result.job?.status, repeated: result.repeated }, { status: 202 });
  } catch (error) {
    if (isRequestBodyError(error)) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof StaticPublishError) return Response.json({ code: error.code, error: error.message }, { status: error.status });
    console.error(JSON.stringify({ message: "作品集发布失败", error: errorMessage(error) }));
    return Response.json({ error: "发布失败，请稍后重试" }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
