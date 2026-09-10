"use client";
import { useEffect, useState } from 'react';
import { fetchAdmin } from './admin-fetch';
import { resolveSiteEntrances, type SiteEntrances } from '../lib/site-entrances';

export function useSiteEntrances() {
  const [value, setValue] = useState<SiteEntrances>({ staticUrl: null, uploadUrl: null, project: null, state: 'unconfigured' });
  useEffect(() => {
    let active = true;
    void fetchAdmin('/api/admin/site-entrances').then(async response => {
      if (!response.ok) return;
      const data = await response.json() as SiteEntrances;
      const parsed = resolveSiteEntrances({ project: data.project, staticUrl: data.staticUrl });
      const uploadUrl = typeof data.uploadUrl === 'string' && /^https:\/\/dash\.cloudflare\.com\/[a-f0-9]{32}\/pages\/view\/[a-z0-9-]+\/deployments\/new$/.test(data.uploadUrl) && data.uploadUrl.split('/')[6] === parsed.project ? data.uploadUrl : null;
      if (active) setValue({ ...parsed, uploadUrl, state: data.state === 'conflict' ? 'conflict' : parsed.state });
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return value;
}
