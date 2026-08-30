import { expect, test, type Page, type Route } from "@playwright/test";
import { createDefaultPortfolioDocument } from "../../app/portfolio/default-document";
import { createDefaultEndCoverSlide } from "../../app/portfolio/model";

test.beforeEach(async ({ page }) => {
  await mockAdmin(page);
});

test("admin navigation, project selection, more actions and phone preview fit 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/admin");
  await expect(page.getByText("草稿已同步").first()).toBeAttached();
  await expect(page.locator("[data-admin-mobile-actions]")).toBeVisible();
  await expect(page.locator("[data-admin-mobile-actions]")).toHaveCount(1);
  await expectNoHorizontalOverflow(page);

  const nav = page.locator("[data-admin-section-nav]");
  await expect(nav.locator("button[aria-current='page']")).toContainText("概览");
  await nav.locator("button").nth(4).click();
  const selector = page.getByLabel("选择当前作品");
  await expect(selector).toBeVisible();
  await expect(selector.locator("option")).toHaveCount(10);
  await selector.selectOption({ index: 9 });
  await expect(selector).toHaveValue("project-mobile-10");

  const titleInput = page.getByLabel("作品名称");
  await expect(titleInput).toHaveCSS("font-size", "16px");
  await expect(page.getByText(/\/ 100/u).first()).toBeVisible();

  await page.getByRole("button", { name: "更多" }).click();
  const more = page.locator("[data-admin-mobile-more][data-open='true']");
  await expect(more).toBeVisible();
  await expect(more.getByRole("button", { name: "使用教程" })).toBeVisible();
  await more.getByRole("button", { name: "使用教程" }).click();
  await expect(page.locator("[data-admin-guide-overlay]")).toBeVisible();
  await page.getByRole("button", { name: "关闭教程" }).click();

  await nav.locator("button").nth(2).click();
  await page.getByRole("button", { name: "查看手机最终效果" }).click();
  const preview = page.locator("[data-mobile-portfolio-preview]");
  await expect(preview).toBeVisible();
  await expect(preview.locator("iframe")).toHaveCount(0);
  await expect(preview.locator("[data-embedded='true']")).toBeVisible();
  await preview.getByRole("button", { name: "关闭" }).click();

  const cropButton = page.getByRole("button", { name: /打开裁切|调整裁切/u }).first();
  await cropButton.click();
  const cropSheet = page.locator("[data-mobile-editor-sheet]");
  await expect(cropSheet).toBeVisible();
  await expect(cropSheet.getByRole("button", { name: "放大图片" })).toBeVisible();
  await cropSheet.getByRole("button", { name: "取消" }).click();
  await expect(cropSheet).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("an active chunk upload blocks transitions and unlocks after completion", async ({ page }) => {
  let releaseChunk: () => void = () => {};
  let markChunkStarted: () => void = () => {};
  const chunkGate = new Promise<void>((resolve) => { releaseChunk = resolve; });
  const chunkStarted = new Promise<void>((resolve) => { markChunkStarted = resolve; });
  await page.route(/\/api\/admin\/media\/site\/hero/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "PUT") {
      markChunkStarted();
      await chunkGate;
      await json(route, { ok: true });
      return;
    }
    if (url.searchParams.get("complete") === "1") {
      await json(route, { asset: { id: "hero-media", label: "phone.png", alt: "", kind: "image", visualKey: "frame", key: "portfolio/site/hero/phone.webp", src: "/api/media/portfolio/site/hero/phone.webp" } });
      return;
    }
    await json(route, { mode: "chunked", assetId: "hero-media", uploadId: "upload-mobile", chunkSize: 4 * 1024 * 1024, chunkCount: 1 });
  });

  await page.goto("/admin");
  const nav = page.locator("[data-admin-section-nav]");
  await nav.locator("button").nth(2).click();
  await page.locator("input[type='file']").first().setInputFiles({
    name: "phone.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await chunkStarted;
  await expect(nav.locator("button").first()).toBeDisabled();
  await expect(page.locator("[data-admin-mobile-actions]")).toContainText(/上传/u);
  releaseChunk();
  await expect(nav.locator("button").first()).toBeEnabled();
});

async function mockAdmin(page: Page) {
  const portfolio = createDefaultPortfolioDocument();
  const sourceProject = portfolio.projects[0];
  portfolio.projects = Array.from({ length: 10 }, (_, index) => ({
    ...structuredClone(sourceProject),
    id: `project-mobile-${index + 1}`,
    order: index + 1,
    title: `手机作品 ${index + 1}`,
    cover: { ...sourceProject.cover, id: `cover-mobile-${index + 1}` },
    finalVideo: { ...sourceProject.finalVideo, id: `video-mobile-${index + 1}` },
  }));
  const endCover = createDefaultEndCoverSlide("end-cover-mobile");
  endCover.title = "谢谢观看";
  endCover.contentMode = "system";
  portfolio.endCovers = { enabled: true, slides: [endCover] };

  await page.route(/\/api\/admin\/setup(?:\?.*)?$/u, (route) => json(route, { state: "ready", identity: "student@example.com", currentProgramVersion: "1.3.0" }));
  await page.route(/\/api\/admin\/portfolio(?:\?.*)?$/u, (route) => json(route, { identity: { email: "student@example.com", provider: "password" }, portfolio, revision: 12, updatedAt: new Date().toISOString(), publishedAt: new Date().toISOString() }));
  await page.route(/\/api\/admin\/access(?:\?.*)?$/u, (route) => json(route, { restrictionEnabled: false, updatedAt: null, passes: [] }));
  await page.route(/\/api\/admin\/storage(?:\?.*)?$/u, (route) => json(route, {
    usedBytes: 0,
    limitBytes: 800 * 1024 * 1024,
    remainingBytes: 800 * 1024 * 1024,
    percentage: 0,
    status: "normal",
    fileCount: 0,
    videoCount: 0,
    otherCount: 0,
    fullSizeVideosRemaining: 16,
    legacyMigration: { status: "complete", required: false, r2FileCount: 0, r2Bytes: 0, verifiedChunks: 0, verifiedBytes: 0, totalChunks: 0, sourceBindingAvailable: false, targetBindingAvailable: true, message: "当前没有待迁移媒体" },
  }));
  await page.route(/\/api\/admin\/(?:events|audit)(?:\?.*)?$/u, (route) => json(route, route.request().url().includes("events") ? { events: [] } : { logs: [] }));
  await page.route(/\/api\/version(?:\?.*)?$/u, (route) => json(route, {
    currentVersion: "1.3.0",
    latestVersion: "1.3.0",
    updateAvailable: false,
    checkSucceeded: true,
    latestUpgradePrompt: "",
    latestUpgradePromptVersion: "1.3.0",
    upgradePromptCheckSucceeded: false,
  }));
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
