import { authorizeAdmin } from "../../_lib/auth";
import {
  AuthError,
  createLocalAdministrator,
  isSitesAuthPlatform,
  localCredentialsExist,
  sessionResponseHeaders,
} from "../../_lib/admin-auth";
import { isRequestBodyError, readJsonBody } from "../../_lib/request-body";
import { bindSiteOwner, getSiteOwnership } from "../../_lib/site-ownership";

const noCacheHeaders = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export async function GET(request: Request) {
  try {
    if (!isSitesAuthPlatform() && !await localCredentialsExist()) {
      return Response.json({ state: "initial_setup", identity: null }, { headers: noCacheHeaders });
    }
    const identity = await authorizeAdmin(request);
    if (!identity) return Response.json({ error: "请先输入管理员密码" }, { status: 401, headers: noCacheHeaders });
    if (identity.kind === "token") return Response.json({ error: "服务令牌不能进入初始化流程" }, { status: 403, headers: noCacheHeaders });

    if (isSitesAuthPlatform()) {
      const ownership = await getSiteOwnership();
      if (!ownership) await bindSiteOwner(identity);
    }
    return Response.json({ state: "ready", identity: identity.user }, { headers: noCacheHeaders });
  } catch (error) {
    console.error(JSON.stringify({ message: "admin setup state failed", error: errorMessage(error) }));
    return Response.json({ error: "管理员状态暂时无法读取" }, { status: 503, headers: noCacheHeaders });
  }
}

export async function POST(request: Request) {
  if (isSitesAuthPlatform()) {
    const identity = await authorizeAdmin(request);
    if (!identity || identity.kind === "token") {
      return Response.json({ error: "请先完成网站登录" }, { status: 401, headers: noCacheHeaders });
    }
    try {
      await bindSiteOwner(identity);
      return Response.json({ state: "ready", identity: identity.user }, { headers: noCacheHeaders });
    } catch (error) {
      return Response.json({ error: errorMessage(error) }, { status: 400, headers: noCacheHeaders });
    }
  }

  try {
    const body = await readJsonBody(request, 16_384);
    if (!isRecord(body) || typeof body.initialCode !== "string" || typeof body.password !== "string") {
      return Response.json({ error: "请填写一次性部署口令和管理员密码" }, { status: 400, headers: noCacheHeaders });
    }
    const result = await createLocalAdministrator({
      initialCode: body.initialCode,
      password: body.password,
      request,
    });
    return Response.json({ state: "recovery_code", recoveryCode: result.recoveryCode }, {
      status: 201,
      headers: sessionResponseHeaders(result.sessionCookie),
    });
  } catch (error) {
    if (error instanceof AuthError || isRequestBodyError(error)) {
      return Response.json({ error: error.message }, { status: error.status, headers: noCacheHeaders });
    }
    console.error(JSON.stringify({ message: "local administrator setup failed", error: errorMessage(error) }));
    return Response.json({ error: "管理员初始化失败，请稍后重试" }, { status: 500, headers: noCacheHeaders });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

