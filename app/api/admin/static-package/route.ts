import { requirePagesManager } from '../../_lib/pages-admin-auth';
import { getPortfolioDb, getPortfolioRecord } from '../../_lib/portfolio-store';
import { mediaAssetsInDocument } from '../../../portfolio/model';
import { manualDocument } from '../../../lib/manual-static-document.mjs';
import { PAGES_HEADERS } from '../../_lib/pages-control';
import { requestAdminOrigin } from '../../../lib/site-entrances';
import { TEMPLATE_ID } from '../../../lib/manual-static-package.mjs';
import { PackageMediaError } from '../../../lib/static-package-errors.mjs';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request) {
  const access = await requirePagesManager(request);
  if (access instanceof Response) return access;
  const expected = Number(new URL(request.url).searchParams.get('revision'));
  let phase = 'document';
  const failure = (status: number, code: string, error: string) => Response.json({ error, code, phase, revision: Number.isSafeInteger(expected) ? expected : null }, { status, headers });
  try {
    const record = await getPortfolioRecord();
    if (!Number.isSafeInteger(expected) || expected < 1 || !record || expected !== record.revision) return failure(409, 'REVISION_CHANGED', '草稿版本已变化，请刷新已保存版本后重新下载');
    if (new URL(request.url).searchParams.get('check') === '1') return Response.json({ revision: record.revision }, { headers });
    const keys = [...new Set(mediaAssetsInDocument(record.draft).flatMap(asset => asset.key ? [asset.key] : []))];
    phase = 'media-metadata';
    const rows = await getPortfolioDb().prepare('SELECT id,object_key,byte_size,content_type,status FROM portfolio_media WHERE object_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all();
    const result = manualDocument(record.draft, rows.results);
    phase = 'revision-check';
    const latest = await getPortfolioDb().prepare("SELECT revision FROM portfolio_documents WHERE id='default'").first<{ revision: number }>();
    if (latest?.revision !== expected) return failure(409, 'REVISION_CHANGED', '草稿版本已变化，请重新下载');
    return Response.json({ ...result, revision: expected, templateIdentity: TEMPLATE_ID, templatePath: '/manual-pages-template.json', headers: PAGES_HEADERS,
      adminOrigin: requestAdminOrigin(request) }, { headers });
  } catch (error) {
    if (error instanceof PackageMediaError) return Response.json({ error: error.message, code: error.code, issues: error.issues, phase, revision: expected }, { status: 422, headers });
    const requestId = crypto.randomUUID();
    console.error('static-package', { code: 'EXPORT_INTERNAL', phase, requestId });
    return Response.json({ error: '静态导出服务暂不可用', code: 'EXPORT_INTERNAL', phase, revision: Number.isSafeInteger(expected) ? expected : null, requestId }, { status: 500, headers });
  }
}
