import { expect, test, type Page, type Route } from "@playwright/test";
import { createDefaultPortfolioDocument } from "../../app/portfolio/default-document";
import { mediaAssetsInDocument } from "../../app/portfolio/model";

type StaticState = {
  configured: boolean; status: string; productionUrl: string | null; publicRevision: number;
  activeJob: { id: string; status: string; phase: string } | null;
  retryableJob: { id: string; status: string; phase: string } | null;
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
  await expect(page.getByText("尚未绑定 Netlify Site")).toBeVisible();
  await expect(page.locator("[data-static-site-qr]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发布静态网站" })).toBeDisabled();

  await page.unrouteAll({ behavior: "wait" });
  await mockAdmin(page, configured);
  await page.reload();
  await openPublish(page);
  await expect(page.getByText("50.0 MiB")).toBeVisible();
  await expect(page.getByText(/请先检查 Netlify 用量/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "发布静态网站" })).toBeEnabled();
  await expect(page.locator("[data-static-site-qr]")).toHaveCount(0);
});

test("active and retryable jobs expose verify/retry actions without creating another publish", async ({ page }) => {
  const actions: Array<Record<string, unknown>> = [];
  await mockAdmin(page, { ...configured, activeJob: { id: `job_${"a".repeat(32)}`, status: "DRAFT_DEPLOY_READY", phase: "artifact" } }, actions);
  await openPublish(page);
  await expect(page.getByRole("button", { name: "发布静态网站" })).toBeDisabled();
  await page.getByRole("button", { name: "重新核验" }).dispatchEvent("click");
  await expect.poll(() => actions.at(-1)?.action).toBe("verify");

  await page.unrouteAll({ behavior: "wait" });
  await mockAdmin(page, { ...configured, retryableJob: { id: `job_${"b".repeat(32)}`, status: "FAILED_RETRYABLE", phase: "publish" },
    lastError: { code: "NETLIFY_API_FAILED", summary: "操作未完成，上一正式站保持不变" } }, actions);
  await page.reload();
  await openPublish(page);
  await page.getByRole("button", { name: "重试原发布任务" }).dispatchEvent("click");
  await expect.poll(() => actions.at(-1)?.action).toBe("retry");
  expect(actions.at(-1)?.jobId).toBe(`job_${"b".repeat(32)}`);
});

test("first success renders the fixed URL QR while reauthorization and rollback remain explicit", async ({ page }) => {
  const published = { ...configured, status: "published", productionUrl: "https://student-work.netlify.app/",
    publicRevision: 1, lastSuccessAt: "2026-09-01T00:00:00.000Z", qrAvailable: true };
  await mockAdmin(page, published);
  await openPublish(page);
  await expect(page.locator("[data-static-site-qr] svg")).toBeVisible();
  await expect(page.getByRole("link", { name: /查看静态网站/u })).toHaveAttribute("href", published.productionUrl);
  await expect(page.getByRole("button", { name: "复制固定链接" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载二维码" })).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
  await mockAdmin(page, { ...published, status: "reauthorization_required",
    lastError: { code: "NETLIFY_REAUTHORIZATION_REQUIRED", summary: "Netlify 需要重新授权" } });
  await page.reload();
  await openPublish(page);
  await expect(page.getByText("需要重新授权", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "发布静态网站" })).toBeDisabled();
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

async function mockAdmin(page: Page, staticState: StaticState, actions: Array<Record<string, unknown>> = []) {
  const portfolio = createDefaultPortfolioDocument();
  for (const [index, asset] of mediaAssetsInDocument(portfolio).entries()) asset.key ??= `portfolio/e2e/media-${index}`;
  await page.route(/\/api\/admin\/static-site(?:\?.*)?$/u, async (route) => {
    if (route.request().method() === "POST") {
      actions.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
      await json(route, { ok: true, waiting: true, job: staticState.activeJob ?? staticState.retryableJob });
      return;
    }
    await json(route, staticState);
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
