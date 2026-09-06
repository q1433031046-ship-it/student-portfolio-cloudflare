import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('.pages-workerd',{recursive:true});
await build({entryPoints:['tests/pages-state-workerd-entry.ts'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:workers'],outfile:'.pages-workerd/state.js'});
const mf=new Miniflare(convertV4MiniflareOptions({name:'pages-state',modules:true,scriptPath:'.pages-workerd/state.js',compatibilityDate:'2026-09-01',d1Databases:['DB'],kvNamespaces:['MEDIA_KV'],bindings:{PAGES_ACCOUNT_ID:'a'.repeat(32),PAGES_API_TOKEN:'local-fixture-token',WORKER_PUBLIC_ORIGIN:'https://worker.example.test'}}));
const results=[];
try{
  const db=await mf.getD1Database('DB');
  for(const name of(await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())for(const s of(await readFile('drizzle/'+name,'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(s).run();
  const call=async(action,extra={})=>(await(await mf.dispatchFetch('http://fixture/',{method:'POST',body:JSON.stringify({action,...extra})})).json());
  assert.equal((await call('seed')).ok,true);
  const frozen=await call('freeze');assert.equal(frozen.ok,true,JSON.stringify(frozen));const id=frozen.result.job.id;
  assert.equal((await call('freeze')).ok,false);
  assert.equal((await call('edit')).ok,true);assert.equal((await call('dynamic')).ok,true);
  let state;
  for(let i=0;i<70;i++){state=await call('state',{id});if(state.result.job.status==='ARTIFACT_VERIFIED')break;const r=await call('advance',{id,lose:true});if(!r.ok)assert.equal(r.code,'PAGES_RESPONSE_UNKNOWN',JSON.stringify(r));}
  assert.equal(state.result.job.status,'ARTIFACT_VERIFIED');assert.equal(state.creates,1);assert.equal(state.result.site.current_deploy,null);assert.equal(state.result.record.published.hero.name,'Draft B');assert.equal(JSON.parse(state.result.job.candidate_json).hero.name,'Frozen A');
  results.push({previewVerified:true,acceptedPreviewLostResponseRecovered:true,previewCreates:state.creates,dynamicIndependent:true,frozenDraftIndependent:true});
  assert.equal((await call('advance',{id})).creates,1);
  const promotion=await call('promote',{id,lose:true});assert.equal(promotion.ok,false);assert.equal(promotion.creates,2);
  for(let i=0;i<70;i++){state=await call('state',{id});if(state.result.job.status==='PUBLISHED')break;const r=await call('advance',{id});assert.equal(r.ok,true,JSON.stringify(r));}
  assert.equal(state.result.job.status,'PUBLISHED');assert.equal(state.creates,2);assert.equal(state.result.site.public_revision,1);assert.equal(state.result.record.published.hero.name,'Draft B');
  results.push({productionVerified:true,acceptedProductionLostResponseRecovered:true,totalCreates:state.creates,publicRevision:1,dynamicSnapshotUnchanged:true});
  const frozen2=await call('freeze');assert.equal(frozen2.ok,true);const id2=frozen2.result.job.id;
  for(let i=0;i<70;i++){state=await call('state',{id:id2});if(state.result.job.status==='ARTIFACT_VERIFIED')break;assert.equal((await call('advance',{id:id2})).ok,true);}
  assert.equal(state.result.site.public_revision,1);
  await call('promote',{id:id2});
  for(let i=0;i<70;i++){state=await call('state',{id:id2});if(state.result.job.status==='PUBLISHED')break;assert.equal((await call('advance',{id:id2})).ok,true);}
  assert.equal(state.result.job.status,'PUBLISHED');assert.equal(state.result.site.public_revision,2);assert.equal(state.result.site.previous_job,id);assert.equal(state.result.site.production_url,'https://fixture.pages.dev');
  results.push({secondUpdateSameFixedUrl:true,publicRevision:2,previousJobPreserved:true});
  const cleaned=await call('cleanup-fixture',{id});assert.equal(cleaned.ok,true,JSON.stringify(cleaned));assert.equal(cleaned.result.removed,1);
  for(const row of cleaned.result.rows)assert.equal(row.status,row.object_key==='orphan-media'?'deleted':'uploaded');
  results.push({realD1KvCleanup:true,draftDynamicPagesAndLegacyReferencesPreserved:true,unreferencedOrphanRemoved:true});
  await writeFile('.pages-workerd/state-verification.json',JSON.stringify({runtime:'real workerd/D1 with local provider fixture; no Cloudflare write',results},null,2));console.log(JSON.stringify(results));
}finally{await mf.dispose();}
