// Historical export grants are retired; no credential is evaluated or exchanged.
function retired() { return Response.json({ code: "STATIC_EXPORT_RETIRED", error: "静态发布已迁移，请使用后台静态预览入口" }, { status: 410, headers: { "Cache-Control": "no-store" } }); }
export const GET = retired;
export const POST = retired;
