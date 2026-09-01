#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build as viteBuild } from "vite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(ROOT, "netlify-dist");
const PAYLOAD_CONTROL_FILES = new Set(["artifact-manifest.json", "__static-release.json"]);

export async function buildNetlifyStatic(options = {}) {
  const environment = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const output = options.output ? resolve(options.output) : OUTPUT;
  const deployId = required(environment.DEPLOY_ID, "DEPLOY_ID");
  const exportOrigin = new URL(required(environment.STATIC_EXPORT_ORIGIN, "STATIC_EXPORT_ORIGIN"));
  if (exportOrigin.protocol !== "https:" && exportOrigin.hostname !== "127.0.0.1" && exportOrigin.hostname !== "localhost") throw new Error("STATIC_EXPORT_ORIGIN 必须使用 HTTPS");
  const hook = parseHookBody(required(environment.INCOMING_HOOK_BODY, "INCOMING_HOOK_BODY"));
  const sourceCommitSha = required(environment.COMMIT_REF ?? environment.HEAD, "COMMIT_REF");
  if (!/^[a-f0-9]{40}$/u.test(sourceCommitSha)) throw new Error("COMMIT_REF 无效");
  const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  try {
    const sessionResponse = await fetcher(new URL(`/api/static-export/${hook.jobId}/session`, exportOrigin), {
      method: "POST", headers: { Authorization: `Bearer ${hook.bootstrapGrant}`, "Content-Type": "application/json" },
      body: JSON.stringify({ generation: hook.generation }),
    });
    const session = await readJson(sessionResponse, "EXPORT_SESSION_FAILED");
    if (typeof session.lease !== "string") throw new Error("EXPORT_SESSION_INVALID");
    const exportHeaders = { Authorization: `Bearer ${session.lease}` };
    const manifestResponse = await fetcher(new URL(`/api/static-export/${hook.jobId}/manifest`, exportOrigin), { headers: exportHeaders });
    const source = await readJson(manifestResponse, "EXPORT_MANIFEST_FAILED");
    validateSourceManifest(source, hook, sourceCommitSha);

    await writeStaticShell(temporary, source.candidate, requiredWorkerAdminUrl(environment.WORKER_ADMIN_URL));
    for (const media of source.media) {
      const response = await fetcher(new URL(`/api/static-export/${hook.jobId}/media/${encodeURIComponent(media.id)}`, exportOrigin), { headers: exportHeaders });
      if (!response.ok || !response.body) throw new Error("EXPORT_MEDIA_FAILED");
      if (response.headers.get("content-type")?.split(";", 1)[0] !== media.contentType) throw new Error("EXPORT_MEDIA_TYPE_MISMATCH");
      const evidence = await writeResponseWithDigests(response, join(temporary, media.publicPath));
      if (evidence.byteSize !== media.byteSize) throw new Error("EXPORT_MEDIA_SIZE_MISMATCH");
    }

    const files = await payloadManifest(temporary);
    const artifactSha256 = sha256(canonicalJson(files));
    const builtAt = new Date().toISOString();
    const artifactManifest = {
      schemaVersion: 1, providerRequestKey: hook.providerRequestKey, deployId, publicRevision: source.publicRevision,
      candidateSha256: source.candidateSha256, sourceCommitSha, artifactSha256, fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.byteSize, 0), files,
    };
    const marker = {
      schemaVersion: 1, programVersion: "1.3.1-b", publicRevision: source.publicRevision,
      candidateSha256: source.candidateSha256, artifactSha256, providerRequestKey: hook.providerRequestKey,
      deployId, sourceCommitSha, siteIdHash: required(environment.NETLIFY_SITE_ID_HASH, "NETLIFY_SITE_ID_HASH"), builtAt,
    };
    await writeFile(join(temporary, "artifact-manifest.json"), canonicalJson(artifactManifest));
    await writeFile(join(temporary, "__static-release.json"), canonicalJson(marker));
    await rm(output, { recursive: true, force: true });
    await rename(temporary, output);
    return { output, artifactManifest, marker };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function writeResponseWithDigests(response, target) {
  await mkdir(dirname(target), { recursive: true });
  const sha256Hash = createHash("sha256"); const sha1Hash = createHash("sha1"); let byteSize = 0;
  const transform = new TransformStream({ transform(chunk, controller) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk); byteSize += bytes.byteLength;
    sha256Hash.update(bytes); sha1Hash.update(bytes); controller.enqueue(bytes);
  }});
  await pipeline(Readable.fromWeb(response.body.pipeThrough(transform)), createWriteStream(target, { flags: "wx" }));
  return { byteSize, sha256: sha256Hash.digest("hex"), providerSha1: sha1Hash.digest("hex") };
}

async function writeStaticShell(root, portfolio, workerAdminUrl) {
  await viteBuild({
    root: join(ROOT, "static-site"),
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    build: { outDir: root, emptyOutDir: false, assetsDir: "assets" },
  });
  await mkdir(join(root, "data"), { recursive: true });
  const indexPath = join(root, "index.html");
  const index = (await readFile(indexPath, "utf8"))
    .replace("__STATIC_SITE_TITLE__", escapeHtml(portfolio?.settings?.siteTitle ?? "学生作品展示"))
    .replace("__WORKER_ADMIN_URL__", escapeHtml(workerAdminUrl));
  await Promise.all([
    writeFile(indexPath, index), writeFile(join(root, "data/portfolio.json"), canonicalJson(portfolio)),
    writeFile(join(root, "_headers"), "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Content-Security-Policy: default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'\n/index.html\n  Cache-Control: public, max-age=0, must-revalidate\n/data/*\n  Cache-Control: public, max-age=0, must-revalidate\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/media/*\n  Cache-Control: public, max-age=31536000, immutable\n"),
    writeFile(join(root, "_redirects"), "/* /index.html 200\n"), writeFile(join(root, "robots.txt"), "User-agent: *\nAllow: /\n"),
  ]);
}

async function payloadManifest(root) {
  const paths = await walk(root); const files = [];
  for (const path of paths.sort((left, right) => left.localeCompare(right, "en"))) {
    const publicPath = relative(root, path).split(sep).join("/"); if (PAYLOAD_CONTROL_FILES.has(publicPath)) continue;
    const bytes = await readFile(path); files.push({ path: publicPath, byteSize: bytes.byteLength, contentType: contentType(publicPath), sha256: sha256(bytes), providerSha1: createHash("sha1").update(bytes).digest("hex") });
  }
  return files;
}

async function walk(root) { const { readdir } = await import("node:fs/promises"); const result=[]; for (const entry of await readdir(root,{withFileTypes:true})) { const path=join(root,entry.name); if(entry.isDirectory()) result.push(...await walk(path)); else result.push(path); } return result; }
function validateSourceManifest(value, hook, sourceCommitSha) { if (!value || value.schemaVersion!==1 || value.jobId!==hook.jobId || value.generation!==hook.generation || value.providerRequestKey!==hook.providerRequestKey || value.sourceCommitSha!==sourceCommitSha || !Array.isArray(value.media) || typeof value.candidateSha256!=="string") throw new Error("EXPORT_MANIFEST_INVALID"); }
function parseHookBody(value) { let body; try { body=JSON.parse(value); } catch { throw new Error("INCOMING_HOOK_BODY 无效"); } if (!body || !/^job_[a-f0-9]{32}$/u.test(body.jobId) || !Number.isSafeInteger(body.generation) || body.generation<1 || !/^sp-[a-f0-9]{24}$/u.test(body.providerRequestKey) || typeof body.bootstrapGrant!=="string" || body.bootstrapGrant.length<20) throw new Error("INCOMING_HOOK_BODY 无效"); return body; }
async function readJson(response, code) { if (!response.ok) throw new Error(code); try { return await response.json(); } catch { throw new Error(code); } }
function canonicalJson(value) { return JSON.stringify(sortValue(value)); }
function sortValue(value) { if(Array.isArray(value))return value.map(sortValue); if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>[k,sortValue(v)])); return value; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function required(value, name) { const normalized=typeof value==="string"?value.trim():""; if(!normalized)throw new Error(`${name} 缺失`); return normalized; }
function requiredWorkerAdminUrl(value) { const url = new URL(required(value, "WORKER_ADMIN_URL")); if(url.protocol!=="https:"||url.pathname!=="/admin"||url.search||url.hash)throw new Error("WORKER_ADMIN_URL 必须是准确的 HTTPS /admin 地址"); return url.toString(); }
function contentType(path) { if(path.endsWith('.html'))return'text/html; charset=utf-8'; if(path.endsWith('.js'))return'text/javascript; charset=utf-8'; if(path.endsWith('.css'))return'text/css; charset=utf-8'; if(path.endsWith('.json'))return'application/json; charset=utf-8'; if(path.endsWith('.mp4'))return'video/mp4'; if(path.endsWith('.webp'))return'image/webp'; if(path.endsWith('.jpg'))return'image/jpeg'; if(path.endsWith('.png'))return'image/png'; if(path.endsWith('.woff2'))return'font/woff2'; return'text/plain; charset=utf-8'; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/gu,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildNetlifyStatic().then((result) => console.log(JSON.stringify({ output: result.output, artifactSha256: result.artifactManifest.artifactSha256, fileCount: result.artifactManifest.fileCount }))).catch((error) => { console.error(error instanceof Error ? error.message : "静态构建失败"); process.exitCode=1; });
