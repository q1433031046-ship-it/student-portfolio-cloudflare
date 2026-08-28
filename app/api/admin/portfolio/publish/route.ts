import { writeAuditLog } from "../../../_lib/audit";
import { cleanupUnreferencedMedia } from "../../../_lib/media-cleanup";
import { publishPortfolio } from "../../../_lib/portfolio-store";
import { isRequestBodyError, readJsonBody } from "../../../_lib/request-body";
import { requirePortfolioManager } from "../../../_lib/site-ownership";

export async function POST(request: Request) {
  try {
    const access = await requirePortfolioManager(request);
    if (access instanceof Response) return access;
    const { identity } = access;
    const body = await readJsonBody(request, 8_192);
    if (!isRecord(body) || !Number.isInteger(body.revision)) return Response.json({ error: "缺少有效的修订号" }, { status: 400 });

    const published = await publishPortfolio(Number(body.revision));
    if (!published) return Response.json({ error: "草稿已变化，请刷新后再发布" }, { status: 409 });
    await writeAuditLog({
      actorEmail: identity.user,
      action: "portfolio.published",
      targetType: "portfolio",
      targetId: published.id,
      summary: { revision: published.revision, projects: published.draft.projects.length },
    });
    try {
      await cleanupUnreferencedMedia(published.draft);
    } catch (error) {
      console.error(JSON.stringify({ message: "unreferenced media cleanup failed", error: errorMessage(error) }));
    }
    return Response.json({ ok: true, revision: published.revision, publishedAt: published.publishedAt });
  } catch (error) {
    if (isRequestBodyError(error)) return Response.json({ error: error.message }, { status: error.status });
    console.error(JSON.stringify({ message: "portfolio publish failed", error: errorMessage(error) }));
    return Response.json({ error: "发布失败，请稍后重试" }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
