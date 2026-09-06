import { env } from 'cloudflare:workers';
import { authorizeAdmin, canManagePortfolio } from './auth';
export async function requirePagesManager(request: Request) {
  const identity = await authorizeAdmin(request);
  if (!identity) return Response.json({ error: '请先登录管理员' }, { status: 401 });
  const db = (env as unknown as { DB: D1Database }).DB;
  const row = await db.prepare(`SELECT o.owner_email,o.auth_provider,o.onboarding_email_sent_at FROM site_ownership o JOIN portfolio_documents d ON d.id=o.id AND lower(d.owner_email)=lower(o.owner_email) WHERE o.id='default'`).first<{ owner_email: string; auth_provider: string; onboarding_email_sent_at: string | null }>();
  if (!row || (row.auth_provider === 'cloudflare-access' && !row.onboarding_email_sent_at)) return Response.json({ error: '请先完成管理员初始化' }, { status: 428 });
  if (!canManagePortfolio(identity, row.owner_email)) return Response.json({ error: '当前账号没有管理权限' }, { status: 403 });
  return { identity };
}
