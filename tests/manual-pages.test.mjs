import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { manualDocument } from '../app/lib/manual-static-document.mjs';
import { buildManualFiles, storeZip, validatePublicDocument, TEMPLATE_ID } from '../app/lib/manual-static-package.mjs';

const draft = { schemaVersion: 5, settings: { siteTitle: '真实展示' }, hero: { slides: [{ media: { id: 'a', kind: 'image', key: 'uploads/a', alt: '图片' } }] }, endCovers: {}, themes: [], categories: [], projects: [], archivedMedia: [{ key: 'private/archive' }] };
const row = { id: 'a', object_key: 'uploads/a', status: 'uploaded', content_type: 'image/png', byte_size: 3 };
test('public projection strips source keys/archive and exports only referenced media', () => {
  const result = manualDocument(draft, [row, { ...row, id: 'unused', object_key: 'unused' }]);
  assert.equal(result.media.length, 1);
  assert.equal(result.document.hero.slides[0].media.src, '/media/a.png');
  assert.equal(JSON.stringify(result.document).includes('uploads/a'), false);
  assert.equal('archivedMedia' in result.document, false);
  assert.equal(result.media[0].downloadPath, '/api/media/uploads/a');
});
test('missing media, mismatched type, source traversal and private fields fail closed', () => {
  assert.throws(() => manualDocument(draft, []));
  assert.throws(() => manualDocument(draft, [{ ...row, content_type: 'video/mp4' }]));
  assert.throws(() => manualDocument({ ...draft, hero: { media: { kind: 'image', key: '../a' } } }, [{ ...row, object_key: '../a' }]));
  assert.throws(() => manualDocument({ ...draft, settings: { password: 'not-for-export' } }, [row]));
  assert.throws(() => validatePublicDocument({ schemaVersion: 5, settings: { src: 'https://other.invalid/a' } }, new Set()));
});
test('same pinned template produces complete local files and rejects truncated media', async () => {
  const template = JSON.parse(await readFile(new URL('../public/manual-pages-template.json', import.meta.url), 'utf8'));
  assert.equal(template.identity, TEMPLATE_ID);
  const data = { ...manualDocument(draft, [row]), template, adminOrigin: 'https://portfolio.example.test', headers: '/*\n  X-Content-Type-Options: nosniff\n' };
  const files = await buildManualFiles(data, async () => new Uint8Array([1, 2, 3]));
  assert.equal(files.length, 6);
  const html = new TextDecoder().decode(files.find(f => f.path === 'index.html').data);
  assert.ok(html.includes('https://portfolio.example.test/admin'));
  assert.equal(html.includes('__STATIC_SITE_TITLE__'), false);
  const zip = new Uint8Array(await storeZip(files).arrayBuffer());
  assert.equal(new DataView(zip.buffer).getUint32(0, true), 0x04034b50);
  assert.equal(new DataView(zip.buffer).getUint16(zip.length - 12, true), 6);
  await assert.rejects(buildManualFiles(data, async () => new Uint8Array([1])));
  await assert.rejects(buildManualFiles({ ...data, template: { ...template, identity: 'wrong' } }, async () => new Uint8Array(3)));
  assert.throws(() => storeZip([{ path: '../escape', data: new Uint8Array() }]));
});

async function isolatedModule(path, overrides = {}) {
  let effects = 0;
  class PagesError extends Error { constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; } }
  const context = vm.createContext({ Response, Request, URL, console });
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' });
  const entry = new vm.SourceTextModule(compiled.code, { context });
  const fail = () => { effects++; throw new Error('Unexpected side effect'); };
  const exports = { PagesError, runnerConfig: fail, runnerRequest: fail, freezeSafeSnapshot: fail, getPagesSite: fail, getPagesJobSummary: fail, writeAuditLog: fail,
    requirePagesManager: async () => Response.json({ error: 'login' }, { status: 401 }), getPortfolioDb: fail, getPortfolioRecord: fail,
    mediaAssetsInDocument: fail, manualDocument: fail, PAGES_HEADERS: '', TEMPLATE_ID, ...overrides };
  await entry.link(() => new vm.SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context }));
  await entry.evaluate(); return { namespace: entry.namespace, effects: () => effects };
}
test('all automatic service entries reject with 423 before configuration or writes', async () => {
  const subject = await isolatedModule('../app/api/_lib/pages-publish.ts');
  for (const name of ['freezeAndTriggerStaticPublish', 'advanceStaticPublish', 'retryStaticPublish', 'promoteStaticPublish']) {
    await assert.rejects(subject.namespace[name](32, 'admin'), error => error.code === 'STATIC_AUTOMATION_PAUSED' && error.status === 423);
  }
  assert.equal(subject.effects(), 0);
});
test('runner POST rejects before configuration, lease or provider calls', async () => {
  const subject = await isolatedModule('../app/api/pages-runner/route.ts');
  const response = await subject.namespace.POST(new Request('https://example.invalid/api/pages-runner', { method: 'POST' }));
  assert.equal(response.status, 423); assert.equal(subject.effects(), 0);
});
test('unauthenticated export never reads draft or media', async () => {
  const subject = await isolatedModule('../app/api/admin/static-package/route.ts');
  const response = await subject.namespace.GET(new Request('https://example.invalid/api/admin/static-package?revision=32'));
  assert.equal(response.status, 401); assert.equal(subject.effects(), 0);
});
test('export rejects revision drift before media lookup', async () => {
  const subject = await isolatedModule('../app/api/admin/static-package/route.ts', { requirePagesManager: async () => ({ identity: {} }), getPortfolioRecord: async () => ({ revision: 33 }) });
  const response = await subject.namespace.GET(new Request('https://example.invalid/api/admin/static-package?revision=32'));
  assert.equal(response.status, 409); assert.equal(subject.effects(), 0);
});
