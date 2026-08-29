import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

function media(id, kind = "image") {
  return { id, label: "", alt: "", kind, visualKey: "frame" };
}

function textStyle() {
  return { x: 5, y: 20, width: 50, scale: 1, align: "left", color: "system", fontFamily: "system" };
}

function documentFixture() {
  return {
    schemaVersion: 4,
    settings: {
      siteTitle: "学生作品展示",
      activeTheme: "graphite",
      expansionMode: "single",
      coverOverlayMode: "hover",
      videoWatermarkText: "",
      videoWatermarkStyle: { fontSize: 18, color: "#ffffff", fontFamily: "system" },
      customFont: media("site-font", "font"),
      workHeading: { lead: "作品不是结果。", accent: "它是一次完整思考。" },
      contact: {
        eyebrow: "CONTACT",
        title: "保持联系。",
        note: "欢迎联系。",
        layout: "details-left",
        image: media("contact-image"),
        eyebrowStyle: textStyle(),
        titleStyle: textStyle(),
        detailsStyle: textStyle(),
        noteStyle: textStyle(),
      },
    },
    hero: {
      name: "林予安",
      role: "AI 影像创作者",
      targetRole: "视觉设计",
      email: "hello@example.com",
      phone: "",
      statement: "把想象变成画面。",
      availability: "",
      slides: [{
        id: "hero-slide-one",
        media: media("hero-media-one"),
        contentMode: "system",
        effect: "halo",
        animationEnabled: true,
        layers: [
          { id: "identity-layer", kind: "identity", x: 3, y: 60, width: 40, scale: 1, align: "left", zIndex: 2, visible: true, color: "system", fontFamily: "system" },
          { id: "statement-layer", kind: "statement", x: 3, y: 80, width: 40, scale: 1, align: "left", zIndex: 2, visible: true, color: "system", fontFamily: "system" },
          { id: "facts-layer", kind: "facts", x: 70, y: 70, width: 25, scale: 1, align: "left", zIndex: 3, visible: true, color: "system", fontFamily: "system" },
        ],
      }],
    },
    themes: [{ id: "graphite", label: "石墨", swatches: ["#0a0a0b", "#f2f1ed", "#a9c7d6"] }],
    categories: [{
      id: "category-one",
      label: "影像",
      accent: "#9fb4ff",
      transition: { mode: "default", visible: true, media: media("transition-one") },
    }],
    projects: [{
      id: "project-one",
      order: 1,
      categoryId: "category-one",
      title: "项目一",
      year: "2026",
      duration: "00:00",
      synopsis: "项目简介",
      challenge: "",
      solution: "",
      cover: media("cover-one"),
      finalVideo: media("video-one", "video"),
      coverPresentation: {
        overlayMode: "hover",
        showTitle: true,
        showSynopsis: true,
        showFacts: true,
        titleStyle: textStyle(),
        synopsisStyle: textStyle(),
        factsStyle: textStyle(),
      },
      detailBlocks: [],
    }],
  };
}

test("display fields may be blank without weakening structural validation", () => {
  const document = documentFixture();
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
  const document = documentFixture();
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
