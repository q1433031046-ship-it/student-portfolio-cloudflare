import { writeAuditLog } from "../../../_lib/audit";
import { PortfolioPublishError, publishPortfolio } from "../../../_lib/portfolio-store";
import { isRequestBodyError, readJsonBody } from "../../../_lib/request-body";
import { requirePortfolioManager } from "../../../_lib/site-ownership";

export async function POST(request: Request) {
  try {
    const access = await requirePortfolioManager(request);
    if (access instanceof Response) return access;
    const body = await readJsonBody(request, 8_192);
    if (!isRecord(body) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) {
      return Response.json({ code: "PORTFOLIO_REVISION_INVALID", error: "缺少有效的草稿修订号" }, { status: 400 });
    }
    const expectedRevision = Number(body.revision);
    const published = await publishPortfolio(expectedRevision);
    if (!published) return Response.json({ code: "PORTFOLIO_REVISION_CONFLICT", error: "草稿已变化，请刷新后重试" }, { status: 409 });
    await writeAuditLog({ actorEmail: access.identity.user, action: "portfolio.dynamic_publish.completed", targetType: "portfolio", targetId: published.id,
      summary: { sourceRevision: expectedRevision, revision: published.revision } });
    return Response.json({ ok: true, revision: published.revision, publishedAt: published.publishedAt });
  } catch (error) {
    if (isRequestBodyError(error)) return Response.json({ code: "PORTFOLIO_REQUEST_INVALID", error: error.message }, { status: error.status });
    if (error instanceof PortfolioPublishError) return Response.json({ code: error.code, error: error.message }, { status: error.status });
    console.error(JSON.stringify({ message: "dynamic portfolio publish failed" }));
    return Response.json({ code: "PORTFOLIO_PUBLISH_FAILED", error: "动态发布暂时失败" }, { status: 503 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
