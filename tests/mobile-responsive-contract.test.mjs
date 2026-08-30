import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const modelSource = await readFile(new URL("../app/portfolio/model.ts", import.meta.url), "utf8");
const templateVersion = JSON.parse(
  await readFile(new URL("../deployment/template-version.json", import.meta.url), "utf8"),
);
const migrationJournal = JSON.parse(
  await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
);
const wrangler = JSON.parse(
  await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);
const [layoutSource, globalsCss, portfolioSource, heroSource, endCoverSource, categorySource, portfolioCss] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/portfolio/portfolio-experience.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/portfolio/hero-sequence.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/portfolio/end-cover-sequence.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/portfolio/category-transition.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/demo/portfolio-demo.module.css", import.meta.url), "utf8"),
]);

test("freezes mobile support at document schema five and migration 0007", async () => {
  assert.equal(templateVersion.portfolioDocumentSchemaVersion, 5);
  assert.match(modelSource, /export type PortfolioDocument = \{\s*schemaVersion: 5;/u);
  for (const persistedField of ["mobileCrop", "mobileLayout", "mobileLayers"]) {
    assert.doesNotMatch(modelSource, new RegExp(`\\b${persistedField}\\b`, "u"));
  }

  const sqlMigrations = (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  assert.equal(sqlMigrations.at(-1), "0007_legacy_media_and_access_state.sql");
  assert.equal(migrationJournal.entries.at(-1)?.tag, "0007_legacy_media_and_access_state");
});

test("keeps the public Worker template on one D1 and one media KV binding", () => {
  assert.deepEqual(wrangler.d1_databases.map(({ binding }) => binding), ["DB"]);
  assert.deepEqual(wrangler.kv_namespaces.map(({ binding }) => binding), ["MEDIA_KV"]);
  assert.equal("r2_buckets" in wrangler, false);
  assert.equal("database_id" in wrangler.d1_databases[0], false);
  assert.equal("id" in wrangler.kv_namespaces[0], false);
});

test("establishes safe-area responsive geometry without persisted mobile layout", () => {
  assert.match(layoutSource, /export const viewport: Viewport/u);
  assert.match(layoutSource, /viewportFit: "cover"/u);
  for (const edge of ["top", "right", "bottom", "left"]) {
    assert.match(globalsCss, new RegExp(`--safe-area-${edge}: env\\(safe-area-inset-${edge}`, "u"));
  }
  assert.match(portfolioCss, /100svh/u);
  assert.match(portfolioCss, /100dvh/u);
  assert.match(portfolioCss, /max-height:\s*560px/u);
  assert.match(portfolioCss, /pointer:\s*coarse/u);
  assert.match(portfolioSource, /--media-aspect-desktop/u);
  assert.match(portfolioSource, /--media-aspect-mobile/u);
  assert.doesNotMatch(portfolioSource, /style=\{aspectRatio \? \{ aspectRatio \}/u);
  assert.doesNotMatch(heroSource, /aspectRatio:\s*mediaCropAspect|minHeight:\s*"auto"/u);
  assert.doesNotMatch(endCoverSource, /aspectRatio:\s*mediaCropAspect|minHeight:\s*"auto"/u);
  assert.doesNotMatch(categorySource, /style=\{\{ aspectRatio:/u);
});

test("ships touch-first public navigation, lazy media and bounded playback", () => {
  assert.match(heroSource, /priority=\{index === 0\}/u);
  assert.match(heroSource, /scrollToSlide/u);
  assert.match(heroSource, /aria-live="polite"/u);
  assert.match(portfolioCss, /scroll-snap-type:\s*x mandatory/u);
  assert.match(portfolioSource, /useScrollLock/u);
  assert.match(portfolioSource, /autoplayRejected/u);
  assert.match(portfolioSource, /手动播放/u);
  assert.match(portfolioSource, /visibilitychange/u);
  assert.match(portfolioCss, /\.coverToggleLabel/u);
  assert.match(portfolioCss, /\.galleryGrid\[data-count="3"\]/u);
  assert.match(portfolioCss, /\.demo\[data-has-end-cover="true"\][^{]*\.footer/u);
});
