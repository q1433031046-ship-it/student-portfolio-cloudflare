import { createDefaultPortfolioDocument } from "../../portfolio/default-document";
import type { AdminIdentity } from "./auth";
import { authorizeAdmin, canManagePortfolio } from "./auth";
import { getPortfolioDb, getPortfolioRecord, type PortfolioRecord } from "./portfolio-store";

const OWNER_ID = "default";

type OwnershipRow = {
  id: string;
  owner_email: string;
  auth_subject: string | null;
  auth_provider: "sites" | "cloudflare-access";
  bound_at: string;
  onboarding_email_sent_at: string | null;
  onboarding_email_id: string | null;
};

export type SiteOwnership = {
  id: string;
  ownerEmail: string;
  authSubject: string | null;
  authProvider: "sites" | "cloudflare-access";
  boundAt: string;
  onboardingEmailSentAt: string | null;
  onboardingEmailId: string | null;
  ready: boolean;
};

export type PortfolioManager = {
  identity: AdminIdentity;
  ownership: SiteOwnership;
  record: PortfolioRecord;
};

export async function getSiteOwnership(): Promise<SiteOwnership | null> {
  const row = await readOwnership();
  if (row) return mapOwnership(row);

  const historical = await getPortfolioRecord();
  if (!historical) return null;
  const now = new Date().toISOString();
  await getPortfolioDb()
    .prepare("INSERT OR IGNORE INTO site_ownership (id, owner_email, auth_provider, bound_at, onboarding_email_sent_at, onboarding_email_id) VALUES (?, ?, 'sites', ?, ?, 'legacy-adopted')")
    .bind(OWNER_ID, historical.ownerEmail.toLowerCase(), now, now)
    .run();
  const adopted = await readOwnership();
  if (!adopted) throw new Error("无法兼容既有管理员绑定");
  return mapOwnership(adopted);
}

export async function bindSiteOwner(identity: AdminIdentity) {
  if (identity.kind === "token") throw new Error("服务令牌不能绑定管理员邮箱");
  const email = identity.user.trim().toLowerCase();
  const existing = await getSiteOwnership();
  if (existing) {
    if (existing.ownerEmail !== email) throw new Error("网站已经绑定其他管理员邮箱");
    return existing;
  }

  const now = new Date().toISOString();
  const draft = JSON.stringify(createDefaultPortfolioDocument());
  await getPortfolioDb().batch([
    getPortfolioDb()
      .prepare("INSERT OR IGNORE INTO site_ownership (id, owner_email, auth_subject, auth_provider, bound_at) VALUES (?, ?, ?, ?, ?)")
      .bind(OWNER_ID, email, identity.subject ?? null, identity.kind, now),
    getPortfolioDb()
      .prepare("INSERT OR IGNORE INTO portfolio_documents (id, owner_email, revision, draft_json, updated_at) VALUES (?, ?, 1, ?, ?)")
      .bind(OWNER_ID, email, draft, now),
  ]);

  const bound = await readOwnership();
  if (!bound) throw new Error("管理员邮箱绑定失败");
  if (bound.owner_email !== email) throw new Error("网站已经绑定其他管理员邮箱");
  const record = await getPortfolioRecord();
  if (!record || record.ownerEmail.toLowerCase() !== bound.owner_email) {
    throw new Error("管理员绑定数据不一致");
  }
  return mapOwnership(bound);
}

export async function markOnboardingEmailSent(ownerEmail: string, messageId: string) {
  const now = new Date().toISOString();
  const result = await getPortfolioDb()
    .prepare("UPDATE site_ownership SET onboarding_email_sent_at = ?, onboarding_email_id = ? WHERE id = ? AND owner_email = ? AND onboarding_email_sent_at IS NULL")
    .bind(now, messageId.slice(0, 240), OWNER_ID, ownerEmail.trim().toLowerCase())
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    const current = await getSiteOwnership();
    if (!current?.ready || current.ownerEmail !== ownerEmail.trim().toLowerCase()) {
      throw new Error("后台入口邮件状态无法保存");
    }
  }
  const updated = await getSiteOwnership();
  if (!updated) throw new Error("管理员绑定状态无法读取");
  return updated;
}

export async function requirePortfolioManager(request: Request): Promise<PortfolioManager | Response> {
  const identity = await authorizeAdmin(request);
  if (!identity) return setupError("请先完成管理员登录", 401);

  const ownership = await getSiteOwnership();
  if (!ownership) return setupError("请先绑定管理员邮箱", 428);
  if (!canManagePortfolio(identity, ownership.ownerEmail)) {
    return setupError("当前邮箱没有这个网站的管理权限", 403);
  }
  if (!ownership.ready) return setupError("请先完成后台入口邮件发送", 428);

  const record = await getPortfolioRecord();
  if (!record || record.ownerEmail.toLowerCase() !== ownership.ownerEmail) {
    return setupError("网站管理数据尚未完成初始化", 503);
  }
  return { identity, ownership, record };
}

function setupError(message: string, status: number) {
  return Response.json({ error: message, setupRequired: status === 428 }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" },
  });
}

async function readOwnership() {
  return getPortfolioDb()
    .prepare("SELECT id, owner_email, auth_subject, auth_provider, bound_at, onboarding_email_sent_at, onboarding_email_id FROM site_ownership WHERE id = ? LIMIT 1")
    .bind(OWNER_ID)
    .first<OwnershipRow>();
}

function mapOwnership(row: OwnershipRow): SiteOwnership {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    authSubject: row.auth_subject,
    authProvider: row.auth_provider,
    boundAt: row.bound_at,
    onboardingEmailSentAt: row.onboarding_email_sent_at,
    onboardingEmailId: row.onboarding_email_id,
    ready: Boolean(row.onboarding_email_sent_at),
  };
}
