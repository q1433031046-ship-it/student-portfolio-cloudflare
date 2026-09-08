import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { buildManualFiles, storeZip, sha256, TEMPLATE_ID } from '../app/lib/manual-static-package.mjs';

// This local-only command reads explicit private input; it never fetches or publishes.
const [inputArg, mediaArg, templateArg, outputArg, acceptedOmission] = process.argv.slice(2);
if (![inputArg, mediaArg, templateArg, outputArg].every(Boolean)) throw new Error('Expected input.json media-directory template.json new-output-directory');
const input = JSON.parse(await readFile(resolve(inputArg), 'utf8'));
if (input.currentRevision !== 32 || input.job.source_revision !== 32 || input.job.template_hash !== TEMPLATE_ID || input.files.length !== 11) throw new Error('Frozen source identity mismatch');
const template = JSON.parse(await readFile(resolve(templateArg), 'utf8'));
const source = await readFile(new URL('../app/api/_lib/pages-control.ts', import.meta.url), 'utf8');
const match = source.match(/export const PAGES_HEADERS = ("(?:[^"\\]|\\.)*");/);
if (!match) throw new Error('Exact headers not found');
const mediaRoot = resolve(mediaArg);
const document = JSON.parse(input.job.candidate_json);
const omissions = [];
if (acceptedOmission === '--accept-missing-r32-video') {
  const excluded = input.files[1];
  if (excluded.path !== 'media/38b57b8e-dcde-497b-8f62-e49b4765bf08.mp4' || excluded.byte_size !== 1293044 || excluded.content_type !== 'video/mp4') throw new Error('Approved omission identity mismatch');
  let removed = 0;
  const project = value => {
    if (!value || typeof value !== 'object') return;
    if (value.src === `/${excluded.path}`) {
      if (value.kind !== 'video') throw new Error('Omission target is not a video');
      delete value.src; value.available = false; removed++;
    }
    for (const child of Object.values(value)) project(child);
  };
  project(document);
  if (removed !== 1) throw new Error('Expected exactly one approved video reference');
  omissions.push({ path: excluded.path, bytes: excluded.byte_size, reason: 'User explicitly accepted missing test video; only exported copy has playback reference removed', referencesRemoved: removed });
} else if (acceptedOmission) throw new Error('Unknown omission option');
const media = input.files.filter(f => !omissions.some(o => o.path === f.path)).map(f => ({ path: f.path, bytes: f.byte_size, contentType: f.content_type }));
const files = await buildManualFiles({ template, document, media,
  adminOrigin: 'https://student-portfolio.q1433031046.workers.dev', headers: JSON.parse(match[1]) }, async file => {
  const path = resolve(mediaRoot, file.path), rel = relative(mediaRoot, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Media path outside input root');
  return new Uint8Array(await readFile(path));
});
const output = resolve(outputArg);
await mkdir(output); // Exclusive new directory: never overwrite a previous package.
const manifest = [];
for (const file of files) manifest.push({ path: file.path, bytes: file.data.length, sha256: await sha256(file.data) });
const zip = new Uint8Array(await storeZip(files).arrayBuffer());
await writeFile(join(output, 'student-portfolio-r32.zip'), zip, { flag: 'wx' });
for (const file of files) {
  const path = join(output, 'site', file.path); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, file.data, { flag: 'wx' });
}
const receipt = { revision: 32, template: TEMPLATE_ID, files: manifest, zipBytes: zip.length, zipSha256: await sha256(zip), mediaCount: media.length, acceptedOmissions: omissions, sourceInputSha256: await sha256(new Uint8Array(await readFile(resolve(inputArg)))), privateMappingsIncluded: false };
await writeFile(join(output, 'package-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ files: files.length, media: media.length, zipBytes: zip.length, zipSha256: receipt.zipSha256 }));
