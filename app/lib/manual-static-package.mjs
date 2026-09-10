// Shared by the browser download and the one-off local packager. No provider calls.
export const TEMPLATE_ID = '6ea2ea1d684d335988db93d1d169700e5a7a94c5e40662fcfb50c866a94ff6b5';
export const MAX_FILE = 25 * 1024 * 1024;
export const MAX_TOTAL = 800 * 1024 * 1024;
const encoder = new TextEncoder();
const topFields = new Set(['schemaVersion', 'settings', 'hero', 'endCovers', 'themes', 'categories', 'projects']);
const privateFields = new Set(['key', 'archivedmedia', 'owneremail', 'owner_email', 'auditlogs', 'bootstrap', 'leaseid', 'credentials']);
export function safePath(path) {
  if (typeof path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('静态文件路径无效');
  return path;
}
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
}
export function validatePublicDocument(document, mediaPaths) {
  if (!document || document.schemaVersion !== 5 || Object.keys(document).some(k => !topFields.has(k))) throw new Error('公开内容结构无效');
  const references = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (privateFields.has(key.toLowerCase()) || /token|password|secret/i.test(key)) throw new Error('导出内容含有私有字段');
      if (key === 'src' && value != null && value !== '') {
        if (typeof value !== 'string' || !value.startsWith('/media/') || !mediaPaths.has(value.slice(1))) throw new Error('媒体引用未包含在静态包中');
        references.add(value.slice(1));
      }
      visit(value);
    }
  };
  visit(document);
  if (references.size !== mediaPaths.size) throw new Error('静态包包含未引用媒体');
}
export async function templateFiles(template, title, adminOrigin) {
  if (template.identity !== TEMPLATE_ID || !Array.isArray(template.files) || template.files.length !== 3) throw new Error('完整展示模板身份不符');
  const identity = await sha256(encoder.encode(JSON.stringify(template.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })))));
  if (identity !== TEMPLATE_ID) throw new Error('模板清单摘要不符');
  const url = new URL(adminOrigin);
  if (url.protocol !== 'https:' || url.origin !== adminOrigin || url.username || url.password) throw new Error('后台地址无效');
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const files = [];
  for (const entry of template.files) {
    safePath(entry.path);
    let data = Uint8Array.from(atob(entry.base64), c => c.charCodeAt(0));
    if (data.length !== entry.bytes || await sha256(data) !== entry.sha256) throw new Error('模板字节摘要不符');
    if (entry.path === 'index.html') data = encoder.encode(new TextDecoder().decode(data)
      .replace('__STATIC_SITE_TITLE__', escape(title)).replace('__WORKER_ADMIN_URL__', escape(`${adminOrigin}/admin`)));
    files.push({ path: entry.path, data });
  }
  return files;
}
export async function buildManualFiles({ template, document, media, adminOrigin, headers }, readMedia) {
  if (!Array.isArray(media) || media.length > 19990) throw new Error('媒体数量超过限制');
  const paths = new Set(); let total = 0;
  for (const item of media) {
    safePath(item.path);
    if (!item.path.startsWith('media/') || paths.has(item.path) || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_FILE) throw new Error('媒体路径或大小无效');
    paths.add(item.path); total += item.bytes;
  }
  if (total > MAX_TOTAL) throw new Error('媒体总量超过限制');
  validatePublicDocument(document, paths);
  const files = await templateFiles(template, document.settings?.siteTitle ?? '作品集', adminOrigin);
  files.push({ path: 'data/portfolio.json', data: encoder.encode(JSON.stringify(document)) }, { path: '_headers', data: encoder.encode(headers) });
  for (const item of media) {
    const data = await readMedia(item);
    if (!(data instanceof Uint8Array) || data.length !== item.bytes) throw new Error('媒体字节不完整，请重新下载');
    if (item.sha256 && await sha256(data) !== item.sha256) throw new Error('媒体摘要不符');
    files.push({ path: item.path, data });
  }
  return files;
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
// Store-only ZIP32: deterministic, CRC-protected, with no compression dependencies.
export function storeZip(files) {
  if (!files.length || files.length > 20000) throw new Error('ZIP文件数量无效');
  const local = [], central = [], names = new Set(); let offset = 0, directorySize = 0;
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    safePath(file.path);
    if (names.has(file.path) || !(file.data instanceof Uint8Array) || file.data.length > MAX_FILE) throw new Error('ZIP文件重复或超过大小限制');
    names.add(file.path);
    const name = encoder.encode(file.path), size = file.data.length, crc = crc32(file.data);
    const header = new Uint8Array(30), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(12, 33, true);
    h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true);
    local.push(header, name, file.data);
    const entry = new Uint8Array(46), d = new DataView(entry.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(14, 33, true);
    d.setUint32(16, crc, true); d.setUint32(20, size, true); d.setUint32(24, size, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true);
    central.push(entry, name); directorySize += entry.length + name.length; offset += header.length + name.length + size;
    if (offset + directorySize > 0xffffffff) throw new Error('ZIP32大小超过限制');
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
