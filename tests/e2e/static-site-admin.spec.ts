import { expect, test, type Page, type Route } from "@playwright/test";
import { createDefaultPortfolioDocument } from "../../app/portfolio/default-document";
import { mediaAssetsInDocument } from "../../app/portfolio/model";

type StaticState = {
  configured: boolean; status: string; productionUrl: string | null; publicRevision: number;
  activeJob: { id: string; status: string; phase: string; previewUrl?: string | null } | null;
  retryableJob: { id: string; status: string; phase: string; previewUrl?: string | null } | null;
  lastSuccessAt: string | null; lastError: { code: string; summary: string | null } | null;
  mediaTotalBytes: number; qrAvailable: boolean;
};

const configured: StaticState = {
  configured: true, status: "configured", productionUrl: null, publicRevision: 0,
  activeJob: null, retryableJob: null, lastSuccessAt: null, lastError: null,
  mediaTotalBytes: 50 * 1024 * 1024, qrAvailable: false,
};

test("static publishing card covers unconfigured and configured first-publish states without a premature QR", async ({ page }) => {
  await mockAdmin(page, { ...configured, configured: false, status: "unconfigured" });
  await openPublish(page);
  await expect(page.getByText("尚未配置 Cloudflare Pages")).toBeVisible();
  await expect(page.locator("[data-static-site-qr]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成静态预览" })).toBeDisabled();

  await page.unrouteAll({ behavior: "wait" });
  await mockAdmin(page, configured);
  await page.reload();
  await openPublish(page);
  await expect(page.getByText("50.0 MiB")).toBeVisible();
  await expect(page.getByText(/静态网站单个文件最大 25 MiB/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "生成静态预览" })).toBeEnabled();
  await expect(page.locator("[data-static-site-qr]")).toHaveCount(0);
});

test("verification exposes one immutable preview and promotion is a separate action", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await mockAdmin(page, { ...configured, activeJob: { id: `job_${"a".repeat(32)}`, status: "DRAFT_DEPLOY_READY", phase: "artifact" } }, actions);
  await openPublish(page);
  await expect(page.getByRole("button", { name: "生成静态预览" })).toBeDisabled();
  await expect.poll(() => actions.at(-1)?.action).toBe("verify");
  await expect(page.getByText("静态预览已核验，可以测试")).toBeVisible();
  await expect(page.getByRole("link", { name: /打开已核验静态预览/u })).toHaveAttribute("href", "https://1234abcd.student-work.pages.dev");
  await page.getByRole("button", { name: "发布到固定网址" }).dispatchEvent("click");
  await expect.poll(() => actions.at(-1)?.action).toBe("promote");

  await page.unrouteAll({ behavior: "wait" });
  await mockAdmin(page, { ...configured, retryableJob: { id: `job_${"b".repeat(32)}`, status: "FAILED_RETRYABLE", phase: "publish" },
    lastError: { code: "PAGES_REQUEST_FAILED", summary: "操作未完成，上一正式站保持不变" } }, actions);
  await page.reload();
  await openPublish(page);
  await page.getByRole("button", { name: "重试原发布任务" }).dispatchEvent("click");
  await expect.poll(() => actions.at(-1)?.action).toBe("retry");
  expect(actions.at(-1)?.jobId).toBe(`job_${"b".repeat(32)}`);
});

test("first success renders the fixed URL QR while reauthorization and rollback remain explicit", async ({ page }) => {
  const published = { ...configured, status: "published", productionUrl: "https://student-work.pages.dev",
    publicRevision: 1, lastSuccessAt: "2026-09-01T00:00:00.000Z", qrAvailable: true };
  await mockAdmin(page, published);
  await openPublish(page);
  await expect(page.locator("[data-static-site-qr] svg")).toBeVisible();
  await expect(page.getByRole("link", { name: /查看静态网站/u })).toHaveAttribute("href", published.productionUrl);
  await expect(page.getByRole("button", { name: "复制固定链接" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载二维码" })).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
  await mockAdmin(page, { ...published, status: "reauthorization_required",
    lastError: { code: "PAGES_AUTH_REQUIRED", summary: "Pages 需要重新授权" } });
  await page.reload();
  await openPublish(page);
  await expect(page.getByText("需要重新授权", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "生成静态预览" })).toBeDisabled();
  await expect(page.locator("[data-static-site-qr] svg")).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
  await mockAdmin(page, { ...published, status: "rollback_in_progress" });
  await page.reload();
  await openPublish(page);
  await expect(page.getByText("回滚中", { exact: true }).first()).toBeVisible();
  await expect(page.locator("[data-static-site-qr] svg")).toBeVisible();
});

async function openPublish(page: Page) {
  if (!page.url().includes("/admin")) await page.goto("/admin");
  await expect(page.getByText("草稿已同步").first()).toBeAttached();
  await page.locator("[data-admin-section-nav]").getByRole("button", { name: "发布" }).click();
  await expect(page.getByRole("heading", { name: "固定静态作品网站" })).toBeVisible();
}

for (const outcome of ['processing', 'failure', 'cancelled', 'lost-response'] as const) {
  test(`production ${outcome} uses verify after refresh without another promotion`, async ({ page }) => {
    const id = `job_${'c'.repeat(32)}`, actions: string[] = [];
    const counters = { dispatch: 1, deployment: 1, runReads: 0 };
    let current: StaticState = { ...configured, activeJob: { id, status: outcome === 'processing' ? 'PRODUCTION_READBACK_VERIFIED' : 'PUBLISH_REQUESTED', phase: 'production' } };
    let lose = outcome === 'lost-response';
    await mockAdmin(page, current);
    await page.unroute(/\/api\/admin\/static-site(?:\?.*)?$/u);
    await page.route(/\/api\/admin\/static-site(?:\?.*)?$/u, async route => {
      if (route.request().method() !== 'POST') { await json(route, current); return; }
      const action = route.request().postDataJSON(); actions.push(action.action);
      if (action.action === 'promote') { counters.dispatch++; await json(route, { error: 'PAGES_PROMOTION_USED' }, 409); return; }
      expect(action).toEqual({ action: 'verify', jobId: id }); counters.runReads++;
      if (outcome === 'failure' || outcome === 'cancelled') current = { ...current, activeJob: null, retryableJob: { id, status: 'FAILED_RETRYABLE', phase: 'production' }, lastError: { code: 'RUNNER_STOPPED', summary: `原执行${outcome}，保留原部署尝试` } };
      if (lose) { lose = false; await route.abort('failed'); return; }
      await json(route, { ok: true, waiting: true });
    });
    await openPublish(page);
    await expect.poll(() => counters.runReads).toBeGreaterThan(0);
    if (outcome === 'processing' || outcome === 'lost-response') {
      await page.getByRole('button', { name: '核验正式发布状态' }).dispatchEvent('click');
      await expect.poll(() => counters.runReads).toBeGreaterThan(1);
    } else await expect(page.getByRole('button', { name: '重试原发布任务' })).toBeVisible();
    const reads = counters.runReads;
    await page.reload(); await openPublish(page);
    if (outcome === 'processing' || outcome === 'lost-response') await expect.poll(() => counters.runReads).toBeGreaterThan(reads);
    else await expect(page.getByRole('button', { name: '重试原发布任务' })).toBeVisible();
    expect(actions.every(action => action === 'verify')).toBe(true);
    expect(counters.dispatch).toBe(1); expect(counters.deployment).toBe(1);
  });
}

test('lost first promotion response is recovered by verify after reload', async ({ page }) => {
  const id = `job_${'d'.repeat(32)}`, actions: string[] = [];
  let current: StaticState = { ...configured, activeJob: { id, status: 'ARTIFACT_VERIFIED', phase: 'preview', previewUrl: 'https://1234abcd.student-work.pages.dev' } };
  let dispatches = 0, deployments = 0;
  await mockAdmin(page, current);
  await page.unroute(/\/api\/admin\/static-site(?:\?.*)?$/u);
  await page.route(/\/api\/admin\/static-site(?:\?.*)?$/u, async route => {
    if (route.request().method() !== 'POST') { await json(route, current); return; }
    const action = route.request().postDataJSON(); actions.push(action.action);
    if (action.action === 'promote') {
      dispatches++; deployments++; current = { ...current, activeJob: { id, status: 'PUBLISH_REQUESTED', phase: 'production' } };
      await route.abort('failed'); return;
    }
    expect(action).toEqual({ action: 'verify', jobId: id });
    await json(route, { ok: true, waiting: true });
  });
  await openPublish(page);
  expect(actions).toEqual([]);
  await page.getByRole('button', { name: '发布到固定网址' }).dispatchEvent('click');
  await expect.poll(() => dispatches).toBe(1);
  await page.reload(); await openPublish(page);
  await expect.poll(() => actions.at(-1)).toBe('verify');
  expect(actions.filter(action => action === 'promote')).toHaveLength(1);
  expect(dispatches).toBe(1); expect(deployments).toBe(1);
});

async function mockAdmin(page: Page, staticState: StaticState, actions: Array<Record<string, unknown>> = []) {
  let currentState = staticState;
  const portfolio = createDefaultPortfolioDocument();
  for (const [index, asset] of mediaAssetsInDocument(portfolio).entries()) asset.key ??= `portfolio/e2e/media-${index}`;
  await page.route(/\/api\/admin\/static-site(?:\?.*)?$/u, async (route) => {
    if (route.request().method() === "POST") {
      const action = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      actions.push(action);
      if (action.action === "verify" && currentState.activeJob) {
        currentState = { ...currentState, activeJob: { ...currentState.activeJob, status: "ARTIFACT_VERIFIED", phase: "publish",
          previewUrl: "https://1234abcd.student-work.pages.dev" } };
      }
      if (action.action === "promote") {
        currentState = { ...currentState, activeJob: null, status: "published", productionUrl: "https://student-work.pages.dev",
          publicRevision: 1, qrAvailable: true };
      }
      await json(route, { ok: true, waiting: false, job: currentState.activeJob ?? currentState.retryableJob });
      return;
    }
    await json(route, currentState);
  });
  await page.route(/\/api\/admin\/setup(?:\?.*)?$/u, (route) => json(route, { state: "ready", identity: "student@example.com", currentProgramVersion: "1.3.1-b" }));
  await page.route(/\/api\/admin\/portfolio(?:\?.*)?$/u, (route) => json(route, { identity: { email: "student@example.com", provider: "password" },
    portfolio, revision: 12, updatedAt: "2026-09-01T00:00:00.000Z", publishedAt: staticState.publicRevision > 0 ? "2026-09-01T00:00:00.000Z" : null }));
  await page.route(/\/api\/admin\/access(?:\?.*)?$/u, (route) => json(route, { restrictionEnabled: false, featureStatus: "paused", updatedAt: null, passes: [] }));
  await page.route(/\/api\/admin\/storage(?:\?.*)?$/u, (route) => json(route, { usedBytes: staticState.mediaTotalBytes,
    limitBytes: 800 * 1024 * 1024, remainingBytes: 750 * 1024 * 1024, percentage: 6.25, status: "normal", fileCount: 1,
    videoCount: 1, otherCount: 0, fullSizeVideosRemaining: 15, legacyMigration: { status: "complete", required: false,
      r2FileCount: 0, r2Bytes: 0, verifiedChunks: 0, verifiedBytes: 0, totalChunks: 0, sourceBindingAvailable: false,
      targetBindingAvailable: true, message: "当前没有待迁移媒体" } }));
  await page.route(/\/api\/admin\/(?:events|audit)(?:\?.*)?$/u, (route) => json(route, route.request().url().includes("events") ? { events: [] } : { logs: [] }));
  await page.route(/\/api\/version(?:\?.*)?$/u, (route) => json(route, { currentVersion: "1.3.1-b", latestVersion: "1.3.1-b",
    updateAvailable: false, checkSucceeded: true, latestUpgradePrompt: "", latestUpgradePromptVersion: "1.3.1-b", upgradePromptCheckSucceeded: false }));
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
