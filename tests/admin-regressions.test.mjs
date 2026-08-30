import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminClient = await readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8");
const cropEditor = await readFile(new URL("../app/admin/media-crop-editor.tsx", import.meta.url), "utf8");
const adminEnhancements = await readFile(new URL("../app/admin/admin-interaction-enhancements.tsx", import.meta.url), "utf8");
const portfolioCss = await readFile(new URL("../app/demo/portfolio-demo.module.css", import.meta.url), "utf8");
const coverTextComponent = await readFile(new URL("../app/portfolio/project-cover-text.tsx", import.meta.url), "utf8");
const coverTextCss = await readFile(new URL("../app/portfolio/project-cover-text.module.css", import.meta.url), "utf8");
const projectCover = await readFile(new URL("../app/portfolio/project-cover.tsx", import.meta.url), "utf8");
const portfolioExperience = await readFile(new URL("../app/portfolio/portfolio-experience.tsx", import.meta.url), "utf8");
const endCoverSequence = await readFile(new URL("../app/portfolio/end-cover-sequence.tsx", import.meta.url), "utf8");
const endCoverEditor = await readFile(new URL("../app/admin/end-cover-layout-editor.tsx", import.meta.url), "utf8");
const uploadRoute = await readFile(new URL("../app/api/admin/media/[projectId]/[slot]/route.ts", import.meta.url), "utf8");

test("new projects start with zero video duration", () => {
  assert.match(adminClient, /duration:\s*"00:00"/u);
  assert.doesNotMatch(adminClient, /duration:\s*"00:30"/u);
});

test("confirmed crops hide the crop frame until adjustment is requested", () => {
  assert.match(cropEditor, /if \(!editing\)/u);
  assert.match(cropEditor, />调整裁切</u);
  assert.match(cropEditor, /setEditing\(false\)/u);
  assert.match(cropEditor, /确认后虚线框会隐藏/u);
});

test("mobile gallery keeps portrait and landscape output ratios distinct", () => {
  assert.match(portfolioCss, /galleryGrid\[data-orientation="portrait"\][^{]*\.mediaFrame\s*\{\s*aspect-ratio:\s*3\s*\/\s*4/u);
  assert.match(portfolioCss, /galleryGrid\[data-orientation="landscape"\][^{]*\.mediaFrame\s*\{\s*aspect-ratio:\s*4\s*\/\s*3/u);
});

test("admin errors can navigate to and highlight their source field", () => {
  assert.match(adminEnhancements, /validationView\(reason\)/u);
  assert.match(adminEnhancements, /projects\\\[\(\\d\+\)\\\]/u);
  assert.match(adminEnhancements, /data-admin-problem/u);
  assert.match(adminEnhancements, /scrollIntoView/u);
});

test("non-image-only hero modes collapse media controls and surface layout editing", () => {
  assert.match(adminEnhancements, /adminHeroMediaCollapsed/u);
  assert.match(adminEnhancements, /select\.value === "image-only"/u);
  assert.match(adminEnhancements, /拖动文字改变位置/u);
});

test("admin and public project covers share container-based text rendering", () => {
  assert.match(adminClient, /<ProjectCoverText/u);
  assert.match(projectCover, /<ProjectCoverText/u);
  assert.match(coverTextComponent, /data-cover-viewport/u);
  assert.match(coverTextCss, /cqw/u);
  assert.doesNotMatch(coverTextCss, /\bvw\b/u);
  assert.match(coverTextCss, /data-cover-viewport="mobile"/u);
  assert.match(adminClient, /桌面 16:9/u);
  assert.match(adminClient, /手机 4:5/u);
  assert.match(adminClient, /viewport === "mobile" \? 4 \/ 5 : 16 \/ 9/u);
  assert.match(adminClient, /croppedImageStyleForAspect\(project\.cover, 4 \/ 5\)/u);
  assert.match(projectCover, /projectArtworkMobile/u);
  assert.doesNotMatch(projectCover, /style=\{\{ aspectRatio:/u);
  assert.match(portfolioCss, /\.projectArtworkDesktop\s*\{\s*display:\s*none/u);
  assert.match(portfolioCss, /\.projectArtworkMobile\s*\{\s*display:\s*block/u);
});

test("uploaded image previews retain a local fallback and report retry state", () => {
  assert.match(adminClient, /localPreviewRef/u);
  assert.match(adminClient, /URL\.revokeObjectURL/u);
  assert.match(adminClient, /checkServerPreview/u);
  assert.match(adminClient, /媒体已上传，等待草稿保存/u);
  assert.match(adminClient, /重新检查/u);
  assert.match(adminClient, /onPreviewError=\{handlePreviewError\}/u);
  assert.match(adminClient, /onPreviewChange=\{setCoverPreviewSrc\}/u);
});

test("multiple independent end covers can be edited and render before the footer", () => {
  assert.match(adminClient, /封底（尾图）/u);
  assert.match(adminClient, /createDefaultEndCoverSlide/u);
  assert.match(adminClient, /copySlide/u);
  assert.match(adminClient, /moveSlide/u);
  assert.match(adminClient, /slot="end-cover"/u);
  assert.match(endCoverEditor, /shouldFinishInlineEditing/u);
  assert.match(endCoverEditor, /Enter 换行/u);
  assert.match(endCoverSequence, /config\.slides\.map/u);
  assert.match(endCoverSequence, /if \(!entered \|\| !config\.enabled/u);
  assert.ok(portfolioExperience.indexOf("<EndCoverSequence") < portfolioExperience.indexOf("<footer"));
  assert.match(uploadRoute, /"end-cover"/u);
  assert.match(uploadRoute, /end-covers/u);
});

test("validation dialog offers direct location down to the selected content block", () => {
  assert.match(adminClient, /定位并修改/u);
  assert.match(adminClient, /data-block-index/u);
  assert.match(adminEnhancements, /detailBlocks\\\[\(\\d\+\)\\\]/u);
  assert.match(adminEnhancements, /data-block-index/u);
});
