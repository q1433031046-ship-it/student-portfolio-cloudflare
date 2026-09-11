// Raw MP4 byte chunks, not independently playable segments or DRM.
export const CHUNK_BYTES = 16 * 1024 * 1024;
export const VIDEO_BYTES = 50 * 1024 * 1024;
const digestPattern = /^[a-f0-9]{64}$/;
export class StaticVideoError extends Error {
  constructor(code) { super(`视频加载失败（${code}），请重试或联系管理员重新发布`); this.code = code; }
}
const fail = code => { throw new StaticVideoError(code); };
export async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export function validateChunks(manifest) {
  if (!manifest || manifest.version !== 1 || manifest.mime !== 'video/mp4' || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 25 * 1024 * 1024 || manifest.bytes > VIDEO_BYTES || !digestPattern.test(manifest.sha256) || !Array.isArray(manifest.chunks) || manifest.chunks.length !== Math.ceil(manifest.bytes / CHUNK_BYTES)) fail('CHUNK_MANIFEST');
  let total = 0;
  const paths = new Set();
  for (const [index, chunk] of manifest.chunks.entries()) {
    const expected = Math.min(CHUNK_BYTES, manifest.bytes - total);
    if (!chunk || chunk.index !== index || chunk.bytes !== expected || !digestPattern.test(chunk.sha256) || chunk.path !== `/media/${manifest.sha256}-${index}-${chunk.sha256}.bin` || paths.has(chunk.path)) fail('CHUNK_MANIFEST');
    paths.add(chunk.path); total += chunk.bytes;
  }
  if (total !== manifest.bytes) fail('CHUNK_MANIFEST');
  return manifest;
}
export async function splitVideo(data) {
  const manifest = { version: 1, mime: 'video/mp4', bytes: data.length, sha256: await digest(data), chunks: [] };
  const files = [];
  for (let offset = 0, index = 0; offset < data.length; offset += CHUNK_BYTES, index++) {
    const bytes = data.slice(offset, offset + CHUNK_BYTES), sha256 = await digest(bytes);
    const path = `/media/${manifest.sha256}-${index}-${sha256}.bin`;
    manifest.chunks.push({ index, path, bytes: bytes.length, sha256 });
    files.push({ path: path.slice(1), data: bytes });
  }
  validateChunks(manifest);
  return { manifest, files };
}
export async function readChunk(chunk, signal, fetcher = fetch) {
  const response = await fetcher(chunk.path, { signal, redirect: 'error', credentials: 'same-origin' });
  if (!response.ok || response.redirected || !response.body) fail(response.status === 404 ? 'CHUNK_MISSING' : 'CHUNK_HTTP');
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) !== chunk.bytes) { await response.body.cancel(); fail('CHUNK_SIZE'); }
  const reader = response.body.getReader(), bytes = new Uint8Array(chunk.bytes); let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const next = await reader.read(); if (next.done) break;
      if (size + next.value.length > chunk.bytes) fail('CHUNK_SIZE');
      bytes.set(next.value, size); size += next.value.length;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (size !== chunk.bytes) fail('CHUNK_SIZE');
  if (await digest(bytes) !== chunk.sha256) fail('CHUNK_DIGEST');
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return bytes;
}
// One controller owns at most one cached/in-flight first chunk and one active Blob.
export function createVideoLoader(fetcher = fetch) {
  let prefetched = false, cache = null, active = null, objectUrl = null, generation = 0;
  const releaseUrl = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; };
  function release() { prefetched = true; generation++; active?.abort(); active = null; cache?.controller.abort(); cache = null; releaseUrl(); }
  function prefetch(manifest, connection) {
    if (prefetched) return; prefetched = true;
    if (connection?.saveData || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType)) return;
    validateChunks(manifest);
    const controller = new AbortController();
    const entry = { key: manifest.chunks[0].path, controller, promise: readChunk(manifest.chunks[0], controller.signal, fetcher) };
    cache = entry;
    void entry.promise.catch(() => { if (cache === entry) cache = null; });
  }
  function hide() { if (!active) { cache?.controller.abort(); cache = null; } }
  async function load(manifest) {
    prefetched = true;
    validateChunks(manifest); active?.abort(); releaseUrl();
    const ticket = ++generation, controller = new AbortController(); active = controller;
    if (cache && cache.key !== manifest.chunks[0].path) { cache.controller.abort(); cache = null; }
    const cached = cache; cache = null;
    const cancelCached = () => cached?.controller.abort(); controller.signal.addEventListener('abort', cancelCached, { once: true });
    try {
      const parts = [];
      for (const chunk of manifest.chunks) {
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        parts.push(chunk.index === 0 && cached ? await cached.promise : await readChunk(chunk, controller.signal, fetcher));
      }
      const blob = new Blob(parts, { type: manifest.mime });
      if (await digest(await blob.arrayBuffer()) !== manifest.sha256) fail('VIDEO_DIGEST');
      if (ticket !== generation || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      objectUrl = URL.createObjectURL(blob); return objectUrl;
    } finally { controller.signal.removeEventListener('abort', cancelCached); if (active === controller) active = null; }
  }
  return { prefetch, load, hide, release };
}
