import { PROVIDER_REQUEST_KEY_PATTERN, STATIC_BUILD_BRANCH } from "./static-site-contract";

export type NetlifyStatusClass =
  | "success"
  | "redirect"
  | "unauthorized"
  | "rate_limited"
  | "client_error"
  | "server_error"
  | "network_error"
  | "timeout"
  | "unknown";

export type NetlifyLocationClass =
  | "same_exact_netlify_origin"
  | "netlify_official_but_unapproved"
  | "external_or_unapproved"
  | "missing"
  | "invalid"
  | "loop";

export type NetlifyExceptionClass = "none" | "TypeError" | "AbortError" | "unknown";
export type NetlifyDeployMatch = "none" | "unique" | "multiple" | "unknown";

/**
 * The only fields allowed to leave the Build Hook transport boundary.
 * `triggerCallCount` is the fetchInvoked bit: a generation is either 0 or 1.
 */
export type NetlifyTransportEvidence = {
  providerRequestKey: string;
  attemptedAt: string;
  responseReceived: boolean;
  httpStatus: number | null;
  statusClass: NetlifyStatusClass;
  redirectOccurred: boolean;
  locationClass: NetlifyLocationClass;
  exceptionClass: NetlifyExceptionClass;
  deployMatch: NetlifyDeployMatch;
  triggerCallCount: 0 | 1;
  deployIdHash?: string;
};

export type NetlifyHookResult = { evidence: NetlifyTransportEvidence };

const SAFE_STATUS_CLASSES = new Set<NetlifyStatusClass>([
  "success", "redirect", "unauthorized", "rate_limited", "client_error", "server_error",
  "network_error", "timeout", "unknown",
]);
const SAFE_LOCATION_CLASSES = new Set<NetlifyLocationClass>([
  "same_exact_netlify_origin", "netlify_official_but_unapproved", "external_or_unapproved",
  "missing", "invalid", "loop",
]);
const SAFE_EXCEPTION_CLASSES = new Set<NetlifyExceptionClass>(["none", "TypeError", "AbortError", "unknown"]);
const SAFE_DEPLOY_MATCHES = new Set<NetlifyDeployMatch>(["none", "unique", "multiple", "unknown"]);

const SAFE_MESSAGES: Record<string, string> = Object.freeze({
  NETLIFY_HOOK_INVALID: "Netlify Build Hook 无效",
  NETLIFY_REQUEST_KEY_INVALID: "Netlify 发布请求标识无效",
  NETLIFY_BUILD_TRIGGER_REDIRECT: "Build Hook 返回了重定向，未跟随",
  NETLIFY_REAUTHORIZATION_REQUIRED: "Netlify 需要重新授权",
  NETLIFY_RATE_LIMITED: "Netlify 请求过于频繁，请稍后重试",
  NETLIFY_BUILD_TRIGGER_CLIENT_ERROR: "Build Hook 返回了客户端错误",
  NETLIFY_BUILD_TRIGGER_SERVER_ERROR: "Build Hook 返回了服务端错误",
  NETLIFY_BUILD_TRIGGER_TYPE_ERROR: "Build Hook 网络请求类型失败，接收状态未确认",
  NETLIFY_BUILD_TRIGGER_ABORTED: "Build Hook 请求被中止，接收状态未确认",
  NETLIFY_BUILD_TRIGGER_UNKNOWN: "Build Hook 请求异常，接收状态未确认",
  NETLIFY_API_REDIRECT: "Netlify API 返回了重定向，未跟随",
  NETLIFY_API_CLIENT_ERROR: "Netlify API 返回了客户端错误",
  NETLIFY_API_SERVER_ERROR: "Netlify API 返回了服务端错误",
  NETLIFY_API_TYPE_ERROR: "Netlify API 网络请求类型失败",
  NETLIFY_API_ABORTED: "Netlify API 请求被中止",
  NETLIFY_API_UNKNOWN: "Netlify API 请求异常",
  NETLIFY_API_FAILED: "Netlify 操作暂时失败",
  NETLIFY_RESPONSE_INVALID: "Netlify 响应无法解析",
  NETLIFY_DEPLOY_AMBIGUOUS: "同一发布请求匹配到多个 Deploy",
  NETLIFY_DEPLOY_SITE_MISMATCH: "Deploy 不属于已绑定 Site",
  NETLIFY_DEPLOY_PERMALINK_MISSING: "Deploy 缺少不可变地址",
  NETLIFY_DEPLOY_PERMALINK_INVALID: "Deploy 不可变地址无效",
  NETLIFY_SITE_MISMATCH: "Netlify Site 身份不一致",
  NETLIFY_PUBLISH_READBACK_MISMATCH: "Netlify 发布结果与已验证 Deploy 不一致",
});

export class NetlifyClientError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly evidence?: NetlifyTransportEvidence;

  constructor(code: string, _message?: string, status?: number, evidence?: NetlifyTransportEvidence) {
    const safeCode = sanitizeCode(code);
    // Never use a provider message, exception message, URL, or response body.
    const safeMessage = Object.prototype.hasOwnProperty.call(SAFE_MESSAGES, safeCode)
      ? SAFE_MESSAGES[safeCode] : "Netlify 操作暂时失败";
    super(safeMessage);
    Object.defineProperty(this, "name", { value: "NetlifyClientError", enumerable: false, configurable: true, writable: true });
    this.code = safeCode;
    if (isHttpStatus(status)) this.status = status;
    if (evidence) this.evidence = freezeEvidence(evidence);
    // Error.stack is not part of the transport contract and must not be exposed.
    try { delete (this as Error & { stack?: string }).stack; }
    catch {
      try { Object.defineProperty(this, "stack", { value: undefined, enumerable: false, configurable: true }); }
      catch { /* Some runtimes make stack non-configurable; it remains non-enumerable. */ }
    }
  }
}

export type NetlifyDeploy = {
  id: string;
  site_id: string;
  state: string;
  branch?: string;
  title?: string;
  deploy_ssl_url?: string;
  permalink?: string;
  commit_ref?: string;
  created_at?: string;
  published_at?: string;
};

export type NetlifySite = {
  id: string;
  account_id?: string;
  name?: string;
  url?: string;
  ssl_url?: string;
  published_deploy?: NetlifyDeploy | null;
};

export type NetlifyFile = { path: string; sha: string; size: number; mime_type?: string };

export function classifyNetlifyRedirect(location: string | null | undefined, sourceUrl: string): NetlifyLocationClass {
  if (!location) return "missing";
  let source: URL;
  let target: URL;
  try {
    source = new URL(sourceUrl);
    target = new URL(location, source);
  } catch {
    return "invalid";
  }
  if (source.protocol !== "https:" || (target.protocol !== "https:" && target.protocol !== "http:")) return "invalid";
  if (target.origin === source.origin && target.pathname === source.pathname) return "loop";
  if (target.origin === source.origin && source.hostname === "api.netlify.com") return "same_exact_netlify_origin";
  if (isOfficialNetlifyHost(target.hostname)) return "netlify_official_but_unapproved";
  return "external_or_unapproved";
}

export function deployMatchForCount(count: number): NetlifyDeployMatch {
  if (count === 0) return "none";
  if (count === 1) return "unique";
  if (count > 1) return "multiple";
  return "unknown";
}

/** Serialize only the allow-listed evidence fields, never arbitrary input. */
export function serializeTransportEvidence(evidence: NetlifyTransportEvidence): string {
  return JSON.stringify(freezeEvidence(evidence));
}

export function withDeployMatch(
  evidence: NetlifyTransportEvidence,
  deployMatch: NetlifyDeployMatch,
  deployIdHash?: string,
): NetlifyTransportEvidence {
  return freezeEvidence({ ...evidence, deployMatch, ...(deployIdHash ? { deployIdHash } : {}) });
}

export class NetlifyClient {
  private readonly token: string;
  private readonly apiBase: string;
  private readonly fetcher: typeof fetch;

  constructor(
    token: string,
    apiBase = "https://api.netlify.com/api/v1",
    fetcher: typeof fetch = fetch,
  ) {
    this.token = token;
    this.apiBase = apiBase;
    this.fetcher = fetcher;
    if (!token) throw new NetlifyClientError("NETLIFY_REAUTHORIZATION_REQUIRED", "", 401);
  }

  /**
   * Invoke a Build Hook exactly once. The first Response is observed with
   * redirect=manual; no body parsing or follow-up request occurs here.
   */
  async triggerDraftBuild(hookUrl: string, input: Record<string, unknown>, providerRequestKey: string): Promise<NetlifyHookResult> {
    const attemptedAt = new Date().toISOString();
    if (!/^https:\/\/api\.netlify\.com\/build_hooks\/[A-Za-z0-9_-]+$/u.test(hookUrl)) {
      throw new NetlifyClientError("NETLIFY_HOOK_INVALID", "", undefined,
        makeEvidence(providerRequestKey, attemptedAt, {
          responseReceived: false, httpStatus: null, statusClass: "unknown", redirectOccurred: false,
          locationClass: "missing", exceptionClass: "none", deployMatch: "unknown", triggerCallCount: 0,
        }));
    }
    if (!PROVIDER_REQUEST_KEY_PATTERN.test(providerRequestKey)) {
      throw new NetlifyClientError("NETLIFY_REQUEST_KEY_INVALID", "", undefined,
        makeEvidence(providerRequestKey, attemptedAt, {
          responseReceived: false, httpStatus: null, statusClass: "unknown", redirectOccurred: false,
          locationClass: "missing", exceptionClass: "none", deployMatch: "unknown", triggerCallCount: 0,
        }));
    }

    let body: string;
    try {
      const serialized = JSON.stringify(input);
      if (typeof serialized !== "string") throw new Error("non-string body");
      body = serialized;
    }
    catch {
      throw new NetlifyClientError("NETLIFY_BUILD_TRIGGER_UNKNOWN", "", undefined,
        makeEvidence(providerRequestKey, attemptedAt, {
          responseReceived: false, httpStatus: null, statusClass: "unknown", redirectOccurred: false,
          locationClass: "missing", exceptionClass: "unknown", deployMatch: "unknown", triggerCallCount: 0,
        }));
    }

    const url = new URL(hookUrl);
    url.searchParams.set("trigger_title", providerRequestKey);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        redirect: "manual",
      });
    } catch (error) {
      const exceptionClass = classifyException(error);
      const code = exceptionClass === "TypeError" ? "NETLIFY_BUILD_TRIGGER_TYPE_ERROR"
        : exceptionClass === "AbortError" ? "NETLIFY_BUILD_TRIGGER_ABORTED" : "NETLIFY_BUILD_TRIGGER_UNKNOWN";
      const statusClass: NetlifyStatusClass = exceptionClass === "TypeError" ? "network_error"
        : exceptionClass === "AbortError" ? "timeout" : "unknown";
      throw new NetlifyClientError(code, "", undefined, makeEvidence(providerRequestKey, attemptedAt, {
        responseReceived: false, httpStatus: null, statusClass, redirectOccurred: false,
        locationClass: "missing", exceptionClass, deployMatch: "unknown", triggerCallCount: 1,
      }));
    }

    const responseReceived = isResponseObject(response);
    let rawStatus: unknown;
    try { rawStatus = responseReceived ? response.status : undefined; }
    catch { rawStatus = undefined; }
    const status = normalizeStatus(rawStatus);
    if (status === null) {
      throw new NetlifyClientError("NETLIFY_BUILD_TRIGGER_UNKNOWN", "", undefined,
        makeEvidence(providerRequestKey, attemptedAt, {
          responseReceived, httpStatus: null, statusClass: "unknown", redirectOccurred: false,
          locationClass: "missing", exceptionClass: "unknown", deployMatch: "unknown", triggerCallCount: 1,
        }));
    }
    if (status >= 200 && status < 300) {
      // A Hook's success body can be JSON, empty, or text. It is never identity evidence.
      return { evidence: makeEvidence(providerRequestKey, attemptedAt, {
        responseReceived: true, httpStatus: status, statusClass: "success", redirectOccurred: false,
        locationClass: "missing", exceptionClass: "none", deployMatch: "unknown", triggerCallCount: 1,
      }) };
    }
    if (status >= 300 && status < 400) {
      let location: string | null = null;
      try { location = response.headers?.get("Location") ?? null; }
      catch { location = null; }
      const locationClass = classifyNetlifyRedirect(location, hookUrl);
      throw new NetlifyClientError("NETLIFY_BUILD_TRIGGER_REDIRECT", "", status,
        makeEvidence(providerRequestKey, attemptedAt, {
          responseReceived: true, httpStatus: status, statusClass: "redirect", redirectOccurred: true,
          locationClass, exceptionClass: "none", deployMatch: "unknown", triggerCallCount: 1,
        }));
    }

    const code = status === 401 || status === 403 ? "NETLIFY_REAUTHORIZATION_REQUIRED"
      : status === 429 ? "NETLIFY_RATE_LIMITED"
        : status >= 400 && status < 500 ? "NETLIFY_BUILD_TRIGGER_CLIENT_ERROR"
          : status >= 500 && status < 600 ? "NETLIFY_BUILD_TRIGGER_SERVER_ERROR" : "NETLIFY_BUILD_TRIGGER_UNKNOWN";
    const statusClass: NetlifyStatusClass = status === 401 || status === 403 ? "unauthorized"
      : status === 429 ? "rate_limited"
        : status >= 400 && status < 500 ? "client_error"
          : status >= 500 && status < 600 ? "server_error" : "unknown";
    throw new NetlifyClientError(code, "", status, makeEvidence(providerRequestKey, attemptedAt, {
      responseReceived: true, httpStatus: status, statusClass, redirectOccurred: false,
      locationClass: "missing", exceptionClass: "none", deployMatch: "unknown", triggerCallCount: 1,
    }));
  }

  async getDeploy(siteId: string, deployId: string) {
    const deploy = await this.request<NetlifyDeploy>(`/sites/${encodeURIComponent(siteId)}/deploys/${encodeURIComponent(deployId)}`);
    if (!isRecord(deploy) || deploy.site_id !== siteId || deploy.id !== deployId) {
      throw new NetlifyClientError("NETLIFY_DEPLOY_SITE_MISMATCH", "");
    }
    return deploy;
  }

  async listDeploys(siteId: string) {
    const deployments = await this.request<NetlifyDeploy[]>(`/sites/${encodeURIComponent(siteId)}/deploys?per_page=100`);
    if (!Array.isArray(deployments)) throw new NetlifyClientError("NETLIFY_RESPONSE_INVALID", "");
    return deployments;
  }

  async getSite(siteId: string) {
    const site = await this.request<NetlifySite>(`/sites/${encodeURIComponent(siteId)}`);
    if (!isRecord(site) || site.id !== siteId) throw new NetlifyClientError("NETLIFY_SITE_MISMATCH", "");
    if (site.published_deploy && site.published_deploy.site_id !== siteId) {
      throw new NetlifyClientError("NETLIFY_DEPLOY_SITE_MISMATCH", "");
    }
    return site;
  }

  async findDeployByRequestKey(siteId: string, providerRequestKey: string, triggeredAt: Date, windowMinutes = 30) {
    const triggerTime = triggeredAt.getTime();
    if (!PROVIDER_REQUEST_KEY_PATTERN.test(providerRequestKey)
      || !Number.isFinite(triggerTime) || !Number.isFinite(windowMinutes) || windowMinutes < 0) {
      throw new NetlifyClientError("NETLIFY_REQUEST_KEY_INVALID", "");
    }
    const earliest = triggerTime - 2 * 60_000;
    const latest = triggerTime + windowMinutes * 60_000;
    const deployments = await this.listDeploys(siteId);
    const matches = deployments.filter((deploy) => {
      if (!isRecord(deploy)) return false;
      const created = Date.parse(deploy.created_at ?? "");
      return deploy.site_id === siteId && deploy.branch === STATIC_BUILD_BRANCH && deploy.title === providerRequestKey
        && Number.isFinite(created) && created >= earliest && created <= latest;
    });
    if (deployMatchForCount(matches.length) === "multiple") throw new NetlifyClientError("NETLIFY_DEPLOY_AMBIGUOUS", "");
    return matches[0] ?? null;
  }

  async listDeployFiles(siteId: string, deployId: string) {
    await this.getDeploy(siteId, deployId);
    const files = await this.request<NetlifyFile[]>(`/deploys/${encodeURIComponent(deployId)}/files`);
    if (!Array.isArray(files)) throw new NetlifyClientError("NETLIFY_RESPONSE_INVALID", "");
    return files;
  }

  async publishExistingDeploy(siteId: string, deployId: string) {
    await this.getDeploy(siteId, deployId);
    const result = await this.request<NetlifyDeploy>(`/sites/${encodeURIComponent(siteId)}/deploys/${encodeURIComponent(deployId)}/restore`, { method: "POST" });
    if (!isRecord(result) || result.id !== deployId || result.site_id !== siteId) {
      throw new NetlifyClientError("NETLIFY_PUBLISH_READBACK_MISMATCH", "");
    }
    return result;
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    let response: Response;
    try {
      response = await this.fetcher(`${this.apiBase}${path}`, {
        ...init,
        redirect: "manual",
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json", ...init.headers },
      });
    } catch (error) {
      throw apiException(error);
    }
    let status: number | null;
    try { status = normalizeStatus(response?.status); }
    catch { status = null; }
    if (status === null) throw new NetlifyClientError("NETLIFY_API_UNKNOWN", "");
    if (status < 200 || status >= 300) throw providerError(status);
    return safeJson(response) as Promise<T>;
  }
}

function providerError(status: number) {
  if (status === 401 || status === 403) return new NetlifyClientError("NETLIFY_REAUTHORIZATION_REQUIRED", "", status);
  if (status === 429) return new NetlifyClientError("NETLIFY_RATE_LIMITED", "", status);
  if (status >= 300 && status < 400) return new NetlifyClientError("NETLIFY_API_REDIRECT", "", status);
  if (status >= 400 && status < 500) return new NetlifyClientError("NETLIFY_API_CLIENT_ERROR", "", status);
  if (status >= 500 && status < 600) return new NetlifyClientError("NETLIFY_API_SERVER_ERROR", "", status);
  return new NetlifyClientError("NETLIFY_API_FAILED", "", status);
}

async function safeJson(response: Response) {
  try { return await response.json(); }
  catch {
    let status: number | null;
    try { status = normalizeStatus(response.status); }
    catch { status = null; }
    throw new NetlifyClientError("NETLIFY_RESPONSE_INVALID", "", status ?? undefined);
  }
}

function apiException(error: unknown) {
  const exceptionClass = classifyException(error);
  return new NetlifyClientError(exceptionClass === "TypeError" ? "NETLIFY_API_TYPE_ERROR"
    : exceptionClass === "AbortError" ? "NETLIFY_API_ABORTED" : "NETLIFY_API_UNKNOWN", "");
}

function classifyException(error: unknown): NetlifyExceptionClass {
  try {
    if (error instanceof TypeError) return "TypeError";
    if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") return "AbortError";
    if (typeof error === "object" && error !== null) {
      const name = (error as { name?: unknown }).name;
      if (name === "AbortError") return "AbortError";
      if (name === "TypeError") return "TypeError";
    }
  } catch { return "unknown"; }
  return "unknown";
}

function makeEvidence(
  providerRequestKey: string,
  attemptedAt: string,
  values: Omit<NetlifyTransportEvidence, "providerRequestKey" | "attemptedAt">,
): NetlifyTransportEvidence {
  return {
    providerRequestKey: sanitizeRequestKey(providerRequestKey),
    attemptedAt: safeTimestamp(attemptedAt),
    ...values,
  };
}

function freezeEvidence(evidence: NetlifyTransportEvidence): NetlifyTransportEvidence {
  const safe: NetlifyTransportEvidence = {
    providerRequestKey: sanitizeRequestKey(evidence.providerRequestKey),
    attemptedAt: safeTimestamp(evidence.attemptedAt),
    responseReceived: evidence.responseReceived === true,
    httpStatus: isHttpStatus(evidence.httpStatus) ? evidence.httpStatus : null,
    statusClass: SAFE_STATUS_CLASSES.has(evidence.statusClass) ? evidence.statusClass : "unknown",
    redirectOccurred: evidence.redirectOccurred === true,
    locationClass: SAFE_LOCATION_CLASSES.has(evidence.locationClass) ? evidence.locationClass : "invalid",
    exceptionClass: SAFE_EXCEPTION_CLASSES.has(evidence.exceptionClass) ? evidence.exceptionClass : "unknown",
    deployMatch: SAFE_DEPLOY_MATCHES.has(evidence.deployMatch) ? evidence.deployMatch : "unknown",
    triggerCallCount: evidence.triggerCallCount === 1 ? 1 : 0,
  };
  if (typeof evidence.deployIdHash === "string" && /^[a-f0-9]{16,64}$/u.test(evidence.deployIdHash)) safe.deployIdHash = evidence.deployIdHash;
  return Object.freeze(safe);
}

function sanitizeCode(value: unknown) { return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,95}$/u.test(value) ? value : "NETLIFY_OPERATION_FAILED"; }
function sanitizeRequestKey(value: string) { return PROVIDER_REQUEST_KEY_PATTERN.test(value) ? value : "unknown"; }
function safeTimestamp(value: string) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) ? value : "unknown"; }
function normalizeStatus(value: unknown) { return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null; }
function isHttpStatus(value: unknown): value is number { return normalizeStatus(value) !== null; }
function isResponseObject(value: unknown): value is Response {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isOfficialNetlifyHost(hostname: string) {
  const value = hostname.toLowerCase();
  return value === "netlify.com" || value.endsWith(".netlify.com") || value === "netlify.app" || value.endsWith(".netlify.app");
}
