export type SiteEntrances = { staticUrl: string | null; uploadUrl: string | null; project: string | null; state: 'configured' | 'unconfigured' | 'conflict' };
type Inputs = { accountId?: unknown; project?: unknown; staticUrl?: unknown; storedProject?: unknown; storedUrl?: unknown };
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
function httpsOrigin(value: string) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash ? u.origin : null; } catch { return null; }
}
export function requestAdminOrigin(request: Request) {
  const parsed = new URL(request.url);
  const origin = !parsed.username && !parsed.password ? httpsOrigin(parsed.origin) : null;
  if (!origin) throw new Error('后台地址必须使用 HTTPS');
  return origin;
}
export function resolveSiteEntrances(input: Inputs): SiteEntrances {
  const none = (state: SiteEntrances['state']): SiteEntrances => ({ staticUrl: null, uploadUrl: null, project: null, state });
  const configuredProject = text(input.project), storedProject = text(input.storedProject);
  const configuredUrl = text(input.staticUrl), storedUrl = text(input.storedUrl), account = text(input.accountId);
  if ((configuredProject && storedProject && configuredProject !== storedProject) || (configuredUrl && storedUrl && httpsOrigin(configuredUrl) !== httpsOrigin(storedUrl))) return none('conflict');
  const project = configuredProject || storedProject, rawUrl = configuredUrl || storedUrl;
  if ((project && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(project)) || (rawUrl && !httpsOrigin(rawUrl)) || (account && !/^[a-f0-9]{32}$/.test(account))) return none('conflict');
  if (!project || !rawUrl) return none('unconfigured');
  const staticUrl = httpsOrigin(rawUrl)!;
  const host = new URL(staticUrl).hostname;
  if (host.endsWith('.pages.dev') && host !== `${project}.pages.dev`) return none('conflict');
  return { staticUrl, project, uploadUrl: account ? `https://dash.cloudflare.com/${account}/pages/view/${project}/deployments/new` : null, state: 'configured' };
}
