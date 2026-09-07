import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDefaultPortfolioDocument } from "../../app/portfolio/default-document";
import { buildNetlifyStatic } from "../../scripts/build-netlify-static.mjs";

const output = resolve("test-results", "static-site-e2e-artifact");

test.beforeAll(async () => {
  const candidate = createDefaultPortfolioDocument();
  const hook = { jobId: `job_${"a".repeat(32)}`, generation: 1, providerRequestKey: "sp-aaaaaaaaaaaaaaaaaaaaaaaa",
    bootstrapGrant: "bootstrap_grant_that_is_long_enough" };
  const source = { schemaVersion: 1, jobId: hook.jobId, generation: 1, publicRevision: 1,
    providerRequestKey: hook.providerRequestKey, candidateSha256: "c".repeat(64), sourceCommitSha: "d".repeat(40),
    candidate, media: [] };
  await buildNetlifyStatic({ env: { DEPLOY_ID: "deploy-e2e", STATIC_EXPORT_ORIGIN: "https://worker.example.test",
    INCOMING_HOOK_BODY: JSON.stringify(hook), COMMIT_REF: "d".repeat(40), NETLIFY_SITE_ID_HASH: "site-hash",
    WORKER_ADMIN_URL: "https://student-worker.example.workers.dev/admin" }, output, fetcher: async (url: URL | RequestInfo) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/session")) return response({ lease: "lease_for_e2e", expiresAt: "2026-09-01T02:00:00.000Z" });
      if (pathname.endsWith("/manifest")) return response(source);
      return response({}, 404);
    } });
});

test("static artifact runs without Worker/API calls and keeps the admin link on the Worker", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));
  await serveArtifact(page);
  await page.goto("/static-candidate/index.html");
  await expect(page.getByRole("heading", { name: "林予安" })).toBeVisible();
  await expect(page.getByRole("link", { name: "管理作品" })).toHaveAttribute("href", "https://student-worker.example.workers.dev/admin");
  expect(requested.some((path) => path.startsWith("/api/"))).toBe(false);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("static artifact stays readable at 320, 360 and 390px", async ({ page }) => {
  await serveArtifact(page);
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/static-candidate/index.html");
    await expect(page.locator("#root")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});

async function serveArtifact(page: Page) {
  await page.route(/\/(?:static-candidate\/index\.html|assets\/[^/]+|data\/portfolio\.json)$/u, async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    const relative = pathname === "/static-candidate/index.html" ? "index.html" : pathname.slice(1);
    const contentType = relative.endsWith(".html") ? "text/html" : relative.endsWith(".js") ? "text/javascript"
      : relative.endsWith(".css") ? "text/css" : "application/json";
    await route.fulfill({ status: 200, contentType, body: await readFile(resolve(output, relative)) });
  });
}

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
