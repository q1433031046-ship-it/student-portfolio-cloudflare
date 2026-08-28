import { expiredSessionCookie, isSitesAuthPlatform, logoutLocalAdmin } from "../../_lib/admin-auth";

export async function POST(request: Request) {
  const cookie = isSitesAuthPlatform() ? expiredSessionCookie() : await logoutLocalAdmin(request);
  return Response.json({ ok: true }, {
    headers: { "Cache-Control": "no-store", "Set-Cookie": cookie },
  });
}
