import { AuthError, resetPasswordWithRecovery, sessionResponseHeaders } from "../../_lib/admin-auth";
import { isRequestBodyError, readJsonBody } from "../../_lib/request-body";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, 16_384);
    if (!isRecord(body) || typeof body.recoveryCode !== "string" || typeof body.password !== "string") {
      return Response.json({ error: "请填写系统恢复码和新密码" }, { status: 400 });
    }
    const result = await resetPasswordWithRecovery({
      recoveryCode: body.recoveryCode,
      password: body.password,
      request,
    });
    return Response.json({ ok: true, recoveryCode: result.recoveryCode }, {
      headers: sessionResponseHeaders(result.sessionCookie),
    });
  } catch (error) {
    if (error instanceof AuthError || isRequestBodyError(error)) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error(JSON.stringify({ message: "administrator recovery failed", error: errorMessage(error) }));
    return Response.json({ error: "密码恢复暂时不可用" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
