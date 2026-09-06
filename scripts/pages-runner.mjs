import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PagesClient, digestPagesFile, preflightPagesFiles, signControl, CONTROL_LIMIT, RUNNER_PATH, RUNNER_REPOSITORY, RUNNER_WORKFLOW, PAGES_HEADERS, canonicalJson } from '../.pages-workerd/runner-lib.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const streamFile = path => Readable.toWeb(createReadStream(path));
const controls = new Set(['_headers', '_redirects']);
const fail = code => { const error = new Error(code); error.code = code; throw error; };
export class RunnerRpc {
  constructor(config, send = fetch) { this.config = config; this.send = send; this.lease = ''; this.seq = 0; }
  async call(op, args = {}, raw = false) {
    const c = this.config;
    const bytes = new TextEncoder().encode(JSON.stringify({ op, args })); if (bytes.length > CONTROL_LIMIT) fail('RUNNER_BODY_LIMIT');
    const identity = { job: c.job, phase: c.phase, run: c.run, attempt: c.attempt, op, time: Date.now(), nonce: crypto.randomUUID().replaceAll('-', ''), lease: this.lease, seq: op === 'claim' ? 0 : ++this.seq };
    const signature = await signControl(c.secret, identity, bytes);
    const response = await this.send(c.origin + RUNNER_PATH, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { 'Content-Type': 'application/json', 'x-pages-identity': JSON.stringify(identity), 'x-pages-signature': signature }, body: bytes });
    if (raw && response.ok) return response;
    const value = await boundedBytes(response, CONTROL_LIMIT, true); let body;
    try { body = JSON.parse(value.toString('utf8')); } catch { fail('RUNNER_RESPONSE_INVALID'); }
    if (!response.ok) fail(typeof body.code === 'string' ? body.code : 'RUNNER_REQUEST_FAILED');
    return body;
  }
}
async function boundedBytes(response, limit, allowError = false) {
  if (!response.ok && !allowError) { await response.body?.cancel(); fail('RUNNER_READBACK_STATUS'); }
  if (!response.body) fail('RUNNER_BODY_MISSING');
  let length = 0; const parts = [];
  for await (const part of response.body) { length += part.length; if (length > limit) fail('RUNNER_READBACK_LIMIT'); parts.push(Buffer.from(part)); }
  return Buffer.concat(parts, length);
}
const sorted = files => [...files].sort((a, b) => a.path.localeCompare(b.path, 'en'));
const artifactHash = files => sha(canonicalJson(sorted(files).map(f => ({ path: f.path, byteSize: f.byteSize, sha256: f.sha256 }))));
async function allPages(rpc, op) {
  const files = [];
  for (let page = 0; page < 1000; page++) { const result = await rpc.call(op, { page }); files.push(...result.files); if (result.files.length < 20) return files; }
  fail('RUNNER_MANIFEST_LIMIT');
}
const localPath = (directory, path) => join(directory, ...path.split('/'));
async function storeFile(directory, path, bytes, contentType) {
  preflightPagesFiles([{ path, byteSize: bytes.length }]);
  const target = localPath(directory, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
  const digest = await digestPagesFile(path, streamFile(target), bytes.length);
  return { path, byteSize: bytes.length, contentType, ...digest, ...(controls.has(path) ? { control: bytes.toString('base64') } : {}) };
}
function assertPublicDocument(value) {
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    for (const [key, v] of Object.entries(node)) {
      if (/token|password|secret/i.test(key) || ['key', 'archivedMedia', 'ownerEmail', 'owner_email', 'auditLogs', 'bootstrap', 'leaseId', 'credentials'].includes(key)) fail('RUNNER_PRIVATE_FIELD');
      if (key === 'src' && (typeof v !== 'string' || !/^\/media\/[A-Za-z0-9_.-]+$/.test(v))) fail('RUNNER_MEDIA_REFERENCE'); visit(v);
    }
  }; visit(value);
  if (value.schemaVersion !== 5) fail('RUNNER_DOCUMENT_SCHEMA');
}
async function assemblePreview(rpc, status, claim, directory, templatePath) {
  let text = '';
  for (let page = 0; page <= 256; page++) { const chunk = await rpc.call('snapshot', { page }); text += chunk.fragment; if ((page + 1) * 4096 >= chunk.characters) break; }
  if (Buffer.byteLength(text) > 1048576) fail('RUNNER_DOCUMENT_LIMIT');
  const document = JSON.parse(text); assertPublicDocument(document);
  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  const actualTemplate = sha(JSON.stringify(template.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))));
  if (template.identity !== claim.source.template || actualTemplate !== template.identity) fail('RUNNER_TEMPLATE_MISMATCH');
  const media = await allPages(rpc, 'media'); if (media.length) preflightPagesFiles(media);
  if (media.reduce((n, f) => n + f.byteSize, 0) > 800 * 1024 * 1024) fail('RUNNER_MEDIA_LIMIT');
  const files = [];
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  for (const f of template.files) {
    let bytes = Buffer.from(f.base64, 'base64'); if (bytes.length !== f.bytes || sha(bytes) !== f.sha256) fail('RUNNER_TEMPLATE_FILE');
    if (f.path === 'index.html') bytes = Buffer.from(bytes.toString('utf8').replace('__STATIC_SITE_TITLE__', escape(document.settings.siteTitle)).replace('__WORKER_ADMIN_URL__', escape(status.adminUrl)));
    files.push(await storeFile(directory, f.path, bytes, f.path.endsWith('.html') ? 'text/html' : f.path.endsWith('.css') ? 'text/css' : 'application/javascript'));
  }
  const candidate = Buffer.from(canonicalJson(document));
  files.push(await storeFile(directory, 'data/portfolio.json', candidate, 'application/json'));
  files.push(await storeFile(directory, '_headers', Buffer.from(PAGES_HEADERS), 'text/plain'));
  for (let index = 0; index < media.length; index++) {
    const f = media[index], parts = []; let received = 0;
    for (let block = 0; received < f.byteSize; block++) {
      const response = await rpc.call('block', { file: index, block }, true), expected = Math.min(4194304, f.byteSize - received);
      if (Number(response.headers.get('X-Pages-Block-Bytes')) !== expected || Number(response.headers.get('X-Pages-Block-Index')) !== block) fail('RUNNER_BLOCK_IDENTITY');
      const bytes = await boundedBytes(response, expected); if (bytes.length !== expected) fail('RUNNER_BLOCK_SIZE'); parts.push(bytes); received += bytes.length;
    }
    files.push(await storeFile(directory, f.path, Buffer.concat(parts), f.contentType));
  }
  preflightPagesFiles(files);
  return { files: sorted(files), candidate: sha(candidate), artifact: artifactHash(files) };
}
function immutableOrigin(value) {
  if (typeof value !== 'string' || !/^https:\/\/[a-f0-9]+\.zkyl-student-showcase\.pages\.dev$/.test(value)) fail('RUNNER_IMMUTABLE_URL'); return value;
}
async function downloadFrozen(rpc, status, directory, send) {
  const files = await allPages(rpc, 'manifest'); preflightPagesFiles(files);
  if (artifactHash(files) !== status.job.artifact_hash) fail('RUNNER_ARTIFACT_MISMATCH');
  const origin = immutableOrigin(status.job.preview_url);
  for (const f of files) {
    const bytes = controls.has(f.path) ? Buffer.from(f.control ?? fail('RUNNER_CONTROL_MISSING'), 'base64') : await boundedBytes(await send(`${origin}/${f.path}`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30_000) }), f.byteSize);
    if (bytes.length !== f.byteSize || sha(bytes) !== f.sha256) fail('RUNNER_PREVIEW_BYTES_CHANGED');
    const verified = await storeFile(directory, f.path, bytes, f.contentType); if (verified.key !== f.key) fail('RUNNER_ASSET_KEY_MISMATCH');
  }
  return { files, artifact: status.job.artifact_hash, candidate: status.job.candidate_hash };
}
function validateDeployment(d, phase, branch, marker) {
  if (!d || d.environment !== phase || d.deployment_trigger?.metadata?.branch !== branch || d.deployment_trigger?.metadata?.commit_message !== marker) fail('RUNNER_DEPLOYMENT_IDENTITY');
  immutableOrigin(d.url); return d;
}
async function verifyBytes(origin, files, send) {
  const control = files.find(f => f.path === '_headers');
  if (!control?.control) fail('RUNNER_CONTROL_MISSING');
  const lines = Buffer.from(control.control, 'base64').toString('utf8').split('\n');
  for (const f of files) if (!controls.has(f.path)) {
    const response = await send(`${origin}/${f.path}`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
    let matches = false; const expected = new Map();
    for (const line of lines) {
      if (!line.trim()) continue;
      if (!line.startsWith(' ')) { const path = `/${f.path}`; matches = line.endsWith('*') ? path.startsWith(line.slice(0, -1)) : path === line; }
      else if (matches) { const colon = line.indexOf(':'); if (colon < 0) fail('RUNNER_CONTROL_SYNTAX'); expected.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim()); }
    }
    for (const [key, value] of expected) if (response.headers.get(key) !== value) fail('RUNNER_HEADERS_MISMATCH');
    const bytes = await boundedBytes(response, f.byteSize); if (bytes.length !== f.byteSize || sha(bytes) !== f.sha256) fail('RUNNER_READBACK_MISMATCH');
  }
}
/** Production never builds a template or fetches the current draft. All provider writes are one-shot. */
export async function executeRunner(config, options = {}) {
  if (!/^job_[a-f0-9]{32}$/.test(config.job) || !['preview', 'production'].includes(config.phase) || !/^\d+$/.test(config.run) || !Number.isSafeInteger(config.attempt) || config.attempt < 1 || !/^https:\/\/[A-Za-z0-9.-]+$/.test(config.origin)) fail('RUNNER_CONFIGURATION');
  const send = options.fetch ?? fetch, rpc = options.rpc ?? new RunnerRpc(config, send);
  const claim = await rpc.call('claim'); rpc.lease = claim.lease;
  if (claim.source.head !== config.head || claim.source.ref !== config.ref || config.repository !== RUNNER_REPOSITORY || config.workflowRef !== `${RUNNER_REPOSITORY}/${RUNNER_WORKFLOW}@${config.ref}`) fail('RUNNER_SOURCE_MISMATCH');
  const status = await rpc.call('status');
  if (status.site?.project !== 'zkyl-student-showcase' || status.site.production_url !== 'https://zkyl-student-showcase.pages.dev') fail('RUNNER_PROJECT');
  const client = new PagesClient(config.account, 'zkyl-student-showcase', config.pagesToken, send);
  const project = await client.getProject(); if (project.name !== status.site.project || project.production_branch !== status.site.production_branch) fail('RUNNER_PROJECT_DRIFT');
  const directory = await mkdtemp(join(tmpdir(), 'portfolio-pages-'));
  try {
    let artifact;
    if (claim.scope === 'execute' && config.phase === 'preview' && !status.job.artifact_hash) {
      artifact = await assemblePreview(rpc, status, claim, directory, options.templatePath ?? 'app/api/_generated/pages-template.json');
      const registered = new Map((await allPages(rpc, 'manifest')).map(f => [f.path, f]));
      const pending = artifact.files.filter(f => { const old = registered.get(f.path); if (!old) return true; if (old.sha256 !== f.sha256 || old.key !== f.key || old.byteSize !== f.byteSize || old.control !== (f.control ?? null)) fail('RUNNER_REGISTERED_MISMATCH'); return false; });
      for (let offset = 0; offset < pending.length; offset += 20) await rpc.call('manifest-register', { files: pending.slice(offset, offset + 20) });
      await rpc.call('manifest-finalize', { artifact: artifact.artifact, candidate: artifact.candidate, template: claim.source.template, count: artifact.files.length });
    } else if (config.phase === 'production') artifact = await downloadFrozen(rpc, status, directory, send);
    else {
      // Recovery only reads the immutable registered manifest; no source rebuilding after a deployment permit.
      const files = await allPages(rpc, 'manifest'); preflightPagesFiles(files);
      if (artifactHash(files) !== status.job.artifact_hash) fail('RUNNER_ARTIFACT_MISMATCH');
      artifact = { files, artifact: status.job.artifact_hash, candidate: status.job.candidate_hash };
      if (claim.scope === 'execute') {
        const rebuilt = await assemblePreview(rpc, status, claim, directory, options.templatePath ?? 'app/api/_generated/pages-template.json');
        if (rebuilt.artifact !== artifact.artifact) fail('RUNNER_FROZEN_REBUILD_MISMATCH');
      }
    }
    const branch = config.phase === 'production' ? status.site.production_branch : `portfolio-preview-${config.job.slice(4, 20)}`;
    if (config.phase === 'preview' && branch === project.production_branch) fail('RUNNER_PREVIEW_BRANCH');
    let marker = claim.deployment?.marker, deployment;
    if (claim.scope === 'execute') {
      const jwt = await client.uploadToken();
      for (const f of artifact.files) if (!controls.has(f.path)) {
        const missing = await client.checkMissing([f.key], jwt);
        if (missing.includes(f.key)) { await rpc.call('asset-permit', { path: f.path }); await client.upload(f, streamFile(localPath(directory, f.path)), jwt); }
        await client.upsert([f.key], jwt);
      }
      const permit = await rpc.call('deployment-permit'); if (permit.send !== true) fail('RUNNER_DEPLOYMENT_DENIED'); marker = permit.marker;
      const headers = Buffer.from(artifact.files.find(f => f.path === '_headers')?.control ?? fail('RUNNER_CONTROL_MISSING'), 'base64').toString('utf8');
      const redirects = artifact.files.find(f => f.path === '_redirects')?.control;
      try { deployment = await client.createDeployment(artifact.files, branch, marker, headers, redirects ? Buffer.from(redirects, 'base64').toString('utf8') : undefined); } catch { /* The only following operation is bounded readback of this marker. */ }
    }
    if (!marker) fail('RUNNER_NO_DEPLOYMENT_ATTEMPT');
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!deployment) {
        const matches = (await client.listDeployments()).filter(d => d.deployment_trigger?.metadata?.commit_message === marker);
        if (matches.length > 1) fail('RUNNER_DEPLOYMENT_AMBIGUOUS'); deployment = matches[0];
      } else deployment = await client.getDeployment(deployment.id);
      if (deployment) {
        validateDeployment(deployment, config.phase, branch, marker);
        if (deployment.latest_stage.status === 'success') break;
        if (['failure', 'failed', 'canceled'].includes(deployment.latest_stage.status)) fail('RUNNER_DEPLOYMENT_FAILED');
      }
      await (options.delay ?? (ms => new Promise(r => setTimeout(r, ms))))(3000);
    }
    if (!deployment || deployment.latest_stage.status !== 'success') fail('RUNNER_DEPLOYMENT_UNKNOWN');
    await verifyBytes(immutableOrigin(deployment.url), artifact.files, send);
    if (config.phase === 'production') {
      if ((await client.getProject()).canonical_deployment?.id !== deployment.id) fail('RUNNER_CANONICAL_DRIFT');
      await verifyBytes(status.site.production_url, artifact.files, send);
    }
    const receipt = { artifact: artifact.artifact, marker, phase: config.phase, verified: true, id: deployment.id, url: immutableOrigin(deployment.url) };
    // One bounded receipt retry is safe: server permits only the identical stored result.
    try { await rpc.call('receipt', receipt); } catch { await rpc.call('receipt', receipt); }
    return { job: config.job, phase: config.phase, deployment: deployment.id, artifact: artifact.artifact, status: 'verified' };
  } catch (error) {
    await rpc.call('report-stop').catch(() => undefined);
    throw error;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const e = process.env;
  executeRunner({ job: e.PAGES_JOB_ID, phase: e.PAGES_PHASE, run: e.GITHUB_RUN_ID, attempt: Number(e.GITHUB_RUN_ATTEMPT), head: e.GITHUB_SHA, ref: e.GITHUB_REF, repository: e.GITHUB_REPOSITORY, workflowRef: e.GITHUB_WORKFLOW_REF, origin: e.PAGES_WORKER_ORIGIN, secret: e.PAGES_RUNNER_HMAC_KEY, account: e.PAGES_ACCOUNT_ID, pagesToken: e.PAGES_API_TOKEN })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(JSON.stringify({ status: 'stopped', code: typeof error.code === 'string' ? error.code : 'RUNNER_OPERATION_FAILED' })); process.exitCode = 1; });
}
