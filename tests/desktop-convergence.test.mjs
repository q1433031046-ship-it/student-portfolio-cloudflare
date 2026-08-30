import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { shouldFinishMultilineInlineEditing } from "../app/admin/inline-editing.ts";
import { parseValidationLocation, validationViewForReason } from "../app/admin/validation-location.ts";
import { migrateLegacyMediaUntilComplete } from "../app/admin/legacy-media-migration.ts";
import { replacementKeyForUpload } from "../app/admin/media-upload-policy.ts";
import { heroLayerStyle } from "../app/portfolio/hero-layer-style.ts";
import { hasHeroLayerContent } from "../app/portfolio/hero-layer-content.ts";
import { trimVisibleText } from "../app/lib/text-visibility.ts";
import { toUserFacingChineseError, userFacingError, userFacingResponseError } from "../app/lib/user-facing-error.ts";
import { adminDraftVideoSource, hasPlayableVideo, optionalVideoReset } from "../app/portfolio/video-availability.ts";
import { hasContactContent } from "../app/portfolio/contact-availability.ts";

test("optional video availability works for admin drafts and public snapshots", () => {
  assert.equal(hasPlayableVideo({ key: undefined, src: undefined, label: "" }), false);
  assert.equal(hasPlayableVideo({ key: "portfolio/projects/a/final.mp4", label: "成稿.mp4" }), true);
  assert.equal(hasPlayableVideo({ label: "成稿.mp4" }), false);
  assert.equal(hasPlayableVideo({ label: "", available: true }), true);
  assert.equal(adminDraftVideoSource({ key: "portfolio/projects/a/final.mp4", label: "成稿.mp4" }), "/api/media/portfolio/projects/a/final.mp4");
  assert.equal(adminDraftVideoSource({ label: "" }), undefined);
  const reset = optionalVideoReset({ id: "new-video", label: "", alt: "", kind: "video", visualKey: "frame" });
  assert.equal(reset.duration, "00:00");
  assert.equal(reset.finalVideo.key, undefined);
  assert.equal(reset.finalVideo.src, undefined);
});

test("whitespace-only optional text is not visible", () => {
  assert.equal(trimVisibleText("  \t\n"), "");
  assert.equal(trimVisibleText("　"), "");
  assert.equal(trimVisibleText("  中文内容  "), "中文内容");
});

test("a fully blank contact hides its entry while media or visible copy keeps it", () => {
  const blankHero = { email: " \t", phone: "　" };
  const blankContact = { eyebrow: "\n", title: " ", note: "　", image: {} };
  assert.equal(hasContactContent(blankHero, blankContact), false);
  assert.equal(hasContactContent(blankHero, { ...blankContact, image: { key: "portfolio/contact/image.webp" } }), true);
  assert.equal(hasContactContent({ ...blankHero, email: "hello@example.com" }, blankContact), true);
});

test("optional hero layers render only when their visible copy exists", () => {
  const blankHero = {
    statement: " \t\n",
    role: "　",
    targetRole: " ",
    email: "\n",
    phone: "\t",
  };
  assert.equal(hasHeroLayerContent("identity", blankHero), true);
  assert.equal(hasHeroLayerContent("statement", blankHero), false);
  assert.equal(hasHeroLayerContent("facts", blankHero), false);
  assert.equal(hasHeroLayerContent("statement", { ...blankHero, statement: "  保持好奇  " }), true);
  assert.equal(hasHeroLayerContent("facts", { ...blankHero, phone: " 138 0000 0000 " }), true);
});

test("an unsaved copied end cover uploads as new media without claiming its inherited key", () => {
  const inheritedKey = "portfolio/end-covers/original/end-cover-old.webp";
  assert.equal(replacementKeyForUpload(inheritedKey, false), null);
  assert.equal(replacementKeyForUpload(inheritedKey, true), inheritedKey);
  assert.equal(replacementKeyForUpload(undefined, true), null);
});

test("native browser errors never escape into user-visible copy", () => {
  assert.equal(toUserFacingChineseError(new TypeError("Failed to fetch"), "网络连接失败，请稍后重试"), "网络连接失败，请稍后重试");
  assert.equal(toUserFacingChineseError(new SyntaxError("Unexpected token < in JSON"), "响应读取失败，请稍后重试"), "响应读取失败，请稍后重试");
  assert.equal(toUserFacingChineseError(new Error("Failed to fetch 中文"), "网络连接失败，请稍后重试"), "网络连接失败，请稍后重试");
  assert.equal(toUserFacingChineseError(userFacingError("草稿已在其他页面更新"), "保存失败"), "草稿已在其他页面更新");
  assert.equal(userFacingResponseError({ error: "播放请求无效" }, "播放失败").message, "播放请求无效");
  assert.equal(userFacingResponseError({ error: "Failed to fetch 中文" }, "播放失败").message, "播放失败");
});

test("end-cover direct editing keeps Enter for line breaks", () => {
  assert.equal(shouldFinishMultilineInlineEditing({ key: "Enter", ctrlKey: false, metaKey: false }), false);
  assert.equal(shouldFinishMultilineInlineEditing({ key: "Enter", ctrlKey: true, metaKey: false }), true);
  assert.equal(shouldFinishMultilineInlineEditing({ key: "Enter", ctrlKey: false, metaKey: true }), true);
  assert.equal(shouldFinishMultilineInlineEditing({ key: "Enter", ctrlKey: true, isComposing: true, keyCode: 229 }), false);
});

test("recovery download records host, current v1.2.1 and UTC time", async () => {
  const [source, version] = await Promise.all([
    readFile(new URL("../app/admin/recovery-download.ts", import.meta.url), "utf8"),
    readFile(new URL("../deployment/template-version.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(version.version, "1.2.1");
  assert.match(source, /PROGRAM_VERSION/u);
  assert.match(source, /safeHostname/u);
  assert.match(source, /生成时间（UTC）/u);
  assert.match(source, /系统恢复码-\$\{filenameTime\}\.txt/u);
  const executable = source
    .replace(/import \{ PROGRAM_VERSION \} from "\.\.\/lib\/program-version";/u, `const PROGRAM_VERSION = ${JSON.stringify(version.version)};`)
    .replace(/(recoveryCode|hostname): string/gu, "$1");
  const recoveryModule = await import(`data:text/javascript;base64,${Buffer.from(executable).toString("base64")}`);
  const download = recoveryModule.buildRecoveryCodeDownload("RECOVERY-CODE", "Portfolio.Example", new Date("2026-08-30T12:34:56.789Z"));
  assert.equal(download.filename, "portfolio.example-v1.2.1-系统恢复码-20260830T123456Z.txt");
  assert.match(download.content, /站点：portfolio\.example/u);
  assert.match(download.content, /程序版本：v1\.2\.1/u);
  assert.match(download.content, /生成时间（UTC）：2026-08-30T12:34:56\.789Z/u);
});

test("validation locations distinguish the second project and second end cover", () => {
  assert.deepEqual(parseValidationLocation("第 2 个作品（projects[1].synopsis）：过长"), { projectIndex: 1, categoryIndex: null, blockIndex: null, endCoverIndex: null });
  assert.deepEqual(parseValidationLocation("第 2 张封底（endCovers.slides[1].statement）：过长"), { projectIndex: null, categoryIndex: null, blockIndex: null, endCoverIndex: 1 });
  assert.deepEqual(parseValidationLocation("projects[2].detailBlocks[3].body 无效"), { projectIndex: 2, categoryIndex: null, blockIndex: 3, endCoverIndex: null });
  assert.deepEqual(parseValidationLocation("categories[1].label 不能为空"), { projectIndex: null, categoryIndex: 1, blockIndex: null, endCoverIndex: null });
});

test("settings validation opens the view containing the exact editable field", () => {
  assert.equal(validationViewForReason("settings.workHeading.lead 长度不能超过 100"), "首图与文字");
  assert.equal(validationViewForReason("settings.workHeading.accent 长度不能超过 100"), "首图与文字");
  assert.equal(validationViewForReason("settings.videoWatermarkText 长度不能超过 80"), "作品");
});

test("legacy media migration advances one verified chunk at a time without parallel requests", async () => {
  let active = 0;
  let maximumActive = 0;
  let verifiedChunks = 0;
  const progress = [];
  const initial = {
    status: "ready",
    required: true,
    r2FileCount: 1,
    r2Bytes: 12,
    verifiedChunks: 0,
    verifiedBytes: 0,
    totalChunks: 3,
    sourceBindingAvailable: true,
    targetBindingAvailable: true,
    message: "可以迁移",
  };
  const result = await migrateLegacyMediaUntilComplete(initial, async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    verifiedChunks += 1;
    await Promise.resolve();
    active -= 1;
    return { ...initial, verifiedChunks, verifiedBytes: verifiedChunks * 4, status: verifiedChunks === 3 ? "complete" : "ready" };
  }, (summary) => progress.push(summary.verifiedChunks));
  assert.equal(result.status, "complete");
  assert.equal(maximumActive, 1);
  assert.deepEqual(progress, [1, 2, 3]);
});

test("legacy media migration continues when per-file counters reset", async () => {
  const initial = {
    status: "ready",
    required: true,
    r2FileCount: 2,
    r2Bytes: 8,
    verifiedChunks: 0,
    verifiedBytes: 0,
    totalChunks: 2,
    sourceBindingAvailable: true,
    targetBindingAvailable: true,
    message: "可以迁移",
  };
  const responses = [
    { ...initial, r2FileCount: 1, r2Bytes: 4, totalChunks: 1, status: "ready" },
    { ...initial, r2FileCount: 0, r2Bytes: 0, totalChunks: 0, status: "complete", required: false },
  ];
  const result = await migrateLegacyMediaUntilComplete(initial, async () => responses.shift(), () => undefined);
  assert.equal(result.status, "complete");
  assert.equal(responses.length, 0);
});

test("admin and public hero layers share the same positioning variable contract", async () => {
  const style = heroLayerStyle({
    id: "identity",
    kind: "identity",
    x: 12,
    y: 48,
    width: 70,
    scale: 1.4,
    zIndex: 3,
    align: "center",
    visible: true,
    color: "system",
    fontFamily: "system",
  });
  assert.equal(style["--layer-x"], "12%");
  assert.equal(style["--layer-y"], "48%");
  assert.equal(style["--layer-width"], "70%");
  assert.equal(style["--layer-scale"], 1.4);
  assert.equal(style["--layer-z"], 3);
  assert.equal(style["--layer-align"], "center");
  assert.equal(style.transform, undefined);
  const [heroEditor, endCoverEditor, heroSequence, endCoverSequence, adminCss, publicCss] = await Promise.all([
    readFile(new URL("../app/admin/hero-layout-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/end-cover-layout-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio/hero-sequence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio/end-cover-sequence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/demo/portfolio-demo.module.css", import.meta.url), "utf8"),
  ]);
  for (const consumer of [heroEditor, endCoverEditor, heroSequence, endCoverSequence]) {
    assert.match(consumer, /heroLayerStyle\(layer\)/u);
  }
  for (const stylesheet of [adminCss, publicCss]) {
    assert.match(stylesheet, /left:\s*var\(--layer-x\)/u);
    assert.match(stylesheet, /top:\s*var\(--layer-y\)/u);
    assert.match(stylesheet, /width:\s*var\(--layer-width\)/u);
    assert.match(stylesheet, /scale\(var\(--layer-scale\)\)/u);
    assert.match(stylesheet, /text-align:\s*var\(--layer-align\)/u);
  }
  assert.match(publicCss, /\.heroLayer\s*\{[^}]*transform:\s*none/u);
});

test("desktop release UI omits optional video from publish blockers and guards new uploads", async () => {
  const [admin, cover, experience, heroSequence, mediaRoute] = await Promise.all([
    readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio/project-cover.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio/portfolio-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio/hero-sequence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/media/[...path]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(admin, /!project\.finalVideo\.key\s*\?\s*`\$\{project\.title\}：成稿`/u);
  assert.match(cover, /hasPlayableVideo/u);
  assert.match(experience, /adminDraftVideoSource/u);
  assert.match(experience, /projectSynopsis/u);
  assert.match(experience, /项目难点/u);
  assert.match(experience, /解决思路/u);
  assert.match(experience, /contactOpen && contactAvailable/u);
  assert.doesNotMatch(experience, /创作过程与项目资产/u);
  assert.match(experience, /aria-labelledby=\{workHeadingAvailable \? "work-heading" : undefined\}/u);
  assert.match(heroSequence, /hasHeroLayerContent\(layer\.kind, hero\)/u);
  assert.match(admin, /请先保存新作品再上传媒体/u);
  assert.match(admin, /请先保存新分类再上传过渡图/u);
  assert.match(admin, /replacementEligible=\{savedEndCoverSlideIds\.has\(slide\.id\)\}/u);
  assert.match(admin, /replacingKey: replacementKeyForUpload\(asset\.key, replacementEligible\)/u);
  assert.match(admin, /移除成稿视频/u);
  assert.match(admin, /optionalVideoReset/u);
  assert.match(admin, /LegacyMediaMigrationCard/u);
  assert.match(admin, /migrationRunningRef\.current/u);
  assert.match(admin, /开始逐块迁移并校验/u);
  assert.match(admin, /继续保留旧 BUCKET 绑定/u);
  assert.match(admin, /另行批准/u);
  assert.match(admin, /系统不会删除 R2 中的源文件/u);
  assert.match(admin, /当前剩余媒体处理进度/u);
  assert.match(admin, /已完成处理步骤/u);
  assert.match(admin, /完成一个文件后会切换到下一文件，处理步骤会按新文件重新计数/u);
  assert.doesNotMatch(admin, /已复制并校验块|aria-label="旧媒体迁移进度"/u);
  assert.doesNotMatch(mediaRoute, /"Not found"|"Access pass required"|"Playback grant required"|"Media unavailable"/u);
});
