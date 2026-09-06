import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { hash } from 'blake3-wasm';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('.pages-workerd',{recursive:true});
await build({entryPoints:['tests/pages-workerd-entry.ts'],bundle:true,format:'esm',platform:'browser',outfile:'.pages-workerd/protocol.js'});
const mf=new Miniflare(convertV4MiniflareOptions({name:'pages-protocol',modules:true,scriptPath:'.pages-workerd/protocol.js',compatibilityDate:'2026-09-01',d1Databases:['DB']}));
const results=[];
try {
  for(const size of [0,1,2,3,49153,1293044,25*1024*1024]){
    const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=i%251;
    const chunk=size===25*1024*1024?4*1024*1024:65537;
    const start=Date.now();const response=await mf.dispatchFetch('http://local/',{method:'POST',body:JSON.stringify({size,chunk,upload:true})});const body=await response.json();
    assert.equal(body.ok,true,JSON.stringify(body));assert.equal(body.key,hash(bytes.toString('base64')+'mp4').toString('hex').slice(0,32));assert.equal(body.sha256,createHash('sha256').update(bytes).digest('hex'));
    results.push({size,sourceChunkBytes:chunk,oracle:'blake3-wasm',elapsedMs:Date.now()-start,upload:true,sink:'streaming base64 decode with exact byte count and SHA256; no full body buffering'});
  }
  for(const input of [{size:25*1024*1024+1,chunk:100},{size:4096,chunk:31,upload:true,changed:true},{size:4096,chunk:31,upload:true,fail:true}]){
    const body=await(await mf.dispatchFetch('http://local/',{method:'POST',body:JSON.stringify(input)})).json();assert.equal(body.ok,false);assert.equal(body.calls,input.upload?1:0);results.push({failureInput:input,result:body});
  }
  const db=await mf.getD1Database('DB');let migrations=0;
  for(const name of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort()){
    const sql=await readFile('drizzle/'+name,'utf8');for(const statement of sql.split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(statement).run();migrations++;
  }
  const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('pages_jobs','pages_site','pages_files','static_publish_jobs','portfolio_documents') ORDER BY name").all()).results;
  assert.equal(tables.length,5);results.push({localForwardMigrations:migrations,preservedTables:tables});
  await writeFile('.pages-workerd/protocol-verification.json',JSON.stringify({runtime:'real workerd via Miniflare; synthetic local fixtures; no provider request',results},null,2));
  console.log(JSON.stringify(results));
}finally{await mf.dispose();}
