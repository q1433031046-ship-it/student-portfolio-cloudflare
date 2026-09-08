import { validatePublicDocument, MAX_FILE, MAX_TOTAL } from './manual-static-package.mjs';
const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'video/mp4': '.mp4', 'font/woff2': '.woff2', 'font/woff': '.woff', 'application/font-woff': '.woff', 'application/x-font-woff': '.woff' };
const mediaFields = ['id', 'label', 'alt', 'kind', 'visualKey', 'objectPosition', 'sourceAspectRatio', 'crop'];
export function manualDocument(draft, rows) {
  const byKey = new Map(rows.map(row => [row.object_key, row])), used = new Map();
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    if (['image', 'video', 'font'].includes(value.kind)) {
      const safe = Object.fromEntries(mediaFields.filter(k => value[k] !== undefined).map(k => [k, visit(value[k])]));
      if (value.key) {
        const row = byKey.get(value.key), ext = row && extensions[row.content_type];
        if (!row || row.status !== 'uploaded' || !ext || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id) || !Number.isSafeInteger(row.byte_size) || row.byte_size < 1 || row.byte_size > MAX_FILE) throw new Error('引用的媒体尚未就绪或超过限制');
        if ((value.kind === 'video' && row.content_type !== 'video/mp4') || (value.kind === 'image' && !row.content_type.startsWith('image/')) || (value.kind === 'font' && !ext.startsWith('.woff'))) throw new Error('媒体类型不一致');
        if (typeof row.object_key !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(row.object_key) || row.object_key.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('媒体来源路径无效');
        const path = `media/${row.id}${ext}`;
        const old = used.get(path); if (old && old.downloadPath !== `/api/media/${row.object_key}`) throw new Error('媒体路径冲突');
        used.set(path, { path, bytes: row.byte_size, contentType: row.content_type, downloadPath: `/api/media/${row.object_key}` });
        safe.src = `/${path}`; safe.available = true;
      }
      return safe;
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v)]));
  }
  const document = Object.fromEntries(['schemaVersion', 'settings', 'hero', 'endCovers', 'themes', 'categories', 'projects'].map(k => [k, visit(draft[k])]));
  const media = [...used.values()].sort((a, b) => a.path < b.path ? -1 : 1);
  if (media.length > 19990 || media.reduce((n, f) => n + f.bytes, 0) > MAX_TOTAL) throw new Error('媒体总量超过限制');
  validatePublicDocument(document, new Set(media.map(f => f.path)));
  return { document, media };
}
