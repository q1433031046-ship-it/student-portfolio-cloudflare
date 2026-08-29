import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin and frontend project covers use the same container-based title scale", async () => {
  const [adminCss, publicCss, adminClient] = await Promise.all([
    readFile(new URL("../app/admin/admin.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/demo/portfolio-demo.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(adminCss, /\.coverLayoutPreview[^}]*container-type:\s*inline-size/u);
  assert.match(publicCss, /\.projectCover[^}]*container-type:\s*inline-size/u);
  assert.match(adminCss, /\.coverPreviewTitle strong[^}]*clamp\(28px,\s*7cqw,\s*112px\)/u);
  assert.match(publicCss, /\.projectTitleGroup h2[^}]*clamp\(28px,\s*7cqw,\s*112px\)/u);
  assert.doesNotMatch(publicCss, /\.projectTitleGroup[^}]*760px/u);
  assert.doesNotMatch(publicCss, /\.projectSynopsis[^}]*440px/u);
  assert.match(adminClient, /手机 4:5/u);
  assert.match(adminClient, /data-preview-device=\{previewDevice\}/u);
});

test("manual line breaks remain visible in hero, cover, contact and content text", async () => {
  const [adminCss, publicCss, adminClient, heroEditor] = await Promise.all([
    readFile(new URL("../app/admin/admin.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/demo/portfolio-demo.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/hero-layout-editor.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(adminCss, /white-space:\s*pre-line/u);
  assert.match(publicCss, /white-space:\s*pre-line/u);
  assert.match(adminClient, /innerText/u);
  assert.match(adminClient, /event\.ctrlKey \|\| event\.metaKey/u);
  assert.match(heroEditor, /innerText/u);
});
