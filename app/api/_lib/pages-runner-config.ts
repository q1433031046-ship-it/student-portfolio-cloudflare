import { env } from 'cloudflare:workers';
import { PagesError } from './pages-errors';
import { PagesGitHub, validateSource } from './pages-github';
import { RunnerState } from './pages-runner-state';
type RunnerBindings = { DB: D1Database; PAGES_GITHUB_TOKEN?: string; PAGES_RUNNER_HMAC_KEY?: string; PAGES_RUNNER_HEAD?: string; PAGES_RUNNER_REF?: string; PAGES_RUNNER_TEMPLATE_SHA?: string; WORKER_PUBLIC_ORIGIN?: string };
export function runnerConfig() {
  const e = env as unknown as RunnerBindings;
  const source = { head: e.PAGES_RUNNER_HEAD ?? '', ref: e.PAGES_RUNNER_REF ?? '', template: e.PAGES_RUNNER_TEMPLATE_SHA ?? '' }; validateSource(source);
  const origin = new URL(e.WORKER_PUBLIC_ORIGIN ?? 'https://invalid.invalid');
  if (!e.DB || !e.PAGES_GITHUB_TOKEN || !e.PAGES_RUNNER_HMAC_KEY || e.PAGES_RUNNER_HMAC_KEY.length < 32 || !e.WORKER_PUBLIC_ORIGIN || origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new PagesError('RUNNER_UNCONFIGURED', '静态执行接入尚未完成', 503);
  return { db: e.DB, state: new RunnerState(e.DB, new PagesGitHub(e.PAGES_GITHUB_TOKEN)), secret: e.PAGES_RUNNER_HMAC_KEY, source, origin: origin.origin };
}
