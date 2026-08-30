import { expect, test, type Page } from "@playwright/test";
import { createDefaultPortfolioDocument } from "../../app/portfolio/default-document";

const mobileViewports = [
  { width: 320, height: 700 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
];

for (const viewport of mobileViewports) {
  test(`public portfolio remains touch-usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/demo");
    await expect(page.locator("[data-hero-slide-index='0']")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const enter = page.getByRole("button", { name: "查看作品" }).last();
    await expect(enter).toBeVisible();
    await expectTouchTarget(enter);
    await enter.click();
    await expect(page.locator("#works")).toBeVisible();

    const firstProject = page.locator("[data-project-id]").first();
    const openProject = firstProject.getByRole("button", { name: /展开.*项目详情/u });
    await expect(openProject).toBeVisible();
    await expectTouchTarget(openProject);
    await openProject.click();
    await expect(firstProject).toHaveAttribute("data-open", "true");
    await expect(firstProject.getByText("收起作品", { exact: true })).toBeVisible();

    const contact = page.getByRole("button", { name: /联系/u }).first();
    await contact.click();
    await expect(page.getByRole("dialog", { name: /联系/u })).toBeVisible();
    const close = page.getByRole("button", { name: "关闭联系方式" });
    await expectTouchTarget(close);
    await close.click();
    await expect(page.getByRole("dialog", { name: /联系/u })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
}

test("hero carousel exposes persistent controls and only prioritizes the first image", async ({ page }) => {
  const portfolio = createDefaultPortfolioDocument();
  const pixel = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='2'%3E%3Cpath fill='%23000' d='M0 0h2v2H0z'/%3E%3C/svg%3E";
  portfolio.hero.slides = portfolio.hero.slides.map((slide) => ({
    ...slide,
    media: { ...slide.media, src: pixel },
  }));
  await page.route(/\/api\/admin\/portfolio(?:\?.*)?$/u, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ portfolio }),
  }));
  await page.goto("/preview");
  await expect(page.locator("[data-hero-slide-index='0'] img")).toHaveAttribute("loading", "eager");
  await expect(page.locator("[data-hero-slide-index='1'] img")).toHaveAttribute("loading", "lazy");
  const controls = page.getByRole("group", { name: "首图轮播控制" });
  await expect(controls).toBeVisible();
  await expectTouchTarget(controls.getByRole("button", { name: "下一张首图" }));
  await controls.getByRole("button", { name: "下一张首图" }).click();
  await expect(controls.getByText(/第 2 张，共 2 张/u)).toBeAttached();
});

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))).toEqual(expect.objectContaining({
    width: page.viewportSize()?.width,
    scrollWidth: page.viewportSize()?.width,
  }));
}

async function expectTouchTarget(locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  expect(box, "control should be visible").not.toBeNull();
  expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(44);
}
