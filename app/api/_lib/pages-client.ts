import { blake3 } from "@noble/hashes/blake3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PAGES_MAX_FILES = 20_000;
export const PAGES_STEP_FILES = 1;
export type PagesFile = { path: string; byteSize: number; contentType: string; sha256: string; key: string };
export type PagesDeployment = { id: string; url: string; environment: "preview" | "production"; latest_stage: { status: string }; deployment_trigger?: { metadata?: { commit_message?: string; branch?: string } } };
import { PagesError } from './pages-errors';
export { PagesError } from './pages-errors';
export function assertPagesPath(path: string) {
  if (!/^[A-Za-z0-9_./-]+$/u.test(path) || path.startsWith("/") || path.split("/").some(x => !x || x === "." || x === "..")) throw new PagesError("PAGES_PATH_INVALID", "静态文件路径无效");
}
export function preflightPagesFiles(files: Array<{ path: string; byteSize: number }>) {
  if (!files.length || files.length > PAGES_MAX_FILES) throw new PagesError("PAGES_FILE_COUNT", "静态文件数量超过平台限制");
  const names = new Set<string>();
  for (const file of files) {
    assertPagesPath(file.path);
    if (names.has(file.path)) throw new PagesError("PAGES_DUPLICATE_PATH", "静态文件路径重复");
    names.add(file.path);
    if (!Number.isSafeInteger(file.byteSize) || file.byteSize < 0 || file.byteSize > PAGES_MAX_FILE_BYTES) throw new PagesError("PAGES_FILE_TOO_LARGE", `静态文件 ${file.path} 超过25 MiB或大小无效；动态发布仍可使用`);
  }
}
// Each encoded slice is 48 KiB raw. Preserve three-byte boundaries between source chunks.
export async function* base64Stream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(); let tail = new Uint8Array(0);
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      let chunk = value;
      if (tail.length) { chunk = new Uint8Array(tail.length + value.length); chunk.set(tail); chunk.set(value, tail.length); }
      const count = chunk.length - chunk.length % 3;
      for (let at = 0; at < count; at += 49152) {
        const part = chunk.subarray(at, Math.min(count, at + 49152));
        let binary = ""; for (let i = 0; i < part.length; i += 4096) binary += String.fromCharCode(...part.subarray(i, i + 4096));
        yield btoa(binary);
      }
      tail = chunk.slice(count);
    }
    if (tail.length) yield btoa(String.fromCharCode(...tail));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export async function digestPagesFile(path: string, stream: ReadableStream<Uint8Array>, expectedBytes: number) {
  preflightPagesFiles([{ path, byteSize: expectedBytes }]);
  const sha = sha256.create(), blake = blake3.create({ dkLen: 32 }); let size = 0;
  const reader = stream.getReader();
  const counted = new ReadableStream<Uint8Array>({ async pull(controller) {
    const { value, done } = await reader.read();
    if (done) { reader.releaseLock(); controller.close(); return; }
    size += value.length;
    if (size > expectedBytes) { await reader.cancel(); controller.error(new PagesError("PAGES_MEDIA_CHANGED", "媒体大小已变化")); return; }
    sha.update(value); controller.enqueue(value);
  }, async cancel() { await reader.cancel().catch(() => undefined); } });
  for await (const part of base64Stream(counted)) blake.update(new TextEncoder().encode(part));
  if (size !== expectedBytes) throw new PagesError("PAGES_MEDIA_CHANGED", "媒体大小已变化");
  const extension = path.split("/").at(-1)!.includes(".") ? path.split(".").at(-1)! : "";
  blake.update(new TextEncoder().encode(extension));
  return { sha256: bytesToHex(sha.digest()), key: bytesToHex(blake.digest()).slice(0, 32) };
}
async function boundedJson(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw new PagesError("PAGES_RESPONSE_INVALID", "发布响应为空", 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) throw new PagesError("PAGES_RESPONSE_LIMIT", "发布响应超过核验上限", 502); chunks.push(value); } }
  finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new PagesError("PAGES_RESPONSE_INVALID", "发布响应无法解析", 502); }
}
export class PagesClient {
  constructor(private accountId: string, private project: string, private token: string, private fetcher: typeof fetch = fetch) {
    if (!/^[a-f0-9]{32}$/u.test(accountId) || !/^[a-z0-9-]+$/u.test(project) || !token) throw new PagesError("PAGES_UNCONFIGURED", "Pages发布尚未配置");
  }
  private projectPath() { return `/accounts/${this.accountId}/pages/projects/${this.project}`; }
  private async request<T>(path: string, init: RequestInit = {}, jwt?: string): Promise<T> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.fetcher(`https://api.cloudflare.com/client/v4${path}`, { ...init, redirect: "manual", signal: controller.signal,
        headers: { Authorization: `Bearer ${jwt ?? this.token}`, ...(init.headers as Record<string, string> ?? {}) } });
      const body = await boundedJson(response);
      if (!response.ok || body.success !== true) throw new PagesError(response.status === 401 || response.status === 403 ? "PAGES_AUTH_REQUIRED" : "PAGES_REQUEST_FAILED", "Cloudflare发布请求未完成，请核对授权或请求状态", response.status >= 400 ? response.status : 502);
      return body.result as T;
    } catch (error) { if (error instanceof PagesError) throw error; throw new PagesError("PAGES_RESPONSE_UNKNOWN", "Cloudflare请求结果未知，请核验原任务，不能重复创建部署", 503); }
    finally { clearTimeout(timer); }
  }
  getProject() { return this.request<{ name: string; production_branch: string; canonical_deployment?: PagesDeployment }>(this.projectPath()); }
  async uploadToken() {
    const result = await this.request<{ jwt: string }>(`${this.projectPath()}/upload-token`);
    if (typeof result.jwt !== "string" || result.jwt.length < 10) throw new PagesError("PAGES_TOKEN_INVALID", "Pages上传授权响应无效");
    return result.jwt;
  }
  checkMissing(keys: string[], jwt: string) { return this.request<string[]>("/pages/assets/check-missing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hashes: keys }) }, jwt); }
  async upload(file: PagesFile, stream: ReadableStream<Uint8Array>, jwt: string) {
    preflightPagesFiles([file]);
    const sha = sha256.create(), source = stream.getReader(); let bytes = 0;
    const checked = new ReadableStream<Uint8Array>({ async pull(controller) {
      const part = await source.read();
      if (part.done) {
        source.releaseLock();
        if (bytes !== file.byteSize || bytesToHex(sha.digest()) !== file.sha256) {
          controller.error(new PagesError("PAGES_MEDIA_CHANGED", "上传字节与冻结资产不一致")); return;
        }
        controller.close(); return;
      }
      bytes += part.value.length;
      if (bytes > file.byteSize) { await source.cancel(); controller.error(new PagesError("PAGES_MEDIA_CHANGED", "上传资产大小已变化")); return; }
      sha.update(part.value); controller.enqueue(part.value);
    }, async cancel() { await source.cancel().catch(() => undefined); } });
    const iterator = base64Stream(checked), encoder = new TextEncoder(); let phase = 0;
    const body = new ReadableStream<Uint8Array>({ async pull(controller) {
      if (phase === 0) { phase = 1; controller.enqueue(encoder.encode(`[{"key":${JSON.stringify(file.key)},"value":"`)); return; }
      if (phase === 1) { const part = await iterator.next(); if (!part.done) { controller.enqueue(encoder.encode(part.value)); return; } phase = 2; }
      controller.enqueue(encoder.encode(`","metadata":{"contentType":${JSON.stringify(file.contentType)}},"base64":true}]`)); controller.close();
    }, async cancel() { await iterator.return(undefined); } });
    await this.request("/pages/assets/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half" } as RequestInit, jwt);
  }
  upsert(keys: string[], jwt: string) { return this.request("/pages/assets/upsert-hashes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hashes: keys }) }, jwt); }
  createDeployment(files: PagesFile[], branch: string, marker: string, headers: string, redirects?: string) {
    if (!branch || !marker) throw new PagesError("PAGES_DEPLOY_IDENTITY", "部署分支和快照标记不能为空");
    const form = new FormData(); form.set("manifest", JSON.stringify(Object.fromEntries(files.filter(f => !['_headers','_redirects'].includes(f.path)).map(f => [`/${f.path}`, f.key]))));
    form.set("branch", branch); form.set("commit_message", marker); form.set("commit_dirty", "true");
    form.set("_headers", new File([headers], "_headers"));
    if (redirects !== undefined) form.set('_redirects', new File([redirects], '_redirects'));
    return this.request<PagesDeployment>(`${this.projectPath()}/deployments`, { method: "POST", body: form });
  }
  getDeployment(id: string) { return this.request<PagesDeployment>(`${this.projectPath()}/deployments/${encodeURIComponent(id)}`); }
  listDeployments() { return this.request<PagesDeployment[]>(`${this.projectPath()}/deployments?per_page=25`); }
}
