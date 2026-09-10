import { PagesError } from './pages-errors';

export const RUNNER_PATH = '/api/pages-runner';
export const CONTROL_LIMIT = 64 * 1024;
export type RunnerIdentity = { job: string; phase: 'preview' | 'production'; run: string; attempt: number; op: string; time: number; nonce: string; lease: string; seq: number };
const encoder = new TextEncoder();
export const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, '0')).join('');
export async function bodyDigest(bytes: Uint8Array) { return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource)); }
export async function readControl(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > CONTROL_LIMIT) throw new PagesError('RUNNER_BODY_LIMIT', '控制消息超过64KiB', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new PagesError('RUNNER_BODY', '缺少控制消息', 400);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length;
      if (length > CONTROL_LIMIT) throw new PagesError('RUNNER_BODY_LIMIT', '控制消息超过64KiB', 413); chunks.push(value); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function canonical(identity: RunnerIdentity, digest: string) {
  const i = identity;
  return encoder.encode(JSON.stringify(['PAGES-RUNNER/1', 'POST', RUNNER_PATH, i.job, i.phase, i.run, i.attempt, i.op, i.time, i.nonce, i.lease, i.seq, digest]));
}
async function key(secret: string) {
  if (secret.length < 32) throw new PagesError('RUNNER_UNCONFIGURED', '专用执行身份尚未配置', 503);
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signControl(secret: string, identity: RunnerIdentity, bytes: Uint8Array) {
  return hex(await crypto.subtle.sign('HMAC', await key(secret), canonical(identity, await bodyDigest(bytes))));
}
export async function authenticateControl(request: Request, secret: string, now = Date.now()) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== RUNNER_PATH || url.search) throw new PagesError('RUNNER_ROUTE', '执行入口无效', 400);
  const metadata = request.headers.get('x-pages-identity') ?? '';
  if (metadata.length > 1024) throw new PagesError('RUNNER_IDENTITY', '执行身份无效', 401);
  let i: RunnerIdentity;
  try { i = JSON.parse(metadata); } catch { throw new PagesError('RUNNER_IDENTITY', '执行身份无效', 401); }
  if (!i || !/^job_[a-f0-9]{32}$/.test(i.job) || !['preview', 'production'].includes(i.phase) || !/^\d{1,20}$/.test(i.run)
    || !Number.isSafeInteger(i.attempt) || i.attempt < 1 || !/^[a-z-]{1,32}$/.test(i.op) || !Number.isSafeInteger(i.time)
    || Math.abs(now - i.time) > 120_000 || !/^[a-f0-9]{32}$/.test(i.nonce) || !/^[a-f0-9-]{0,36}$/.test(i.lease)
    || !Number.isSafeInteger(i.seq) || i.seq < 0) throw new PagesError('RUNNER_IDENTITY', '执行身份或时间窗口无效', 401);
  const signature = request.headers.get('x-pages-signature') ?? '';
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new PagesError('RUNNER_SIGNATURE', '执行签名无效', 401);
  const bytes = await readControl(request), digest = await bodyDigest(bytes);
  const valid = await crypto.subtle.verify('HMAC', await key(secret), Uint8Array.from(signature.match(/../g)!, h => parseInt(h, 16)), canonical(i, digest));
  if (!valid) throw new PagesError('RUNNER_SIGNATURE', '执行签名无效', 401);
  let body: { op: string; args: Record<string, unknown> };
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new PagesError('RUNNER_JSON', '控制消息无效', 400); }
  if (!body || body.op !== i.op || !body.args || typeof body.args !== 'object' || Array.isArray(body.args)) throw new PagesError('RUNNER_OPERATION', '控制操作无效', 400);
  return { identity: i, body, digest };
}
