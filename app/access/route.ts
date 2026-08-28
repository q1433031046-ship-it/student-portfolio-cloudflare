import { clearAccessSessionCookie } from "../api/_lib/portfolio-access-security";
import { redeemAccessPass } from "../api/_lib/portfolio-access";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("key") ?? "";
  const destination = new URL("/", url.origin);

  try {
    if (token.length < 20 || token.length > 300) throw new Error("二维码无效");
    const result = await redeemAccessPass(request, token);
    if (!result.ok) throw new Error(result.reason);
    return new Response(null, {
      status: 302,
      headers: { Location: destination.toString(), "Set-Cookie": result.cookie, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    destination.searchParams.set("access_error", error instanceof Error ? error.message : "二维码暂时无法使用");
    return new Response(null, {
      status: 302,
      headers: { Location: destination.toString(), "Set-Cookie": clearAccessSessionCookie(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }
}
