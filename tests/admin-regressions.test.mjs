import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminClient = await readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8");
const cropEditor = await readFile(new URL("../app/admin/media-crop-editor.tsx", import.meta.url), "utf8");
const adminEnhancements = await readFile(new URL("../app/admin/admin-interaction-enhancements.tsx", import.meta.url), "utf8");
const portfolioCss = await readFile(new URL("../app/demo/portfolio-demo.module.css", import.meta.url), "utf8");

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
