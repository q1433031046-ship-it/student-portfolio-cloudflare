export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return Response.json({
    name: "可扩展学生作品集 API",
    version: "2.0",
    authentication: "管理端使用平台身份或 Cloudflare Access 邮箱验证；服务端自动化使用独立 Bearer Token",
    public: [
      { method: "GET", endpoint: `${origin}/api/portfolio`, purpose: "读取已发布作品集快照" },
      { method: "POST", endpoint: `${origin}/api/playback`, purpose: "为已发布视频申请 15 分钟播放地址" },
      { method: "POST", endpoint: `${origin}/api/events`, purpose: "提交必要的访问与播放事件" },
    ],
    admin: [
      { method: "GET / POST", endpoint: `${origin}/api/admin/setup`, purpose: "读取或完成唯一管理员邮箱绑定" },
      { method: "GET", endpoint: `${origin}/api/admin/portfolio`, purpose: "读取草稿与修订号" },
      { method: "PUT", endpoint: `${origin}/api/admin/portfolio`, purpose: "保存完整草稿，使用 revision 防止覆盖" },
      { method: "PUT", endpoint: `${origin}/api/admin/media/{projectId}/{slot}`, purpose: "流式上传图片或视频；视频最大 90 MiB" },
      { method: "POST", endpoint: `${origin}/api/admin/portfolio/publish`, purpose: "把草稿发布为公开快照" },
      { method: "GET", endpoint: `${origin}/api/admin/events`, purpose: "读取访问与安全记录" },
      { method: "GET", endpoint: `${origin}/api/admin/audit`, purpose: "读取管理操作记录" },
    ],
    storage: { structured: "D1", media: "private R2", rawIpStored: false },
  });
}
