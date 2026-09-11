import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packageStatic } from '../scripts/package-manual-static.mjs';
import { buildManualFiles, TEMPLATE_ID, sha256 } from '../app/lib/manual-static-package.mjs';
const templatePath = new URL('../public/manual-pages-template.json', import.meta.url);
const template = JSON.parse(await readFile(templatePath, 'utf8'));
const description = {revision:2,templateIdentity:TEMPLATE_ID,templatePath:'/manual-pages-template.json',adminOrigin:'https://own.example.test',headers:'/*\n  X-Content-Type-Options: nosniff',document:{schemaVersion:5,settings:{},hero:{src:'/media/a.png'},endCovers:{},themes:[],categories:[],projects:[]},media:[{path:'media/a.png',bytes:3,contentType:'image/png',downloadPath:'/api/media/never-copy-private-key'}]};
test('offline ZIP and site have all bytes/digests; no overwrite, missing and symlink escape reject', async () => {
  const dir = await mkdtemp(path.join(tmpdir(),'portfolio-132-')), mediaDir=path.join(dir,'input'); await mkdir(path.join(mediaDir,'media'),{recursive:true});
  const input = path.join(dir,'description.json'); await writeFile(input, JSON.stringify(description));
  const media = path.join(mediaDir,'media/a.png'); await writeFile(media,new Uint8Array([1,2,3]));
  const options = {description:input,template:templatePath,mediaDir,outDir:path.join(dir,'package')};
  const receipt = await packageStatic(options); assert.equal(receipt.fileCount,6); assert(receipt.webFileLimitsCompatible);
  for (const file of receipt.files) assert.equal(await sha256(await readFile(path.join(options.outDir,'site',file.path))),file.sha256);
  assert.equal(await sha256(await readFile(path.join(options.outDir,receipt.zip.path))),receipt.zip.sha256);
  assert(!JSON.stringify(receipt).includes('private-key')); await assert.rejects(packageStatic(options),/EEXIST/);
  const escaped = structuredClone(description); escaped.media[0].path='media/escape/a.png';escaped.document.hero.src='/media/escape/a.png';
  const external=path.join(dir,'external');await mkdir(external);await writeFile(path.join(external,'a.png'),new Uint8Array([1,2,3]));
  await symlink(external,path.join(mediaDir,'media/escape'),'junction');await writeFile(input,JSON.stringify(escaped));
  await assert.rejects(packageStatic({...options,outDir:path.join(dir,'escape-out')}),/超出/);
  await assert.rejects(buildManualFiles({...description,template},async()=>new Uint8Array(0)),/不完整/);
});
test('final count includes template, data and headers at 1000/1001 boundary', async () => {
  for (const n of [995,996]) {
    const media=Array.from({length:n},(_,i)=>({path:`media/${i}.png`,bytes:1,contentType:'image/png'}));
    const document={...description.document,hero:{},projects:media.map(m=>({src:'/'+m.path}))};
    const files=await buildManualFiles({...description,template,media,document},async()=>new Uint8Array(1));
    assert.equal(files.length,n+5); assert.equal(files.length<=1000,n===995);
  }
});
