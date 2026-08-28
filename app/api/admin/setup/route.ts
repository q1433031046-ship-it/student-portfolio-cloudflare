import { authorizeAdmin, canManagePortfolio } from "../../_lib/auth";
import { writeAuditLog } from "../../_lib/audit";
import { sendAdminLinkEmail } from "../../_lib/onboarding-email";
import { getPortfolioRecord } from "../../_lib/portfolio-store";
import {
  bindSiteOwner,
  getSiteOwnership,
  markOnboardingEmailSent,
  type SiteOwnership,
} from "../../_lib/site-ownership";

const noCacheHeaders = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };

export async function GET(request: Request) {
  const identity = await authorizeAdmin(request);
  if (!identity) return Response.json({ error: "请先完成邮箱验证码登录" }, { status: 401, headers: noCacheHeaders });
  if (identity.kind === "token") return Response.json({ error: "服务令牌不能进入初始化流程" }, { status: 403, headers: noCacheHeaders });

  try {
    const ownership = await getSiteOwnership();
    if (ownership && !canManagePortfolio(identity, ownership.ownerEmail)) {
      return Response.json({ error: "当前邮箱不是这个网站的管理员" }, { status: 403, headers: noCacheHeaders });
    }
    return Response.json(setupPayload(identity.user, ownership), { headers: noCacheHeaders });
  } catch (error) {
    console.error(JSON.stringify({ message: "owner setup state failed", error: errorMessage(error) }));
    return Response.json({ error: "管理员绑定状态暂时无法读取" }, { status: 503, headers: noCacheHeaders });
  }
}

export async function POST(request: Request) {
  const identity = await authorizeAdmin(request);
  if (!identity) return Response.json({ error: "请先完成邮箱验证码登录" }, { status: 401, headers: noCacheHeaders });
  if (identity.kind === "token") return Response.json({ error: "服务令牌不能绑定管理员邮箱" }, { status: 403, headers: noCacheHeaders });

  let ownership: SiteOwnership | null = null;
  try {
    const before = await getSiteOwnership();
    if (before && !canManagePortfolio(identity, before.ownerEmail)) {
      return Response.json({ error: "当前邮箱不是这个网站的管理员" }, { status: 403, headers: noCacheHeaders });
    }
    ownership = await bindSiteOwner(identity);
    if (!before) {
      await safeAudit({
        actorEmail: identity.user,
        action: "site.owner.bound",
        targetType: "site_owner",
        targetId: ownership.id,
        summary: { provider: identity.kind },
      });
    }
    if (ownership.ready) return Response.json(setupPayload(identity.user, ownership), { headers: noCacheHeaders });

    const record = await getPortfolioRecord();
    if (!record) throw new Error("网站作品数据尚未初始化");
    const delivery = await sendAdminLinkEmail({
      to: ownership.ownerEmail,
      origin: new URL(request.url).origin,
      siteTitle: record.draft.settings.siteTitle,
    });
    ownership = await markOnboardingEmailSent(ownership.ownerEmail, delivery.messageId);
    await safeAudit({
      actorEmail: identity.user,
      action: "site.owner_link.emailed",
      targetType: "site_owner",
      targetId: ownership.id,
      summary: { messageId: delivery.messageId },
    });
    return Response.json(setupPayload(identity.user, ownership), { headers: noCacheHeaders });
  } catch (error) {
    const message = errorMessage(error);
    console.error(JSON.stringify({ message: "owner setup failed", error: message }));
    return Response.json({
      ...setupPayload(identity.user, ownership),
      error: /邮件/u.test(message) ? message : "管理员邮箱绑定暂时无法完成",
    }, { status: 503, headers: noCacheHeaders });
  }
}

function setupPayload(authenticatedEmail: string, ownership: SiteOwnership | null) {
  if (!ownership) {
    return { state: "unbound" as const, email: authenticatedEmail, boundAt: null, onboardingEmailSentAt: null };
  }
  return {
    state: ownership.ready ? "ready" as const : "email_pending" as const,
    email: ownership.ownerEmail,
    boundAt: ownership.boundAt,
    onboardingEmailSentAt: ownership.onboardingEmailSentAt,
  };
}

async function safeAudit(input: Parameters<typeof writeAuditLog>[0]) {
  try {
    await writeAuditLog(input);
  } catch (error) {
    console.error(JSON.stringify({ message: "owner setup audit failed", error: errorMessage(error) }));
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

