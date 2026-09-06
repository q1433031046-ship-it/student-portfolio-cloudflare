import { getAccessConfiguration } from "../../_lib/portfolio-access";
import { requirePortfolioManager } from "../../_lib/site-ownership";

export async function GET(request: Request) {
  const access = await requirePortfolioManager(request);
  if (access instanceof Response) return access;
  try {
    return Response.json({ ...(await getAccessConfiguration(new URL(request.url).origin)), featureStatus: "paused" }, { headers: noCacheHeaders });
  } catch (error) {
    console.error(JSON.stringify({ message: "二维码访问设置暂时无法读取", error: errorMessage(error) }));
    return Response.json({ error: "二维码访问设置暂时无法读取" }, { status: 503, headers: noCacheHeaders });
  }
}

export async function POST(request: Request) { return pausedAfterAuthorization(request); }
export async function PATCH(request: Request) { return pausedAfterAuthorization(request); }
export async function DELETE(request: Request) { return pausedAfterAuthorization(request); }

async function pausedAfterAuthorization(request: Request) {
  const access = await requirePortfolioManager(request);
  if (access instanceof Response) return access;
  return Response.json({ code: "ACCESS_FEATURE_PAUSED", error: "限制访问功能暂时暂停；既有设置和访问码均已保留" }, { status: 409, headers: noCacheHeaders });
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
const noCacheHeaders = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };
