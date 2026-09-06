import { writeAuditLog } from "../../../_lib/audit";
import { publishPortfolio } from "../../../_lib/portfolio-store";
import { isRequestBodyError, readJsonBody } from "../../../_lib/request-body";
import { requirePortfolioManager } from "../../../_lib/site-ownership";

const noStore = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

/** Publish the Worker-backed dynamic frontend independently. */
export async function POST(request: Request) {
  try {
    const access = await requirePortfolioManager(request);
    if (access instanceof Response) return access;
    const body = await readJsonBody(request, 8_192);
    if (!isRecord(body) || !Number.isSafeInteger(body.revision)) {
      return Response.json({ code: "DYNAMIC_REVISION_INVALID", error: "缺少有效的草稿修订号" }, { status: 400, headers: noStore });
    }
    const revision = Number(body.revision);
    const result = await publishPortfolio(revision);
    if (!result) {
      return Response.json({ code: "DYNAMIC_PUBLISH_CONFLICT", error: "草稿已变化，请刷新后重试" }, { status: 409, headers: noStore });
    }
    await writeAuditLog({ actorEmail: access.identity.user, action: "portfolio.dynamic_publish.completed", targetType: "portfolio",
      targetId: result.id, summary: { sourceRevision: revision, publishedRevision: result.revision } });
    return Response.json({ ok: true, revision: result.revision, publishedAt: result.publishedAt }, { headers: noStore });
  } catch (error) {
    if (isRequestBodyError(error)) return Response.json({ code: "DYNAMIC_REQUEST_INVALID", error: error.message }, { status: error.status, headers: noStore });
    console.error(JSON.stringify({ message: "dynamic portfolio publish failed", error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ code: "DYNAMIC_OPERATION_FAILED", error: "动态前台发布失败，请稍后重试" }, { status: 503, headers: noStore });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
