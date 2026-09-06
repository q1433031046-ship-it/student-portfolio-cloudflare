import { env } from "cloudflare:workers";
import { getPortfolioDb, getPortfolioRecord } from "./portfolio-store";
import { freezeStaticCandidate, canonicalJson, sha256Hex } from "./static-site-contract";
import { PagesClient, PagesError, digestPagesFile, preflightPagesFiles, type PagesDeployment } from "./pages-client";
import { getPagesSite, getPagesJob, getPagesFiles, asPagesFile, claimPagesStep, releasePagesStep, pagesUpdate, type PagesJob, type PagesSite } from "./pages-store";
import { template, templateRows, encodeText, inlineBytes, openPagesFile, PAGES_HEADERS } from "./pages-files";
import { writeAuditLog } from "./audit";

export { PagesError as StaticPublishError } from "./pages-client";
type Bindings = { PAGES_ACCOUNT_ID?: string; PAGES_API_TOKEN?: string; WORKER_PUBLIC_ORIGIN?: string };
function settings(site: PagesSite) {
  const bindings=env as unknown as Bindings;
  const origin=new URL(bindings.WORKER_PUBLIC_ORIGIN ?? "https://invalid.invalid");
  if(!bindings.WORKER_PUBLIC_ORIGIN || origin.protocol!=="https:" || origin.pathname!=="/" || origin.search || origin.hash)throw new PagesError("PAGES_UNCONFIGURED","请先配置原后台固定网址");
  return { client:new PagesClient(bindings.PAGES_ACCOUNT_ID ?? "",site.project,bindings.PAGES_API_TOKEN ?? ""),adminUrl:new URL("/admin",origin).href };
}
function requireSite(site: PagesSite|null): asserts site is PagesSite {
  if(!site || !site.production_branch || site.production_url!==`https://${site.project}.pages.dev`)throw new PagesError("PAGES_UNCONFIGURED","尚未配置唯一Cloudflare Pages项目");
}
function deploymentUrl(value:string,site:PagesSite) {
  const url=new URL(value);
  if(url.protocol!=="https:" || !new RegExp(`^[a-f0-9]+\\.${site.project}\\.pages\\.dev$`,"u").test(url.hostname) || url.pathname!=="/" || url.search || url.hash || url.username || url.password)throw new PagesError("PAGES_DEPLOY_URL","部署返回的固定制品网址无效");
  return url.origin;
}
const marker=(job:PagesJob,production:boolean)=>`portfolio:${job.id}:${job.artifact_hash}:${production?"production":"preview"}`;
const previewBranch=(job:PagesJob)=>`portfolio-preview-${job.id.slice(4,20)}`;
async function assertProject(client:PagesClient,site:PagesSite) { const p=await client.getProject();if(p.name!==site.project || p.production_branch!==site.production_branch)throw new PagesError("PAGES_PROJECT_DRIFT","Pages项目或生产分支已变化");return p; }

export async function freezeAndTriggerStaticPublish(revision:number,actor:string) {
  const [record,site]=await Promise.all([getPortfolioRecord(),getPagesSite()]);requireSite(site);
  const {adminUrl}=settings(site);
  if(!record || record.revision!==revision)throw new PagesError("STATIC_REVISION_CONFLICT","草稿已变化，请刷新后再发布");
  const rows=(await getPortfolioDb().prepare("SELECT id,object_key,content_type,byte_size,storage_backend,status,(SELECT source_etag FROM legacy_media_migrations WHERE media_id=portfolio_media.id) source_etag FROM portfolio_media WHERE status='uploaded'")
    .all<{id:string;object_key:string;content_type:string;byte_size:number;storage_backend:"kv"|"r2";status:string;source_etag:string|null}>()).results;
  const frozen=await freezeStaticCandidate(record.draft,rows.map(r=>({id:r.id,objectKey:r.object_key,contentType:r.content_type,byteSize:r.byte_size,storageBackend:r.storage_backend,sourceEtag:r.source_etag ?? r.id,status:r.status})));
  const inline=(path:string,text:string,type:string)=>({path,byte_size:new TextEncoder().encode(text).length,content_type:type,inline_base64:encodeText(text)});
  const files=[...templateRows(frozen.candidate.settings.siteTitle,adminUrl),inline("data/portfolio.json",frozen.canonicalJson,"application/json"),inline("_headers",PAGES_HEADERS,"text/plain"),
    ...frozen.media.map(m=>({path:m.publicPath,byte_size:m.byteSize,content_type:m.contentType,object_key:m.objectKey,storage_backend:m.storageBackend,source_etag:m.sourceEtag}))];
  preflightPagesFiles([...files.map(f=>({path:f.path,byteSize:f.byte_size})),{path:"__static-release.json",byteSize:1024}]);
  const serialized=JSON.stringify(files);if(new TextEncoder().encode(serialized).length>1024*1024)throw new PagesError("PAGES_MANIFEST_LIMIT","静态模板及文件清单超过本次安全预算");
  const id=`job_${crypto.randomUUID().replaceAll("-","")}`,db=getPortfolioDb();
  const [inserted]=await db.batch([
    db.prepare(`INSERT INTO pages_jobs(id,source_revision,candidate_json,candidate_hash,template_hash,status,created_at)
      SELECT ?,?,?,?,?,'FROZEN',? WHERE EXISTS(SELECT 1 FROM portfolio_documents WHERE id='default' AND revision=?)
      AND NOT EXISTS(SELECT 1 FROM pages_jobs WHERE status NOT IN ('PUBLISHED','FAILED_FINAL'))
      AND NOT EXISTS(SELECT 1 FROM json_each(?) f LEFT JOIN portfolio_media m ON m.object_key=json_extract(f.value,'$.object_key')
        WHERE json_extract(f.value,'$.object_key') IS NOT NULL AND (m.status IS NULL OR m.status!='uploaded'))`)
      .bind(id,revision,frozen.canonicalJson,frozen.candidateSha256,template.identity,new Date().toISOString(),revision,serialized),
    db.prepare(`INSERT INTO pages_files(job_id,path,byte_size,content_type,inline_base64,object_key,storage_backend,source_etag)
      SELECT ?,json_extract(value,'$.path'),json_extract(value,'$.byte_size'),json_extract(value,'$.content_type'),json_extract(value,'$.inline_base64'),json_extract(value,'$.object_key'),json_extract(value,'$.storage_backend'),json_extract(value,'$.source_etag')
      FROM json_each(?) WHERE EXISTS(SELECT 1 FROM pages_jobs WHERE id=?)`).bind(id,serialized,id),
  ]);
  if(inserted.meta.changes!==1)throw new PagesError("PAGES_FREEZE_CONFLICT","已有静态任务，或草稿/媒体状态已变化");
  await writeAuditLog({actorEmail:actor,action:"pages.freeze",targetType:"pages_job",targetId:id,summary:{sourceRevision:revision,candidateSha256:frozen.candidateSha256}});
  return {job:await getPagesJob(id),repeated:false};
}

export async function advanceStaticPublish(id:string,actor:string) {return runStep(id,actor,false);}
export async function promoteStaticPublish(id:string,actor:string) {return runStep(id,actor,true);}
async function runStep(id:string,actor:string,production:boolean) {
  const token=await claimPagesStep(id),db=getPortfolioDb();
  try {
    const job=await getPagesJob(id),site=await getPagesSite();requireSite(site);if(!job)throw new PagesError("PAGES_JOB_MISSING","任务不存在");
    const files=await getPagesFiles(id);
    if(job.status==="FROZEN") {
      const file=files.find(f=>!f.asset_key);
      if(file){const digest=await digestPagesFile(file.path,await openPagesFile(file),file.byte_size);
        await db.prepare("UPDATE pages_files SET sha256=?,asset_key=? WHERE job_id=? AND path=? AND EXISTS(SELECT 1 FROM pages_jobs WHERE id=? AND lock_token=? AND lock_until>?)")
          .bind(digest.sha256,digest.key,id,file.path,id,token,Date.now()).run();return {job:await getPagesJob(id),waiting:true};}
      if(!job.artifact_hash){
        const artifact=await sha256Hex(canonicalJson(files.map(f=>({path:f.path,byteSize:f.byte_size,sha256:f.sha256}))));
        const text=canonicalJson({schemaVersion:1,jobId:id,sourceRevision:job.source_revision,candidateSha256:job.candidate_hash,templateSha256:job.template_hash,artifactSha256:artifact});
        await db.prepare("INSERT INTO pages_files(job_id,path,byte_size,content_type,inline_base64) SELECT ?,'__static-release.json',?,'application/json',? WHERE EXISTS(SELECT 1 FROM pages_jobs WHERE id=? AND lock_token=? AND lock_until>?)")
          .bind(id,new TextEncoder().encode(text).length,encodeText(text),id,token,Date.now()).run();
        await pagesUpdate(id,token,{artifact_hash:artifact});return {job:await getPagesJob(id),waiting:true};
      }
      await pagesUpdate(id,token,{status:"BUILD_TRIGGERED"});return {job:await getPagesJob(id),waiting:true};
    }
    const {client}=settings(site);await assertProject(client,site);
    if(job.status==="BUILD_TRIGGERED") {
      const file=files.find(f=>!f.uploaded && f.path!=="_headers");
      if(file){const jwt=await client.uploadToken(),missing=await client.checkMissing([asPagesFile(file).key],jwt);
        if(missing.includes(file.asset_key!)){
          if(file.upload_attempts>=2)throw new PagesError("PAGES_ASSET_ATTEMPTS_EXHAUSTED","该资产已达到两次有界尝试上限");
          const updated=await db.prepare("UPDATE pages_files SET upload_attempts=upload_attempts+1 WHERE job_id=? AND path=? AND EXISTS(SELECT 1 FROM pages_jobs WHERE id=? AND lock_token=? AND lock_until>?)")
            .bind(id,file.path,id,token,Date.now()).run();if(updated.meta.changes!==1)throw new PagesError("PAGES_STEP_CONFLICT","任务锁已变化");
          // Persist a stop state before the write. A lost process requires an explicit retry.
          await pagesUpdate(id,token,{status:"FAILED_RETRYABLE",error_code:"PAGES_UPLOAD_INFLIGHT",error_summary:"资产上传处理中；中断后请明确重试原任务"});
          await client.upload(asPagesFile(file),await openPagesFile(file),jwt);
        }
        await client.upsert([file.asset_key!],jwt);
        await db.prepare("UPDATE pages_files SET uploaded=1 WHERE job_id=? AND path=? AND EXISTS(SELECT 1 FROM pages_jobs WHERE id=? AND lock_token=? AND lock_until>?)")
          .bind(id,file.path,id,token,Date.now()).run();
        await pagesUpdate(id,token,{status:"BUILD_TRIGGERED",error_code:null,error_summary:null});
        return {job:await getPagesJob(id),waiting:true};
      }
      if(previewBranch(job)===site.production_branch)throw new PagesError("PAGES_PREVIEW_BRANCH","预览分支不得等于生产分支");
      await pagesUpdate(id,token,{status:"DRAFT_DEPLOY_LOCATED",preview_attempted:1,lookup_count:0});
      const deployment=await client.createDeployment(files.map(asPagesFile),previewBranch(job),marker(job,false),frozenHeaders(files));
      await saveDeployment(job,token,site,deployment,false);return {job:await getPagesJob(id),waiting:true};
    }
    if(job.status==="ARTIFACT_VERIFIED") {
      if(!production)return {job,waiting:false};
      // Hashes belong to frozen rows, not the current draft or newly compiled template.
      await pagesUpdate(id,token,{status:"PUBLISH_REQUESTED",production_attempted:1,lookup_count:0});
      const deployment=await client.createDeployment(files.map(asPagesFile),site.production_branch,marker(job,true),frozenHeaders(files));
      await saveDeployment(job,token,site,deployment,true);return {job:await getPagesJob(id),waiting:true};
    }
    const isProduction=["PUBLISH_REQUESTED","PRODUCTION_READBACK_VERIFIED"].includes(job.status);
    if(!["DRAFT_DEPLOY_LOCATED","DRAFT_DEPLOY_READY","PUBLISH_REQUESTED","PRODUCTION_READBACK_VERIFIED"].includes(job.status))return {job,waiting:false};
    const deployId=isProduction?job.production_id:job.preview_id;
    if(!deployId){if(job.lookup_count>=10)throw new PagesError("PAGES_LOOKUP_LIMIT","原部署核验已达10次上限，需要人工只读核定；不会重复创建");await pagesUpdate(id,token,{lookup_count:job.lookup_count+1});}
    const deployments=deployId?[await client.getDeployment(deployId)]:(await client.listDeployments()).filter(d=>d.deployment_trigger?.metadata?.commit_message===marker(job,isProduction));
    if(deployments.length!==1)throw new PagesError("PAGES_DEPLOY_UNKNOWN","无法唯一确认原部署；保留未知状态，不重发创建请求");
    const deployment=deployments[0];await saveDeployment(job,token,site,deployment,isProduction);
    if(deployment.latest_stage.status!=="success") {
      if(["failure","failed","canceled"].includes(deployment.latest_stage.status))throw new PagesError("PAGES_DEPLOY_FAILED","Cloudflare部署失败，请检查原任务");
      if(job.lookup_count>=10)throw new PagesError("PAGES_LOOKUP_LIMIT","原部署状态核验已达10次上限，需要人工核定");
      if(deployId)await pagesUpdate(id,token,{lookup_count:job.lookup_count+1});
      return {job:await getPagesJob(id),waiting:true};
    }
    if(!await verifyNextPublishedFile(deploymentUrl(deployment.url,site),files,isProduction?"production_verified":"preview_verified",id,token))return {job:await getPagesJob(id),waiting:true};
    if(isProduction){const project=await client.getProject();if(project.canonical_deployment?.id!==deployment.id)throw new PagesError("PAGES_PRODUCTION_DRIFT","固定网址当前版本与本次部署不一致");
      if(!await verifyNextPublishedFile(site.production_url,files,"canonical_verified",id,token))return {job:await getPagesJob(id),waiting:true};
      await db.batch([
        db.prepare("UPDATE pages_jobs SET status='PUBLISHED',completed_at=?,error_code=NULL,error_summary=NULL WHERE id=? AND lock_token=? AND lock_until>?").bind(new Date().toISOString(),id,token,Date.now()),
        db.prepare("UPDATE pages_site SET previous_job=current_job,previous_deploy=current_deploy,current_job=?,current_deploy=?,public_revision=public_revision+1,last_success_at=? WHERE id='default' AND current_job IS NOT ? AND EXISTS(SELECT 1 FROM pages_jobs WHERE id=? AND status='PUBLISHED' AND lock_token=?)")
          .bind(id,deployment.id,new Date().toISOString(),id,id,token),
        db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM pages_site WHERE id='default' AND current_job=? AND current_deploy=?) AND EXISTS(SELECT 1 FROM pages_jobs WHERE id=? AND status='PUBLISHED' AND lock_token=?) THEN 1 ELSE abs(-9223372036854775808) END AS committed").bind(id,deployment.id,id,token),
      ]);
      await writeAuditLog({actorEmail:actor,action:"pages.production.verified",targetType:"pages_job",targetId:id,summary:{artifactSha256:job.artifact_hash}});
    }else await pagesUpdate(id,token,{status:"ARTIFACT_VERIFIED",error_code:null,error_summary:null});
    return {job:await getPagesJob(id),waiting:false};
  }catch(error){
    const job=await getPagesJob(id);const known=error instanceof PagesError?error:new PagesError("PAGES_OPERATION_FAILED","静态发布本步未完成，请核验原任务",503);
    if(job)await pagesUpdate(id,token,{error_code:known.code,error_summary:known.message,...(job.status==="BUILD_TRIGGERED"?{status:"FAILED_RETRYABLE"}:{})}).catch(()=>undefined);
    throw known;
  }finally{await releasePagesStep(id,token);}
}
function frozenHeaders(files: Awaited<ReturnType<typeof getPagesFiles>>) {
  const file=files.find(f=>f.path==='_headers');
  if(!file?.inline_base64 || !file.sha256)throw new PagesError('PAGES_HEADERS_MISSING','冻结响应头缺失');
  return new TextDecoder().decode(inlineBytes(file.inline_base64));
}
async function saveDeployment(job:PagesJob,token:string,site:PagesSite,d:PagesDeployment,production:boolean){
  if(d.environment!==(production?"production":"preview") || d.deployment_trigger?.metadata?.commit_message!==marker(job,production)
    || d.deployment_trigger?.metadata?.branch!==(production?site.production_branch:previewBranch(job)))throw new PagesError("PAGES_DEPLOY_IDENTITY","部署环境或冻结身份不符，立即停止");
  const url=deploymentUrl(d.url,site);
  await pagesUpdate(job.id,token,production?{production_id:d.id,production_url:url,status:"PRODUCTION_READBACK_VERIFIED"}:{preview_id:d.id,preview_url:url,status:"DRAFT_DEPLOY_READY"});
}
async function verifyNextPublishedFile(origin:string,files:Awaited<ReturnType<typeof getPagesFiles>>,field:"preview_verified"|"production_verified"|"canonical_verified",id:string,token:string){
  const file=files.find(f=>f.path!=="_headers"&&!f[field]);if(!file)return true;
  const response=await fetch(`${origin}/${file.path}`,{redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(20_000)});
    if(!response.ok || !response.body)throw new PagesError("PAGES_ARTIFACT_READBACK","静态制品文件未能读回");
    const digest=await digestPagesFile(file.path,response.body,file.byte_size);if(digest.sha256!==file.sha256)throw new PagesError("PAGES_ARTIFACT_MISMATCH","静态制品内容与冻结快照不符");
  const result=await getPortfolioDb().prepare(`UPDATE pages_files SET ${field}=1 WHERE job_id=? AND path=? AND EXISTS(SELECT 1 FROM pages_jobs WHERE id=? AND lock_token=? AND lock_until>?)`).bind(id,file.path,id,token,Date.now()).run();
  if(result.meta.changes!==1)throw new PagesError("PAGES_STEP_CONFLICT","读回过程中任务锁已变化");return false;
}
export async function retryStaticPublish(id:string,actor:string){const token=await claimPagesStep(id);try{const job=await getPagesJob(id);if(job?.status!=="FAILED_RETRYABLE")throw new PagesError("PAGES_RETRY_FORBIDDEN","当前状态仅允许核验原部署");await pagesUpdate(id,token,{status:"BUILD_TRIGGERED",error_code:null,error_summary:null});}finally{await releasePagesStep(id,token);}return advanceStaticPublish(id,actor);}
export async function rollbackStaticPublish(){throw new PagesError("PAGES_ROLLBACK_REVIEW_REQUIRED","正式站点回滚由发布角色核定准确版本后执行");}
