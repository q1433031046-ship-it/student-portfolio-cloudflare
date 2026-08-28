import { AuthError, loginWithPassword, sessionResponseHeaders } from "../../_lib/admin-auth";
import { isRequestBodyError, readJsonBody } from "../../_lib/request-body";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, 8_192);
    if (!isRecord(body) || typeof body.password !== "string") {
      return Response.json({ error: "请输入管理员密码" }, { status: 400 });
    }
    const sessionCookie = await loginWithPassword(body.password, request);
    return Response.json({ ok: true }, { headers: sessionResponseHeaders(sessionCookie) });
  } catch (error) {
    if (error instanceof AuthError || isRequestBodyError(error)) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error(JSON.stringify({ message: "administrator login failed", error: errorMessage(error) }));
    return Response.json({ error: "登录暂时不可用" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
