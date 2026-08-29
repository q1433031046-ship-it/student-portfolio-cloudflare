import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { createDefaultPortfolioDocument } = await import("../app/portfolio/default-document.ts");
const { validatePortfolioDocument } = await import("../app/portfolio/model.ts");

const [adminClient, heroEditor, projectCover, heroSequence, portfolioExperience, previewCache, adminCss, portfolioCss] = await Promise.all([
  readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/hero-layout-editor.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/portfolio/project-cover.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/portfolio/hero-sequence.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/portfolio/portfolio-experience.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/media-preview-cache.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/admin.module.css", import.meta.url), "utf8"),
  readFile(new URL("../app/demo/portfolio-demo.module.css", import.meta.url), "utf8"),
]);

test("display fields may be blank without weakening structural validation", () => {
  const document = createDefaultPortfolioDocument();
  document.hero.name = "";
  document.hero.role = "";
  document.hero.targetRole = "";
  document.hero.email = "";
  document.hero.statement = "";
  document.settings.contact.title = "";
  document.settings.workHeading.lead = "";
  document.settings.workHeading.accent = "";
  document.categories[0].label = "";
  document.projects[0].title = "";
  document.projects[0].year = "";
  document.projects[0].synopsis = "";
  document.projects[0].detailBlocks = [
    { id: "blank-text", type: "text", eyebrow: "", title: "", body: "" },
  ];

  const result = validatePortfolioDocument(document);
  assert.equal(result.ok, true, result.ok ? "" : result.errors.join("\n"));
});

test("non-empty optional email and year still require valid formats", () => {
  const document = createDefaultPortfolioDocument();
  document.hero.email = "not-an-email";
  document.projects[0].year = "26";
  const result = validatePortfolioDocument(document);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /hero\.email 格式无效/u);
  assert.match(result.errors.join("\n"), /projects\[0\]\.year 无效/u);
});

test("admin media previews are keyed by the active asset instead of one stale component state", () => {
  assert.match(adminClient, /useMediaPreview\(asset\)/u);
  assert.match(adminClient, /rememberLocalMediaPreview\(result\.asset, uploadFile\)/u);
  assert.match(adminClient, /useMediaPreview\(project\.cover\)/u);
  assert.match(adminClient, /key=\{selectedProject\.id\}/u);
  assert.match(previewCache, /previewByAsset/u);
  assert.match(previewCache, /MAX_LOCAL_PREVIEWS/u);
  assert.doesNotMatch(adminClient, /useState<string \| undefined>\(asset\.src\)/u);
});

test("visual text accepts Enter and uses Ctrl or Command plus Enter to finish editing", () => {
  assert.match(adminClient, /event\.ctrlKey \|\| event\.metaKey/u);
  assert.match(heroEditor, /event\.ctrlKey \|\| event\.metaKey/u);
  assert.match(adminCss, /authored multiline text/u);
  assert.match(portfolioCss, /authored multiline output/u);
  assert.match(portfolioCss, /white-space:\s*pre-wrap/u);
});

test("empty public values are omitted rather than replaced with visible placeholder copy", () => {
  assert.match(projectCover, /showTitle.*Boolean\(title \|\| categoryLabel\)/u);
  assert.match(projectCover, /title && <h2>/u);
  assert.match(heroSequence, /if \(!hero\.name\.trim\(\)\) return null/u);
  assert.match(portfolioExperience, /block\.body\.trim\(\) && <div><p>/u);
  assert.match(portfolioExperience, /portfolio\.hero\.email\.trim\(\) && <a/u);
});

test("validation errors can identify project blocks and offer a locate action", () => {
  assert.match(adminClient, /humanizeValidationFailure/u);
  assert.match(adminClient, /actionLabel:\s*"定位并修改"/u);
  assert.match(adminClient, /data-error-path/u);
});
