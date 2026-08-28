import assert from "node:assert/strict";
import test from "node:test";
import { toPublicPortfolioDocument, validatePortfolioDocument } from "../app/portfolio/model.ts";
import { formatVideoDuration } from "../app/lib/video-duration.ts";

function documentFixture() {
  return {
    schemaVersion: 4,
    settings: {
      activeTheme: "graphite",
      expansionMode: "single",
      videoWatermarkText: "",
      videoWatermarkStyle: { fontSize: 18, color: "#ffffff", fontFamily: "system" },
      customFont: { id: "site-font", label: "", alt: "", kind: "font", visualKey: "frame" },
      workHeading: { lead: "作品不是结果。", accent: "它是一次完整思考。" },
    },
    hero: {
      name: "林予安",
      role: "AI 影像创作者",
      targetRole: "视觉设计",
      email: "hello@example.com",
      phone: "+86 138 0000 0000",
      statement: "把想象变成画面。",
      availability: "2026",
      slides: [{
        id: "hero-slide-1",
        contentMode: "system",
        effect: "halo",
        animationEnabled: true,
        media: { id: "hero-media", label: "个人首幅", alt: "个人首幅", kind: "image", visualKey: "frame" },
        layers: [
          { id: "identity", kind: "identity", x: 3, y: 68, width: 40, scale: 1, align: "left", zIndex: 2, visible: true, color: "system", fontFamily: "system" },
          { id: "statement", kind: "statement", x: 3, y: 87, width: 36, scale: 1, align: "left", zIndex: 2, visible: true, color: "system", fontFamily: "system" },
          { id: "facts", kind: "facts", x: 72, y: 72, width: 25, scale: 1, align: "left", zIndex: 3, visible: true, color: "system", fontFamily: "system" },
        ],
      }],
    },
    themes: [{ id: "graphite", label: "石墨", swatches: ["#101114", "#f5f4ef", "#9fb4ff"] }],
    categories: [{
      id: "narrative",
      label: "AI 剧情短片",
      accent: "#9fb4ff",
      transition: { mode: "default", visible: true, media: { id: "transition-one", label: "", alt: "", kind: "image", visualKey: "frame" } },
    }],
    projects: [{
      id: "project-one",
      order: 1,
      categoryId: "narrative",
      title: "回声之后",
      year: "2026",
      duration: "02:48",
      synopsis: "作品简介。",
      challenge: "",
      solution: "",
      cover: { id: "cover-one", label: "封面", alt: "封面", kind: "image", visualKey: "frame" },
      finalVideo: { id: "final-one", label: "成稿", alt: "", kind: "video", visualKey: "frame" },
      coverPresentation: { showTitle: true, showSynopsis: true, showFacts: true },
      detailBlocks: [{ id: "block-one", type: "text", eyebrow: "PROCESS", title: "制作过程", body: "正文。" }],
    }],
  };
}

function legacyDocumentFixture() {
  const value = schemaTwoDocumentFixture();
  value.schemaVersion = 1;
  value.projects[0].draftVideo = { id: "legacy-media", label: "过程版本", alt: "", kind: "video", visualKey: "storyboard" };
  return value;
}

function schemaTwoDocumentFixture() {
  const current = documentFixture();
  const slide = current.hero.slides[0];
  return {
    ...current,
    schemaVersion: 2,
    settings: { activeTheme: current.settings.activeTheme, expansionMode: current.settings.expansionMode },
    hero: {
      name: current.hero.name,
      role: current.hero.role,
      targetRole: current.hero.targetRole,
      email: current.hero.email,
      statement: current.hero.statement,
      availability: current.hero.availability,
      effect: slide.effect,
      animationEnabled: slide.animationEnabled,
      media: slide.media,
    },
    categories: current.categories.map(({ id, label, accent }) => ({ id, label, accent })),
  };
}

function schemaThreeDocumentFixture() {
  const current = documentFixture();
  return {
    ...current,
    schemaVersion: 3,
    settings: {
      activeTheme: current.settings.activeTheme,
      expansionMode: current.settings.expansionMode,
      videoWatermarkText: current.settings.videoWatermarkText,
    },
    hero: {
      ...current.hero,
      slides: current.hero.slides.map((slide) => ({
        ...slide,
        layers: slide.layers.map((layer) => ({
          id: layer.id,
          kind: layer.kind,
          x: layer.x,
          y: layer.y,
          width: layer.width,
          scale: layer.scale,
          align: layer.align,
          zIndex: layer.zIndex,
          visible: layer.visible,
        })),
      })),
    },
    categories: current.categories.map((category) => ({
      ...category,
      transition: { mode: category.transition.mode, media: category.transition.media },
    })),
    projects: current.projects.map((project) => ({
      id: project.id,
      order: project.order,
      categoryId: project.categoryId,
      title: project.title,
      year: project.year,
      duration: project.duration,
      synopsis: project.synopsis,
      challenge: project.challenge,
      solution: project.solution,
      cover: project.cover,
      finalVideo: project.finalVideo,
      detailBlocks: project.detailBlocks,
    })),
  };
}

test("accepts an extensible portfolio document", () => {
  const result = validatePortfolioDocument(documentFixture());
  assert.equal(result.ok, true);
  assert.equal(result.value.settings.siteTitle, "中科云领学生作品展示");
  assert.equal(result.value.settings.coverOverlayMode, "hover");
  assert.equal(result.value.settings.contact.layout, "details-left");
  assert.equal(result.value.settings.contact.titleStyle.fontFamily, "system");
  assert.equal(result.value.projects[0].coverPresentation.overlayMode, "hover");
  assert.equal(result.value.themes.some((theme) => theme.id === "white"), true);
});

test("carries the published cover overlay setting into each existing project", () => {
  const value = documentFixture();
  value.settings.coverOverlayMode = "fixed";
  const result = validatePortfolioDocument(value);
  assert.equal(result.ok, true);
  assert.equal(result.value.projects[0].coverPresentation.overlayMode, "fixed");
});

test("preserves the project title visibility setting", () => {
  const value = documentFixture();
  value.projects[0].coverPresentation.showTitle = false;
  const result = validatePortfolioDocument(value);
  assert.equal(result.ok, true);
  assert.equal(result.value.projects[0].coverPresentation.showTitle, false);
});

test("normalizes an existing document into the current schema", () => {
  const result = validatePortfolioDocument(legacyDocumentFixture());
  assert.equal(result.ok, true);
  assert.equal(result.value.schemaVersion, 4);
  assert.equal(result.value.hero.slides[0].animationEnabled, true);
  assert.equal(result.value.hero.slides[0].media.kind, "image");
  assert.equal("draftVideo" in result.value.projects[0], false);
});

test("normalizes a schema two document into the current schema", () => {
  const result = validatePortfolioDocument(schemaTwoDocumentFixture());
  assert.equal(result.ok, true);
  assert.equal(result.value.schemaVersion, 4);
  assert.equal(result.value.hero.phone, "");
  assert.equal(result.value.settings.videoWatermarkText, "");
  assert.equal(result.value.categories[0].transition.mode, "default");
});

test("normalizes a schema three document with presentation defaults", () => {
  const result = validatePortfolioDocument(schemaThreeDocumentFixture());
  assert.equal(result.ok, true);
  assert.equal(result.value.schemaVersion, 4);
  assert.equal(result.value.categories[0].transition.visible, true);
  assert.equal(result.value.hero.slides[0].layers[0].color, "system");
  assert.equal(result.value.hero.slides[0].layers[0].fontFamily, "system");
  assert.equal(result.value.projects[0].coverPresentation.showTitle, true);
  assert.equal(result.value.projects[0].coverPresentation.overlayMode, "hover");
  assert.equal(result.value.projects[0].coverPresentation.titleStyle?.x, 3);
  assert.equal(result.value.projects[0].coverPresentation.factsStyle?.width, 72);
  assert.equal(result.value.settings.customFont.kind, "font");
});

test("normalizes and validates bounded media focus positions", () => {
  const value = documentFixture();
  value.projects[0].cover.objectPosition = { x: 14, y: 82 };
  const result = validatePortfolioDocument(value);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.projects[0].cover.objectPosition, { x: 14, y: 82 });
  value.projects[0].cover.objectPosition = { x: 120, y: 40 };
  assert.equal(validatePortfolioDocument(value).ok, false);
});

test("accepts confirmed crop rectangles and rejects crops outside the source", () => {
  const value = documentFixture();
  value.hero.slides[0].media.sourceAspectRatio = 1.5;
  value.hero.slides[0].media.crop = { x: 10, y: 15, width: 70, height: 60 };
  const result = validatePortfolioDocument(value);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.hero.slides[0].media.crop, { x: 10, y: 15, width: 70, height: 60 });
  value.hero.slides[0].media.crop = { x: 60, y: 15, width: 70, height: 60 };
  assert.equal(validatePortfolioDocument(value).ok, false);
});

test("limits gallery blocks to four images and normalizes their orientation", () => {
  const value = documentFixture();
  value.projects[0].detailBlocks.push({
    id: "gallery-one",
    type: "gallery",
    eyebrow: "GALLERY",
    title: "图片组",
    items: Array.from({ length: 4 }, (_, index) => ({ id: `gallery-media-${index}`, label: "", alt: "", kind: "image", visualKey: "frame" })),
  });
  const result = validatePortfolioDocument(value);
  assert.equal(result.ok, true);
  assert.equal(result.value.projects[0].detailBlocks[1].orientation, "portrait");
  value.projects[0].detailBlocks[1].items.push({ id: "gallery-media-5", label: "", alt: "", kind: "image", visualKey: "frame" });
  assert.equal(validatePortfolioDocument(value).ok, false);
});

test("formats uploaded video duration without manual hour fields", () => {
  assert.equal(formatVideoDuration(0), "00:00");
  assert.equal(formatVideoDuration(89.6), "01:30");
  assert.equal(formatVideoDuration(3661), "61:01");
  assert.equal(formatVideoDuration(999 * 60 + 120), "999:59");
});

test("rejects duplicate category ids", () => {
  const value = documentFixture();
  value.categories.push({ ...value.categories[0] });
  const result = validatePortfolioDocument(value);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /重复/);
});

test("rejects a project with an orphan category", () => {
  const value = documentFixture();
  value.projects[0].categoryId = "missing";
  const result = validatePortfolioDocument(value);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /未引用有效分类/);
});

test("rejects an invalid media kind in a cover slot", () => {
  const value = documentFixture();
  value.projects[0].cover.kind = "video";
  const result = validatePortfolioDocument(value);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /cover.kind 必须为 image/);
});

test("rejects malformed contact emails and impossible duration seconds", () => {
  const invalidEmail = documentFixture();
  invalidEmail.hero.email = "not-an-email";
  assert.match(validatePortfolioDocument(invalidEmail).errors.join("\n"), /email 格式无效/);

  const invalidDuration = documentFixture();
  invalidDuration.projects[0].duration = "02:99";
  assert.match(validatePortfolioDocument(invalidDuration).errors.join("\n"), /duration 无效/);
});

test("public documents expose image routes but not private video keys", () => {
  const value = documentFixture();
  value.projects[0].cover.key = "portfolio/project-one/cover-file.jpg";
  value.hero.slides[0].media.key = "portfolio/site/hero-file.jpg";
  value.categories[0].transition.media.key = "portfolio/categories/narrative/transition-file.jpg";
  value.settings.customFont.key = "portfolio/site/font-site-font.woff2";
  value.settings.contact = {
    eyebrow: "CONTACT / 01",
    title: "联系我",
    note: "欢迎联系。",
    layout: "details-left",
    image: { id: "site-contact-image", label: "联系图", alt: "联系图", kind: "image", visualKey: "frame", key: "portfolio/site/contact-image.jpg" },
  };
  value.projects[0].finalVideo.key = "portfolio/project-one/final-file.mp4";
  const publicDocument = toPublicPortfolioDocument(value);
  assert.equal(publicDocument.hero.slides[0].media.key, undefined);
  assert.equal(publicDocument.hero.slides[0].media.src, "/api/media/portfolio/site/hero-file.jpg");
  assert.equal(publicDocument.categories[0].transition.media.key, undefined);
  assert.equal(publicDocument.categories[0].transition.media.src, "/api/media/portfolio/categories/narrative/transition-file.jpg");
  assert.equal(publicDocument.settings.customFont.key, undefined);
  assert.equal(publicDocument.settings.customFont.src, "/api/media/portfolio/site/font-site-font.woff2");
  assert.equal(publicDocument.settings.contact.image.key, undefined);
  assert.equal(publicDocument.settings.contact.image.src, "/api/media/portfolio/site/contact-image.jpg");
  assert.equal(publicDocument.projects[0].cover.key, undefined);
  assert.equal(publicDocument.projects[0].cover.src, "/api/media/portfolio/project-one/cover-file.jpg");
  assert.equal(publicDocument.projects[0].finalVideo.key, undefined);
  assert.equal(publicDocument.projects[0].finalVideo.src, undefined);
});
