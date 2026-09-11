import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { splitVideo, validateChunks, createVideoLoader, readChunk, digest, CHUNK_BYTES } from '../app/lib/static-video-chunks.mjs';
import { manualDocument } from '../app/lib/manual-static-document.mjs';
import { packageResponseMessage, PackageMediaError } from '../app/lib/static-package-errors.mjs';

const codec = Buffer.from((await readFile(new URL('fixtures/codec-sample.mp4.base64', import.meta.url), 'utf8')).trim(), 'base64');
// Valid MP4 with a standards-defined free box; codec samples remain unchanged.
const video = Buffer.alloc(40 * 1024 * 1024); codec.copy(video); video.writeUInt32BE(video.length - codec.length, codec.length); video.write('free', codec.length + 4);
const split = await splitVideo(video), manifest = split.manifest;
const get = path => split.files.find(f => '/' + f.path === path).data;
test('40 MiB MP4 splits 16+16+8 and reconstructs byte-identically', async () => {
  assert.deepEqual(manifest.chunks.map(c => c.bytes), [CHUNK_BYTES, CHUNK_BYTES, CHUNK_BYTES / 2]);
  assert.equal(await digest(Buffer.concat(split.files.map(f => f.data))), await digest(video));
});
test('strict manifest rejects missing, duplicate, reordered, outside paths, MIME, size and over-limit', () => {
  for (const change of [m => m.chunks.pop(), m => m.chunks[1] = m.chunks[0], m => m.chunks.reverse(), m => m.chunks[0].path = 'https://evil.test/media/x', m => m.mime = 'text/html', m => m.chunks[0].bytes++, m => m.bytes = 51 * 1024 * 1024]) {
    const m = structuredClone(manifest); change(m); assert.throws(() => validateChunks(m), /CHUNK_MANIFEST/);
  }
});
test('response missing, truncated, oversized and digest errors fail closed', async () => {
  const chunk = manifest.chunks[2];
  const cases = [new Response(null, { status: 404 }), new Response(new Uint8Array(2)), new Response(new Uint8Array(chunk.bytes + 1)), new Response(new Uint8Array(chunk.bytes).fill(7))];
  for (const response of cases) await assert.rejects(readChunk(chunk, new AbortController().signal, async () => response), /CHUNK_(MISSING|SIZE|DIGEST)/);
});
test('prefetch selects one chunk once; click reuses in-flight request and releases URL', async () => {
  const paths = []; let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const loader = createVideoLoader(async path => { paths.push(path); if (paths.length === 1) await gate; return new Response(get(path)); });
  loader.prefetch(manifest); loader.prefetch(manifest);
  const loading = loader.load(manifest); finish();
  const url = await loading;
  assert.equal(paths.length, 3); assert.equal(paths.filter(p => p === manifest.chunks[0].path).length, 1);
  assert.equal(await digest(await (await fetch(url)).arrayBuffer()), manifest.sha256);
  loader.release(); await assert.rejects(fetch(url));
});
test('saveData and slow connections skip; hidden/close abort; no automatic retry', async () => {
  for (const connection of [{saveData:true},{effectiveType:'2g'},{effectiveType:'3g'}]) {
    let calls = 0; const loader = createVideoLoader(async () => { calls++; throw new Error('unexpected'); });
    loader.prefetch(manifest, connection); assert.equal(calls, 0); loader.release();
  }
  let signal, calls = 0;
  const loader = createVideoLoader(async (_path, options) => { calls++; signal = options.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))); });
  loader.prefetch(manifest); loader.hide(); assert(signal.aborted); loader.prefetch(manifest); assert.equal(calls, 1);
  const promise = loader.load(manifest); loader.release(); await assert.rejects(promise, { name: 'AbortError' });
});
test('metadata accepts 40MiB video and reports all invalid media without storage keys', () => {
  const draft = {schemaVersion:5,settings:{},hero:{},endCovers:{},themes:[],categories:[],projects:[{finalVideo:{kind:'video',label:'作品视频',key:'private/video'}}]};
  const row = {id:'v',object_key:'private/video',status:'uploaded',content_type:'video/mp4',byte_size:video.length};
  assert.equal(manualDocument(draft,[row]).media[0].bytes, video.length);
  draft.projects.push({cover:{kind:'image',label:'封面',key:'private/missing'}});
  try { manualDocument(draft,[{...row,byte_size:51*1024*1024}]); assert.fail(); } catch (error) {
    assert(error instanceof PackageMediaError); assert.equal(error.issues.length,2); assert(!JSON.stringify(error.issues).includes('private/'));
  }
});
test('HTTP diagnostics distinguish auth, revision, missing route, media and server errors, discard raw HTML', () => {
  const messages = [401,403,428,409,422,404,500].map(status => packageResponseMessage(status, '<script>secret</script>', 79));
  assert.equal(new Set(messages).size, 7);
  for (const message of messages) { assert(!message.includes('<script>')); assert(message.includes('revision=79')); }
});
