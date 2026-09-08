import { requirePagesManager } from '../../_lib/pages-admin-auth';
import { getPortfolioDb, getPortfolioRecord } from '../../_lib/portfolio-store';
import { mediaAssetsInDocument } from '../../../portfolio/model';
import { manualDocument } from '../../../lib/manual-static-document.mjs';
import { PAGES_HEADERS } from '../../_lib/pages-control';
import { TEMPLATE_ID } from '../../../lib/manual-static-package.mjs';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request) {
  const access = await requirePagesManager(request);
  if (access instanceof Response) return access;
  try {
    const expected = Number(new URL(request.url).searchParams.get('revision'));
    const record = await getPortfolioRecord();
    if (!Number.isSafeInteger(expected) || expected < 1 || !record || expected !== record.revision) return Response.json({ error: '草稿已变化，请保存后重新下载' }, { status: 409, headers });
    if (new URL(request.url).searchParams.get('check') === '1') return Response.json({ revision: record.revision }, { headers });
    const keys = [...new Set(mediaAssetsInDocument(record.draft).flatMap(asset => asset.key ? [asset.key] : []))];
    const rows = await getPortfolioDb().prepare('SELECT id,object_key,byte_size,content_type,status FROM portfolio_media WHERE object_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all();
    const result = manualDocument(record.draft, rows.results);
    const latest = await getPortfolioDb().prepare("SELECT revision FROM portfolio_documents WHERE id='default'").first<{ revision: number }>();
    if (latest?.revision !== expected) return Response.json({ error: '草稿已变化，请重新下载' }, { status: 409, headers });
    return Response.json({ ...result, revision: expected, templateIdentity: TEMPLATE_ID, templatePath: '/manual-pages-template.json', headers: PAGES_HEADERS,
      adminOrigin: 'https://student-portfolio.q1433031046.workers.dev' }, { headers });
  } catch {
    return Response.json({ error: '无法导出完整静态包，请检查媒体是否完整且单个文件不超过 25 MiB' }, { status: 422, headers });
  }
}
