import { env } from "cloudflare:workers";

type EmailBindings = Cloudflare.Env & {
  ADMIN_EMAIL_FROM?: string;
  EMAIL?: SendEmail;
};

type AdminLinkEmailInput = {
  to: string;
  origin: string;
  siteTitle: string;
  from?: string;
};

export function buildAdminLinkEmail(input: AdminLinkEmailInput) {
  const recipient = normalizeEmail(input.to);
  const sender = normalizeSender(input.from ?? "");
  const adminUrl = new URL("/admin", normalizeOrigin(input.origin)).toString();
  const title = input.siteTitle.trim().slice(0, 80) || "作品网站";
  const safeTitle = escapeHtml(title);
  const safeUrl = escapeHtml(adminUrl);

  return {
    to: recipient,
    from: sender,
    subject: "你的作品网站后台入口",
    text: `${title}\n\n后台入口：${adminUrl}\n\n进入后台时需要使用已绑定邮箱获取一次性验证码。建议收藏此地址；如果不是你本人完成的绑定，请立即检查 Cloudflare Access 设置。`,
    html: `<main style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#101114;line-height:1.7"><p style="color:#3258ff;font-size:12px;font-weight:700;letter-spacing:.12em">ADMIN ACCESS</p><h1 style="font-size:30px;line-height:1.15">${safeTitle}</h1><p>管理员邮箱已完成绑定。以后进入后台时，需要使用该邮箱获取一次性验证码。</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#3258ff;color:#fff;text-decoration:none;font-weight:700">打开网站后台</a></p><p style="font-size:13px;color:#6d7077;word-break:break-all">后台地址：${safeUrl}</p><p style="font-size:12px;color:#6d7077">建议收藏这封邮件。如果不是你本人完成的绑定，请立即检查 Cloudflare Access 设置。</p></main>`,
  };
}

export async function sendAdminLinkEmail(input: Omit<AdminLinkEmailInput, "from">) {
  const bindings = env as EmailBindings;
  if (!bindings.EMAIL || !bindings.ADMIN_EMAIL_FROM?.trim()) {
    throw new Error("后台入口邮件发送尚未配置");
  }
  const message = buildAdminLinkEmail({ ...input, from: bindings.ADMIN_EMAIL_FROM });
  const result = await bindings.EMAIL.send(message);
  if (!result.messageId) throw new Error("后台入口邮件没有返回发送凭据");
  return { messageId: result.messageId };
}

function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("后台入口必须使用安全网址");
  }
  return url.origin;
}

function normalizeEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) || normalized.length > 254) {
    throw new Error("管理员邮箱格式无效");
  }
  return normalized;
}

function normalizeSender(value: string) {
  const normalized = value.trim();
  const address = normalized.match(/<([^<>]+)>$/u)?.[1] ?? normalized;
  normalizeEmail(address);
  if (/\r|\n/u.test(normalized) || normalized.length > 320) throw new Error("发件地址格式无效");
  return normalized;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

