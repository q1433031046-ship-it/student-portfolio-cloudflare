import { getPublishedPortfolio } from "../_lib/portfolio-store";
import { toPublicPortfolioDocument } from "../../portfolio/model";
import { checkPortfolioAccess } from "../_lib/portfolio-access";

const noCacheHeaders = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export async function GET(request: Request) {
  try {
    const access = await checkPortfolioAccess(request);
    if (!access.allowed) return Response.json({ error: "需要有效的二维码访问" }, { status: 403, headers: noCacheHeaders });
    const result = await getPublishedPortfolio();
    if (!result.document) return Response.json({ error: "网站尚未发布" }, { status: 404, headers: noCacheHeaders });
    return Response.json(
      { portfolio: toPublicPortfolioDocument(result.document), revision: result.revision, publishedAt: result.publishedAt },
      { headers: noCacheHeaders },
    );
  } catch (error) {
    console.error(JSON.stringify({ message: "public portfolio read failed", error: errorMessage(error) }));
    return Response.json({ error: "作品集暂时无法读取" }, { status: 503, headers: noCacheHeaders });
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
