import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { countGraphemes, graphemeCountLabel } from "../app/admin/grapheme.ts";
import {
  activeUploadReducer,
  createActiveUploadMap,
  failedUploads,
  hasBlockingUploads,
} from "../app/admin/upload-state.ts";
import { humanizeValidationMessage } from "../app/admin/validation-message.ts";

test("grapheme counts keep composed Chinese, emoji and combining marks intact", () => {
  assert.equal(countGraphemes("中文"), 2);
  assert.equal(countGraphemes("👨‍👩‍👧‍👦"), 1);
  assert.equal(countGraphemes("e\u0301"), 1);
  assert.equal(graphemeCountLabel("中文", 100), "2 / 100");
});

test("only active uploads block destructive admin transitions", () => {
  const started = activeUploadReducer(createActiveUploadMap(), {
    type: "start",
    upload: { id: "project:cover", filename: "cover.webp", targetView: "projects", targetId: "project" },
  });
  assert.equal(hasBlockingUploads(started), true);
  const progressed = activeUploadReducer(started, { type: "progress", id: "project:cover", progress: 106 });
  assert.equal(progressed.get("project:cover")?.progress, 100);
  const failed = activeUploadReducer(progressed, { type: "fail", id: "project:cover", error: "网络连接失败" });
  assert.equal(hasBlockingUploads(failed), false);
  assert.equal(failedUploads(failed).length, 1);
  assert.equal(activeUploadReducer(failed, { type: "dismiss", id: "project:cover" }).size, 0);
});

test("technical validation paths stay available separately from readable Chinese", () => {
  const raw = "联系方式 → 主标题（settings.contact.title）：需要 0–100 个字符，当前 101 个";
  const visible = humanizeValidationMessage(raw);
  assert.match(visible, /联系方式的主标题/u);
  assert.match(visible, /最多 100 个字符/u);
  assert.match(visible, /中文可以直接输入/u);
  assert.doesNotMatch(visible, /settings\.contact\.title/u);
});

test("visual viewport hook coalesces resize and scroll through one animation frame", async () => {
  const source = await readFile(new URL("../app/lib/use-visual-viewport.ts", import.meta.url), "utf8");
  assert.match(source, /visualViewport/u);
  assert.match(source, /addEventListener\("resize"/u);
  assert.match(source, /addEventListener\("scroll"/u);
  assert.match(source, /requestAnimationFrame/u);
  assert.match(source, /keyboardInset/u);
  assert.match(source, /removeEventListener/u);
});

test("mobile admin has one action bar, a stable more sheet and current-page navigation", async () => {
  const [client, css, guide, contract] = await Promise.all([
    readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin-guide-center.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/mobile-more-contract.ts", import.meta.url), "utf8"),
  ]);
  assert.equal((client.match(/data-admin-mobile-actions/g) ?? []).length, 1);
  assert.match(client, /data-admin-mobile-more/u);
  assert.match(client, /data-admin-mobile-more-actions/u);
  assert.match(client, /data-admin-section-nav/u);
  assert.match(client, /aria-current=\{view === item\.id \? "page"/u);
  assert.match(contract, /admin:mobile-more-close/u);
  assert.match(guide, /data-admin-mobile-more-actions/u);
  assert.match(css, /env\(safe-area-inset-bottom\)/u);
  assert.match(css, /--admin-keyboard-inset/u);
  assert.match(css, /font-size:\s*16px/u);
});

test("mobile project selection and records avoid horizontal-only desktop controls", async () => {
  const [client, css, access] = await Promise.all([
    readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/access-manager.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(client, /projectMobileSelector/u);
  assert.match(client, /选择当前作品/u);
  assert.match(client, /data-label="来源 \/ 网络"/u);
  assert.match(css, /\.tableWrap td::before/u);
  assert.match(css, /\.accessPassActions button\s*\{\s*min-height:\s*44px/u);
  assert.match(access, /手动复制访问链接/u);
  assert.match(access, /\.select\(\)/u);
});

test("phone preview reuses the real portfolio tree without an iframe", async () => {
  const [preview, experience, hero, endCover] = await Promise.all([
    readFile(new URL("../app/admin/mobile-portfolio-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio/portfolio-experience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio/hero-sequence.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio/end-cover-sequence.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(preview, /createPortal/u);
  assert.match(preview, /<PortfolioExperience initialPortfolio=\{portfolio\} mode="review" embedded initialPreviewTarget=\{target\}/u);
  assert.doesNotMatch(preview, /iframe/u);
  assert.match(experience, /const Root = embedded \? "div" : "main"/u);
  assert.match(experience, /initialPreviewTarget/u);
  assert.match(hero, /data-hero-slide-id/u);
  assert.match(endCover, /data-end-cover-id/u);
});

test("phone crop uses a cancel-safe full-screen sheet and complete pointer cleanup", async () => {
  const [crop, sheet] = await Promise.all([
    readFile(new URL("../app/admin/media-crop-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/mobile-editor-sheet.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(crop, /<MobileEditorSheet/u);
  assert.match(crop, /mobileSnapshotRef/u);
  assert.match(crop, /pointersRef/u);
  assert.match(crop, /pinchRef/u);
  assert.match(crop, /onPointerCancel/u);
  assert.match(crop, /onLostPointerCapture/u);
  assert.match(crop, /只有点击“确认”才会写入草稿/u);
  assert.match(sheet, /useScrollLock\(open\)/u);
  assert.match(sheet, /aria-modal="true"/u);
  assert.match(sheet, /adminRoot\.inert = true/u);
});

test("release browser gates cover mobile widths and both required codec engines", async () => {
  const [packageJson, config, mobileSuite, adminSuite, codecSuite, workflow] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../playwright.config.ts", import.meta.url), "utf8"),
    readFile(new URL("./e2e/mobile-portfolio.spec.ts", import.meta.url), "utf8"),
    readFile(new URL("./e2e/admin-mobile.spec.ts", import.meta.url), "utf8"),
    readFile(new URL("./e2e/codec.spec.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/release-verify.yml", import.meta.url), "utf8"),
  ]);
  assert.equal(packageJson.scripts["test:e2e"], "node scripts/run-playwright-suite.mjs mobile");
  assert.equal(packageJson.scripts["test:e2e:codec:chrome"], "node scripts/run-playwright-suite.mjs codec-chrome");
  assert.equal(packageJson.scripts["test:e2e:codec:webkit"], "node scripts/run-playwright-suite.mjs codec-webkit");
  for (const width of [320, 360, 390]) assert.match(mobileSuite, new RegExp(`width: ${width}`, "u"));
  assert.match(adminSuite, /选择当前作品/u);
  assert.match(adminSuite, /data-admin-mobile-actions/u);
  assert.match(adminSuite, /active chunk upload blocks transitions/u);
  assert.match(codecSuite, /avc1\.42E01E, mp4a\.40\.2/u);
  assert.match(config, /channel: "chrome"/u);
  assert.match(config, /browserName: "webkit"/u);
  assert.match(workflow, /runs-on: macos-latest/u);
  assert.match(workflow, /needs: \[release-verify, macos-webkit\]/u);
});
