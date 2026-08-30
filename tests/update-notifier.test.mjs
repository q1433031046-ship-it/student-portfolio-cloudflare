import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("version metadata advertises the v1.2.0 stability and end-cover upgrade", async () => {
  const [manifest, promptManifest] = await Promise.all([
    readFile("deployment/template-version.json", "utf8").then(JSON.parse),
    readFile("deployment/upgrade-prompt.json", "utf8").then(JSON.parse),
  ]);

  assert.equal(manifest.version, "1.2.0");
  assert.equal(manifest.importance, "recommended");
  assert.equal(manifest.upgradePromptManifest, "deployment/upgrade-prompt.json");
  assert.match(manifest.releaseNotes.join("\n"), /可选文案/u);
  assert.match(manifest.releaseNotes.join("\n"), /联系方式主标题/u);
  assert.match(manifest.releaseNotes.join("\n"), /封底/u);
  assert.match(manifest.releaseNotes.join("\n"), /恢复码/u);
  assert.equal(manifest.portfolioDocumentSchemaVersion, 5);
  assert.equal(promptManifest.schemaVersion, 1);
  assert.equal(promptManifest.program, manifest.program);
  assert.equal(promptManifest.promptVersion, manifest.version);
  assert.ok(promptManifest.prompt.length >= 300);
});

test("version endpoint validates and returns the canonical prompt with a local fallback", async () => {
  const route = await readFile("app/api/version/route.ts", "utf8");

  assert.match(route, /raw\.githubusercontent\.com\/q1433031046-ship-it\/student-portfolio-cloudflare\/main\/deployment\/template-version\.json/);
  assert.match(route, /raw\.githubusercontent\.com\/q1433031046-ship-it\/student-portfolio-cloudflare\/main\/deployment\/upgrade-prompt\.json/);
  assert.match(route, /Promise\.all/);
  assert.match(route, /remote\.program === localVersion\.program/);
  assert.match(route, /remote\.program !== localVersion\.program/);
  assert.match(route, /remote\.promptVersion !== latestVersion/);
  assert.match(route, /REQUIRED_PROMPT_MARKERS\.every/);
  assert.match(route, /latestUpgradePrompt = localUpgradePrompt\.prompt\.trim\(\)/);
  assert.match(route, /upgradePromptCheckSucceeded/);
  assert.match(route, /latestUpgradePromptManifestUrl/);
  assert.match(route, /updateAvailable/);
  assert.match(route, /compareVersions/);
});

test("all admin upgrade entry points copy the synchronized prompt", async () => {
  const [content, upgrade, guide, enhancements, promptManifest, readme] = await Promise.all([
    readFile("app/admin/admin-upgrade-content.ts", "utf8"),
    readFile("app/admin/admin-upgrade-center.tsx", "utf8"),
    readFile("app/admin/admin-guide-center.tsx", "utf8"),
    readFile("app/admin/admin-interaction-enhancements.tsx", "utf8"),
    readFile("deployment/upgrade-prompt.json", "utf8").then(JSON.parse),
    readFile("README.md", "utf8"),
  ]);

  for (const source of [upgrade, guide, enhancements]) {
    assert.match(source, /getUpgradePrompt/);
    assert.doesNotMatch(source, /\bUPGRADE_PROMPT\b/);
    assert.doesNotMatch(source, /PROGRAM_VERSION = "1\.0\.0"/);
    assert.doesNotMatch(source, /UPGRADE-GUIDE\.md/);
  }

  assert.match(content, /deployment\/upgrade-prompt\.json/);
  assert.match(content, /UPGRADE_PROMPT_SYNC_EVENT/);
  assert.match(content, /compareVersions\(promptVersion, activeUpgradePromptVersion\) < 0/);
  assert.match(guide, /addEventListener\(UPGRADE_PROMPT_SYNC_EVENT/);
  assert.match(guide, /<pre>\{upgradePrompt\}<\/pre>/);

  for (const phrase of [
    "不得创建或绑定 R2",
    "不得要求开通付费套餐",
    "不得把模板仓库中的任何资源 ID 覆盖",
    "至少 10 个独立会话",
    "无害的只读检查",
    "从中断步骤继续",
    "中文输入法选词不会被 Enter 提前结束",
    "当前最新系统恢复码",
    "多张独立封底",
  ]) {
    assert.match(promptManifest.prompt, new RegExp(phrase));
    assert.match(readme, new RegExp(phrase));
  }

  const readmePrompt = readme.match(/复制给 GPT：\s*```text\n([\s\S]*?)\n```/u);
  assert.ok(readmePrompt, "README must contain the copyable upgrade prompt");
  assert.equal(readmePrompt[1], promptManifest.prompt, "README and prompt manifest must stay synchronized");
});

test("admin synchronizes the prompt while preserving the update red dot", async () => {
  const [notifier, page] = await Promise.all([
    readFile("app/admin/admin-update-notifier.tsx", "utf8"),
    readFile("app/admin/page.tsx", "utf8"),
  ]);

  assert.match(page, /AdminUpdateNotifier/);
  assert.match(notifier, /syncUpgradePrompt\(payload\.latestUpgradePrompt, payload\.latestUpgradePromptVersion\)/);
  assert.match(notifier, /升级指令已同步至/);
  assert.match(notifier, /升级指令使用内置安全版本/);
  assert.match(notifier, /data-update-available/);
  assert.match(notifier, /发现新版本/);
  assert.match(notifier, /重新检查版本/);
  assert.match(notifier, /data-update-status-host/);
  assert.match(notifier, /width:min\(1840px,calc\(100% - 48px\)\)/);
  assert.match(notifier, /grid-template-columns:200px minmax\(0,1fr\)/);
  assert.match(notifier, /max-width:1400px/);
  assert.match(notifier, /border-left:1px solid var\(--line\)/);
});
