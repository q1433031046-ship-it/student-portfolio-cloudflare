import { STATIC_BUILD_BRANCH } from "./static-site-contract";

export class NetlifyClientError extends Error {
  readonly code: string;
  readonly status?: number;
  constructor(code: string, message: string, status?: number) { super(message); this.code = code; this.status = status; }
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
    if (!token) throw new NetlifyClientError("NETLIFY_REAUTHORIZATION_REQUIRED", "Netlify 授权不可用", 401);
  }

  async triggerDraftBuild(hookUrl: string, input: Record<string, unknown>, providerRequestKey: string) {
    if (!/^https:\/\/api\.netlify\.com\/build_hooks\/[A-Za-z0-9_-]+$/u.test(hookUrl)) {
      throw new NetlifyClientError("NETLIFY_HOOK_INVALID", "Netlify Build Hook 无效");
    }
    const url = new URL(hookUrl);
    url.searchParams.set("trigger_title", providerRequestKey);
    const response = await this.fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      redirect: "error",
    });
    if (!response.ok) throw await this.providerError(response, "NETLIFY_BUILD_TRIGGER_FAILED");
    return safeJson(response);
  }

  async getDeploy(siteId: string, deployId: string) {
    const deploy = await this.request<NetlifyDeploy>(`/sites/${encodeURIComponent(siteId)}/deploys/${encodeURIComponent(deployId)}`);
    if (deploy.site_id !== siteId || deploy.id !== deployId) throw new NetlifyClientError("NETLIFY_DEPLOY_SITE_MISMATCH", "Deploy 不属于已绑定 Site");
    return deploy;
  }

  async listDeploys(siteId: string) {
    return this.request<NetlifyDeploy[]>(`/sites/${encodeURIComponent(siteId)}/deploys?per_page=100`);
  }

  async getSite(siteId: string) {
    const site = await this.request<NetlifySite>(`/sites/${encodeURIComponent(siteId)}`);
    if (site.id !== siteId) throw new NetlifyClientError("NETLIFY_SITE_MISMATCH", "Netlify Site 身份不一致");
    if (site.published_deploy && site.published_deploy.site_id !== siteId) {
      throw new NetlifyClientError("NETLIFY_DEPLOY_SITE_MISMATCH", "已发布 Deploy 不属于已绑定 Site");
    }
    return site;
  }

  async findDeployByRequestKey(siteId: string, providerRequestKey: string, triggeredAt: Date, windowMinutes = 30) {
    const earliest = triggeredAt.getTime() - 2 * 60_000;
    const latest = triggeredAt.getTime() + windowMinutes * 60_000;
    const matches = (await this.listDeploys(siteId)).filter((deploy) => {
      const created = Date.parse(deploy.created_at ?? "");
      return deploy.site_id === siteId && deploy.branch === STATIC_BUILD_BRANCH && deploy.title === providerRequestKey
        && Number.isFinite(created) && created >= earliest && created <= latest;
    });
    if (matches.length > 1) throw new NetlifyClientError("NETLIFY_DEPLOY_AMBIGUOUS", "同一发布请求匹配到多个 Deploy");
    return matches[0] ?? null;
  }

  async listDeployFiles(siteId: string, deployId: string) {
    await this.getDeploy(siteId, deployId);
    return this.request<NetlifyFile[]>(`/deploys/${encodeURIComponent(deployId)}/files`);
  }

  async publishExistingDeploy(siteId: string, deployId: string) {
    await this.getDeploy(siteId, deployId);
    const result = await this.request<NetlifyDeploy>(`/sites/${encodeURIComponent(siteId)}/deploys/${encodeURIComponent(deployId)}/restore`, { method: "POST" });
    if (result.id !== deployId || result.site_id !== siteId) throw new NetlifyClientError("NETLIFY_PUBLISH_READBACK_MISMATCH", "Netlify 发布结果与已验证 Deploy 不一致");
    return result;
  }

  private async request<T>(path: string, init: RequestInit = {}) {
    const response = await this.fetcher(`${this.apiBase}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json", ...init.headers },
    });
    if (!response.ok) throw await this.providerError(response, "NETLIFY_API_FAILED");
    return safeJson(response) as Promise<T>;
  }

  private async providerError(response: Response, fallbackCode: string) {
    if (response.status === 401 || response.status === 403) return new NetlifyClientError("NETLIFY_REAUTHORIZATION_REQUIRED", "Netlify 需要重新授权", response.status);
    if (response.status === 429) return new NetlifyClientError("NETLIFY_RATE_LIMITED", "Netlify 请求过于频繁，请稍后重试", 429);
    return new NetlifyClientError(fallbackCode, "Netlify 操作暂时失败", response.status);
  }
}

async function safeJson(response: Response) {
  try { return await response.json(); } catch { throw new NetlifyClientError("NETLIFY_RESPONSE_INVALID", "Netlify 响应无法解析", response.status); }
}
