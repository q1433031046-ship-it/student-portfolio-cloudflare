import { env } from 'cloudflare:workers';
import { freezeAndTriggerStaticPublish, advanceStaticPublish, promoteStaticPublish, retryStaticPublish } from '../app/api/_lib/pages-publish';
import { getPagesJob, getPagesSite } from '../app/api/_lib/pages-store';
import { createDefaultPortfolioDocument } from '../app/portfolio/default-document';
import { publishPortfolio, savePortfolioDraft, getPortfolioRecord } from '../app/api/_lib/portfolio-store';
import type { PagesDeployment } from '../app/api/_lib/pages-client';
import { cleanupUnreferencedMedia } from '../app/api/_lib/media-cleanup';

const assets=new Map<string,Uint8Array>(),deployments:Array<PagesDeployment & {manifest:Record<string,string>}>=[];
let canonical:PagesDeployment|undefined,creates=0,uploads=0,loseCreate=false;
const fake:typeof fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.hostname.endsWith('.pages.dev')){
    const d=url.hostname==='fixture.pages.dev'?deployments.find(d=>d.id===canonical?.id):deployments.find(d=>new URL(d.url).hostname===url.hostname);
    const bytes=d&&assets.get(d.manifest[url.pathname]);return new Response(bytes?Uint8Array.from(bytes).buffer:null,{status:bytes?200:404});
  }
  if(url.hostname!=='api.cloudflare.com')throw new Error('Unexpected outbound host');
  const ok=(result:unknown)=>Response.json({success:true,result});
  if(url.pathname.endsWith('/upload-token'))return ok({jwt:'local-fixture-jwt'});
  if(url.pathname.endsWith('/check-missing'))return ok(JSON.parse(String(init?.body)).hashes.filter((k:string)=>!assets.has(k)));
  if(url.pathname.endsWith('/upload')){uploads++;const rows=await new Response(init?.body).json() as {key:string;value:string}[];for(const f of rows)assets.set(f.key,Uint8Array.from(atob(f.value),c=>c.charCodeAt(0)));return ok(null);}
  if(url.pathname.endsWith('/upsert-hashes'))return ok(null);
  if(url.pathname.endsWith('/deployments')&&init?.method==='POST'){
    creates++;const form=init.body as FormData,branch=String(form.get('branch')),id=String(creates).padStart(8,'0');
    const d={id,url:`https://${id}.fixture.pages.dev`,environment:branch==='main'?'production' as const:'preview' as const,latest_stage:{status:'success'},deployment_trigger:{metadata:{branch,commit_message:String(form.get('commit_message'))}},manifest:JSON.parse(String(form.get('manifest')))};
    deployments.push(d);if(d.environment==='production')canonical=d;
    if(loseCreate){loseCreate=false;throw new Error('Simulated accepted request with lost response');}return ok(d);
  }
  if(url.pathname.endsWith('/deployments'))return ok(deployments);
  if(url.pathname.includes('/deployments/'))return ok(deployments.find(d=>d.id===url.pathname.split('/').at(-1)));
  return ok({name:'fixture',production_branch:'main',canonical_deployment:canonical});
};
globalThis.fetch=fake;
const worker = {async fetch(request:Request){
  const db=(env as unknown as {DB:D1Database}).DB;
  const input=await request.json() as {action:string;id?:string;lose?:boolean};
  try {
    let result:unknown;
    if(input.action==='seed'){
      const doc=createDefaultPortfolioDocument();doc.hero.name='Frozen A';
      await db.prepare("INSERT INTO portfolio_documents(id,owner_email,revision,draft_json,published_json,updated_at) VALUES ('default','owner@example.test',1,?,?,'fixture')").bind(JSON.stringify(doc),JSON.stringify(doc)).run();
      await db.prepare("INSERT INTO pages_site(id,project,production_branch,production_url) VALUES ('default','fixture','main','https://fixture.pages.dev')").run();result=true;
    }else if(input.action==='freeze'){result=await freezeAndTriggerStaticPublish((await getPortfolioRecord())!.revision,'owner@example.test');}
    else if(input.action==='edit'){const record=(await getPortfolioRecord())!;record.draft.hero.name='Draft B';result=await savePortfolioDraft(record.draft,record.revision);}
    else if(input.action==='dynamic'){result=await publishPortfolio((await getPortfolioRecord())!.revision);}
    else if(input.action==='advance'){loseCreate=input.lose??false;result=await advanceStaticPublish(input.id!,'owner@example.test');}
    else if(input.action==='promote'){loseCreate=input.lose??false;result=await promoteStaticPublish(input.id!,'owner@example.test');}
    else if(input.action==='retry'){result=await retryStaticPublish(input.id!,'owner@example.test');}
    else if(input.action==='cleanup-fixture'){
      const record=(await getPortfolioRecord())!,draft=record.draft,published=record.published!;
      draft.hero.slides[0].media.key='draft-media';published.hero.slides[0].media.key='published-media';
      await db.prepare("UPDATE portfolio_documents SET draft_json=?,published_json=? WHERE id='default'").bind(JSON.stringify(draft),JSON.stringify(published)).run();
      for(const key of ['draft-media','published-media','pages-media','legacy-media','orphan-media']){
        await db.prepare("INSERT INTO portfolio_media(id,object_key,project_id,slot,filename,content_type,byte_size,uploaded_by,storage_backend,chunk_count) VALUES (?,?,'fixture','cover','fixture.webp','image/webp',7,'fixture','kv',1)").bind(key,key).run();
        await (env as unknown as {MEDIA_KV:KVNamespace}).MEDIA_KV.put(key+'::chunk:0000','fixture');
      }
      await db.prepare("INSERT INTO pages_files(job_id,path,byte_size,content_type,object_key) VALUES (?,'media/history.webp',7,'image/webp','pages-media')").bind(input.id!).run();
      await db.prepare("INSERT INTO static_site_bindings(id,account_identity_hash,site_id,site_slug,expected_commit_sha) VALUES ('default','fixture','old-site','old-site','fixture')").run();
      await db.prepare("INSERT INTO static_publish_jobs(id,source_document_revision,public_revision,candidate_json,candidate_sha256,idempotency_key,provider_request_key,bootstrap_token_sha256,bootstrap_expires_at,status) VALUES ('old-job',1,1,'{}','fixture','old-job','old-request','fixture','2000-01-01','FAILED_FINAL')").run();
      await db.prepare("INSERT INTO static_publish_job_media(job_id,media_id,object_key,public_path,content_type,byte_size,storage_backend,source_etag) VALUES ('old-job','old-media','legacy-media','media/old.webp','image/webp',7,'kv','old')").run();
      const removed=await cleanupUnreferencedMedia(draft,record.revision);
      result={removed,rows:(await db.prepare('SELECT object_key,status FROM portfolio_media ORDER BY object_key').all()).results};
    }
    else if(input.action==='state')result={job:await getPagesJob(input.id!),site:await getPagesSite(),record:await getPortfolioRecord()};
    return Response.json({ok:true,result,creates,uploads});
  }catch(e){return Response.json({ok:false,code:(e as {code?:string}).code,error:String(e),creates,uploads});}
}};
export default worker;
