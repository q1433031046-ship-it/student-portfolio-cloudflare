import { PagesError } from './pages-errors';
import { validateSource, type SourceIdentity } from './pages-github';

const safeTop = `json_object('schemaVersion',5,'settings',json_extract(draft_json,'$.settings'),'hero',json_extract(draft_json,'$.hero'),'endCovers',json_extract(draft_json,'$.endCovers'),'themes',json_extract(draft_json,'$.themes'),'categories',json_extract(draft_json,'$.categories'),'projects',json_extract(draft_json,'$.projects'))`;
const extension = `CASE m.content_type WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' WHEN 'image/webp' THEN '.webp' WHEN 'image/gif' THEN '.gif' WHEN 'image/avif' THEN '.avif' WHEN 'video/mp4' THEN '.mp4' WHEN 'font/woff2' THEN '.woff2' WHEN 'font/woff' THEN '.woff' WHEN 'application/font-woff' THEN '.woff' WHEN 'application/x-font-woff' THEN '.woff' END`;
const mediaObjects = `SELECT t.fullkey,t.value FROM pages_jobs j,json_tree(j.candidate_json) t WHERE j.id=? AND t.type='object' AND json_extract(t.value,'$.kind') IN ('image','video','font')`;
const guard = (db: D1Database, condition: string, ...params: Array<string | number>) => db.prepare(`SELECT CASE WHEN ${condition} THEN 1 ELSE abs(-9223372036854775808) END AS invariant`).bind(...params);

/** All document traversal/copying occurs inside D1; the Worker never receives private JSON. */
export async function freezeSafeSnapshot(db: D1Database, revision: number, source: SourceIdentity) {
  validateSource(source);
  const id = `job_${crypto.randomUUID().replaceAll('-', '')}`;
  await db.batch([
    db.prepare(`INSERT INTO pages_jobs(id,source_revision,candidate_json,candidate_hash,template_hash,status,created_at)
      SELECT ?,revision,${safeTop},'',?,'FROZEN',? FROM portfolio_documents WHERE id='default' AND revision=?
      AND json_extract(draft_json,'$.schemaVersion')=5 AND length(CAST(draft_json AS BLOB))<=1048576
      AND NOT EXISTS(SELECT 1 FROM pages_jobs WHERE status NOT IN ('PUBLISHED','FAILED_FINAL'))`).bind(id, source.template, new Date().toISOString(), revision),
    guard(db, 'changes()=1'),
    // Missing/incomplete, unsafe id, incompatible kind or over-limit media fails the entire transaction.
    guard(db, `NOT EXISTS(SELECT 1 FROM (${mediaObjects}) a LEFT JOIN portfolio_media m ON m.object_key=json_extract(a.value,'$.key')
      WHERE json_extract(a.value,'$.key') IS NOT NULL AND (m.id IS NULL OR m.status!='uploaded' OR m.byte_size<1 OR m.byte_size>26214400 OR length(m.id)>128 OR m.id GLOB '*[^a-zA-Z0-9_-]*' OR ${extension} IS NULL
      OR (json_extract(a.value,'$.kind')='video' AND m.content_type!='video/mp4') OR (json_extract(a.value,'$.kind')='image' AND m.content_type NOT LIKE 'image/%') OR (json_extract(a.value,'$.kind')='font' AND m.content_type NOT IN ('font/woff2','font/woff','application/font-woff','application/x-font-woff'))))`, id),
    db.prepare(`INSERT INTO pages_files(job_id,path,byte_size,content_type,object_key,storage_backend,source_etag)
      SELECT DISTINCT ?,'media/'||m.id||${extension},m.byte_size,m.content_type,m.object_key,m.storage_backend,COALESCE((SELECT source_etag FROM legacy_media_migrations WHERE media_id=m.id),m.id)
      FROM (${mediaObjects}) a JOIN portfolio_media m ON m.object_key=json_extract(a.value,'$.key')`).bind(id, id),
    guard(db, `(SELECT COUNT(*)<=19990 AND COALESCE(SUM(byte_size),0)<=838860800 FROM pages_files WHERE job_id=?)`, id),
    // Reconstruct every media object from its public fields, including keyless placeholders.
    db.prepare(`WITH RECURSIVE media AS (
      SELECT row_number() OVER(ORDER BY a.fullkey) n,a.fullkey,
        json_patch(json_object('id',json_extract(a.value,'$.id'),'label',json_extract(a.value,'$.label'),'alt',json_extract(a.value,'$.alt'),'kind',json_extract(a.value,'$.kind'),'visualKey',json_extract(a.value,'$.visualKey')),
          json_patch(json_object('objectPosition',json_extract(a.value,'$.objectPosition'),'sourceAspectRatio',json_extract(a.value,'$.sourceAspectRatio'),'crop',json_extract(a.value,'$.crop')),
            CASE WHEN f.path IS NULL THEN '{}' ELSE json_object('src','/'||f.path,'available',json('true')) END)) replacement
      FROM (${mediaObjects}) a LEFT JOIN pages_files f ON f.job_id=? AND f.object_key=json_extract(a.value,'$.key')
    ), scrub(n,doc) AS (
      SELECT 0,candidate_json FROM pages_jobs WHERE id=? UNION ALL
      SELECT media.n,json_set(scrub.doc,media.fullkey,json(media.replacement)) FROM scrub JOIN media ON media.n=scrub.n+1
    ) UPDATE pages_jobs SET candidate_json=(SELECT doc FROM scrub ORDER BY n DESC LIMIT 1) WHERE id=?`).bind(id, id, id, id),
    // Defense in depth: reject unexpected internal fields before setting safe_ready or allowing CI access.
    guard(db, `NOT EXISTS(SELECT 1 FROM pages_jobs j,json_tree(j.candidate_json) t WHERE j.id=? AND
      (lower(CAST(t.key AS TEXT)) IN ('key','archivedmedia','owneremail','owner_email','accesstoken','tokenhash','auditlogs','bootstrap','leaseid','password','secret','credentials')
       OR lower(CAST(t.key AS TEXT)) LIKE '%token%' OR lower(CAST(t.key AS TEXT)) LIKE '%password%' OR lower(CAST(t.key AS TEXT)) LIKE '%secret%'))
       AND NOT EXISTS(SELECT 1 FROM pages_jobs j JOIN pages_files f ON f.job_id=j.id WHERE j.id=? AND f.object_key IS NOT NULL AND instr(j.candidate_json,f.object_key)>0)`, id, id),
    db.prepare('INSERT INTO pages_runner_sources(job_id,head,ref,template,safe_ready) VALUES(?,?,?,?,1)').bind(id, source.head, source.ref, source.template),
  ]).catch(() => { throw new PagesError('PAGES_FREEZE_REJECTED', '草稿修订、公开字段或媒体不满足冻结条件，请检查原内容'); });
  return id;
}

export async function safeSnapshotPage(db: D1Database, id: string, page: number) {
  if (!Number.isSafeInteger(page) || page < 0 || page > 256) throw new PagesError('RUNNER_PAGE', '快照页编号无效');
  // SQLite counts Unicode characters; 4096 characters use at most 16KiB UTF-8.
  const row = await db.prepare('SELECT substr(candidate_json,?,4096) fragment,length(candidate_json) characters,source_revision FROM pages_jobs j JOIN pages_runner_sources s ON s.job_id=j.id WHERE j.id=? AND s.safe_ready=1').bind(page * 4096 + 1, id).first<{ fragment: string; characters: number; source_revision: number }>();
  if (!row) throw new PagesError('RUNNER_JOB', '安全快照不存在'); return row;
}
