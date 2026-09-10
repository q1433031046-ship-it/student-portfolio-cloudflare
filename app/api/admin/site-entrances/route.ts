import { env } from 'cloudflare:workers';
import { requirePagesManager } from '../../_lib/pages-admin-auth';
import { getPortfolioDb } from '../../_lib/portfolio-store';
import { resolveSiteEntrances } from '../../../lib/site-entrances';

export async function GET(request: Request) {
  const access = await requirePagesManager(request);
  if (access instanceof Response) return access;
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const row = await getPortfolioDb().prepare("SELECT project,production_url FROM pages_site WHERE id='default'").first<{ project: string; production_url: string }>();
    const config = env as unknown as Record<string, unknown>;
    return Response.json(resolveSiteEntrances({ accountId: config.PAGES_ACCOUNT_ID, project: config.PAGES_PROJECT_NAME, staticUrl: config.STATIC_SITE_URL, storedProject: row?.project, storedUrl: row?.production_url }), { headers });
  } catch {
    return Response.json({ staticUrl: null, uploadUrl: null, project: null, state: 'unavailable' }, { status: 503, headers });
  }
}
