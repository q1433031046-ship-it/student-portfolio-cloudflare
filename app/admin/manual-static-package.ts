import { buildManualFiles, storeZip, TEMPLATE_ID } from '../lib/manual-static-package.mjs';
import { fetchAdmin } from './admin-fetch';
import { packageResponseMessage } from '../lib/static-package-errors.mjs';

async function requirePackageResponse(response: Response, revision: number, phase: string) {
  if (response.ok) return;
  let body: unknown; try { body = await response.json(); } catch { body = null; }
  throw new Error(packageResponseMessage(response.status, body, revision, phase));
}

type Media = { path: string; bytes: number; contentType: string; downloadPath: string };
type Description = { revision: number; templateIdentity: string; templatePath: string; document: Record<string, unknown>; media: Media[]; headers: string; adminOrigin: string };
async function responseBytes(response: Response, expected: number) {
  if (!response.ok || response.redirected || !response.body) throw new Error('媒体下载未完成');
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > expected) throw new Error('媒体大小已变化'); parts.push(r.value); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  if (size !== expected) throw new Error('媒体字节不完整');
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
export async function downloadManualPackage(revision: number, onProgress: (message: string) => void) {
  const endpoint = `/api/admin/static-package?revision=${revision}`;
  const description = await fetchAdmin(endpoint, { redirect: 'error' });
  await requirePackageResponse(description, revision, 'description');
  const data = await description.json() as Description;
  if (!data || data.revision !== revision || !Array.isArray(data.media) || data.templateIdentity !== TEMPLATE_ID || data.templatePath !== '/manual-pages-template.json') throw new Error('导出身份不一致');
  const templateResponse = await fetchAdmin(data.templatePath, { redirect: 'error' });
  if (!templateResponse.ok) throw new Error('完整展示模板不可用');
  const template = await templateResponse.json(); let completed = 0;
  const files = await buildManualFiles({ ...data, template }, async (media: Media) => {
    if (!/^\/api\/media\/[A-Za-z0-9_./-]+$/.test(media.downloadPath) || media.downloadPath.split('/').some(p => p === '..' || p === '.')) throw new Error('媒体下载地址无效');
    const url = new URL(media.downloadPath, location.origin); if (url.origin !== location.origin) throw new Error('媒体必须来自当前网站');
    onProgress(`正在下载媒体 ${++completed}/${data.media.length}…`);
    const response = await fetchAdmin(url.href, { redirect: 'error' });
    await requirePackageResponse(response, revision, 'media-download');
    if ((response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== media.contentType.toLowerCase()) throw new Error('媒体类型已变化');
    return responseBytes(response, media.bytes);
  });
  const check = await fetchAdmin(`${endpoint}&check=1`, { redirect: 'error' });
  await requirePackageResponse(check, revision, 'revision-check');
  if ((await check.json() as { revision: number }).revision !== revision) throw new Error(packageResponseMessage(409, { code: 'REVISION_CHANGED' }, revision, 'revision-check'));
  onProgress('正在生成完整 ZIP…');
  const blob = storeZip(files), url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `student-portfolio-r${revision}.zip`; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { fileCount: files.length, bytes: blob.size, webUploadCompatible: files.length <= 1000 };
}
