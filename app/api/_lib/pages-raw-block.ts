import { PagesError } from './pages-errors';
import { getMediaKv, getBucket, kvChunkKey, KV_UPLOAD_CHUNK_SIZE } from './storage';
export async function rawFrozenBlock(db: D1Database, job: string, fileIndex: number, block: number) {
  if (!Number.isSafeInteger(fileIndex) || fileIndex < 0 || fileIndex >= 20000 || !Number.isSafeInteger(block) || block < 0 || block > 6) throw new PagesError('RUNNER_BLOCK', '冻结块编号无效');
  const file = await db.prepare('SELECT object_key,storage_backend,source_etag,byte_size FROM pages_files WHERE job_id=? AND object_key IS NOT NULL ORDER BY path LIMIT 1 OFFSET ?').bind(job, fileIndex).first<{ object_key: string; storage_backend: string; source_etag: string; byte_size: number }>();
  if (!file || block * KV_UPLOAD_CHUNK_SIZE >= file.byte_size) throw new PagesError('RUNNER_BLOCK', '此任务不存在该冻结块', 404);
  const length = Math.min(KV_UPLOAD_CHUNK_SIZE, file.byte_size - block * KV_UPLOAD_CHUNK_SIZE);
  let stream: ReadableStream<Uint8Array> | null;
  if (file.storage_backend === 'kv') {
    stream = await getMediaKv().get(kvChunkKey(file.object_key, block), { type: 'stream', cacheTtl: 60 });
  } else if (file.storage_backend === 'r2') {
    const object = await getBucket().get(file.object_key, { range: new Headers({ Range: `bytes=${block * KV_UPLOAD_CHUNK_SIZE}-${block * KV_UPLOAD_CHUNK_SIZE + length - 1}` }) });
    if (!object || object.httpEtag.trim() !== file.source_etag || object.size !== file.byte_size || object.range?.offset !== block * KV_UPLOAD_CHUNK_SIZE || object.range?.length !== length) { await object?.body.cancel(); throw new PagesError('RUNNER_MEDIA_CHANGED', '冻结源身份已变化'); }
    stream = object.body;
  } else throw new PagesError('RUNNER_STORAGE', '冻结存储类型无效');
  if (!stream) throw new PagesError('RUNNER_MEDIA_MISSING', '冻结块缺失');
  // No buffer/base64/hash transform. The runner checks exact received length and computes hashes.
  return new Response(stream, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Pages-Block-Bytes': String(length), 'X-Pages-Block-Index': String(block) } });
}
