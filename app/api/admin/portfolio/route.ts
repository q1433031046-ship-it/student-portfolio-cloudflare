import { validatePortfolioDocument } from "../../../portfolio/model";
import { writeAuditLog } from "../../_lib/audit";
import { savePortfolioDraft } from "../../_lib/portfolio-store";
import { isRequestBodyError, readJsonBody } from "../../_lib/request-body";
import { requirePortfolioManager } from "../../_lib/site-ownership";

export async function GET(request: Request) {
  try {
    const access = await requirePortfolioManager(request);
    if (access instanceof Response) return access;
    const { identity, record } = access;
    return Response.json({
      identity: { email: identity.kind === "password" ? "网站管理员" : identity.user, provider: identity.kind },
      portfolio: record.draft,
      revision: record.revision,
      updatedAt: record.updatedAt,
      publishedAt: record.publishedAt,
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "admin portfolio read failed", error: errorMessage(error) }));
    return Response.json({ error: "管理数据暂时无法读取" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const access = await requirePortfolioManager(request);
    if (access instanceof Response) return access;
    const { identity } = access;
    const body = await readJsonBody(request, 1_200_000);
    if (!isRecord(body) || !Number.isInteger(body.revision)) {
      return Response.json({ error: "缺少有效的修订号" }, { status: 400 });
    }
    const validation = validatePortfolioDocument(body.portfolio);
    if (!validation.ok) return Response.json({ error: "作品集数据校验失败", details: validation.errors }, { status: 400 });

    const saved = await savePortfolioDraft(validation.value, Number(body.revision));
    if (!saved) return Response.json({ error: "草稿已在其他页面更新，请刷新后再保存" }, { status: 409 });

    await writeAuditLog({
      actorEmail: identity.user,
      action: "portfolio.draft.saved",
      targetType: "portfolio",
      targetId: saved.id,
      summary: { revision: saved.revision, projects: saved.draft.projects.length, categories: saved.draft.categories.length },
    });
    return Response.json({ ok: true, revision: saved.revision, updatedAt: saved.updatedAt });
  } catch (error) {
    if (isRequestBodyError(error)) return Response.json({ error: error.message }, { status: error.status });
    console.error(JSON.stringify({ message: "admin portfolio save failed", error: errorMessage(error) }));
    return Response.json({ error: "保存失败，请稍后重试" }, { status: 500 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
