import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("version metadata advertises the v1.1.2 safe upgrade notice", async () => {
  const manifest = JSON.parse(await readFile("deployment/template-version.json", "utf8"));
  assert.equal(manifest.version, "1.1.2");
  assert.equal(manifest.importance, "recommended");
  assert.ok(Array.isArray(manifest.releaseNotes));
  assert.ok(manifest.releaseNotes.length >= 3);
  assert.match(manifest.releaseNotes.join("\n"), /小红点/u);
  assert.match(manifest.releaseNotes.join("\n"), /资源/u);
});

test("version endpoint compares the installed version with the canonical GitHub template", async () => {
  const route = await readFile("app/api/version/route.ts", "utf8");
  assert.match(route, /raw\.githubusercontent\.com\/q1433031046-ship-it\/student-portfolio-cloudflare\/main\/deployment\/template-version\.json/);
  assert.match(route, /updateAvailable/);
  assert.match(route, /compareVersions/);
  assert.match(route, /checkSucceeded/);
  assert.match(route, /releaseNotes/);
  assert.match(route, /remote\.program === localVersion\.program/);
});

test("all admin upgrade entry points share one hardened prompt and manifest version", async () => {
  const [content, upgrade, guide, enhancements, readme] = await Promise.all([
    readFile("app/admin/admin-upgrade-content.ts", "utf8"),
    readFile("app/admin/admin-upgrade-center.tsx", "utf8"),
    readFile("app/admin/admin-guide-center.tsx", "utf8"),
    readFile("app/admin/admin-interaction-enhancements.tsx", "utf8"),
    readFile("README.md", "utf8"),
  ]);

  for (const source of [upgrade, guide, enhancements]) {
    assert.match(source, /admin-upgrade-content/);
    assert.doesNotMatch(source, /PROGRAM_VERSION = "1\.0\.0"/);
    assert.doesNotMatch(source, /UPGRADE-GUIDE\.md/);
  }
  for (const phrase of ["不得创建或绑定 R2", "不得要求开通付费套餐", "不得把模板仓库中的任何资源 ID 覆盖", "至少 10 个独立会话"]) {
    assert.match(content, new RegExp(phrase));
    assert.match(readme, new RegExp(phrase));
  }
});

test("admin shows update status and moves the desktop tutorial navigation left", async () => {
  const [notifier, page] = await Promise.all([
    readFile("app/admin/admin-update-notifier.tsx", "utf8"),
    readFile("app/admin/page.tsx", "utf8"),
  ]);

  assert.match(page, /AdminUpdateNotifier/);
  assert.match(notifier, /data-update-available/);
  assert.match(notifier, /发现新版本/);
  assert.match(notifier, /重新检查版本/);
  assert.match(notifier, /data-update-status-host/);
  assert.match(notifier, /width:min\(1840px,calc\(100% - 48px\)\)/);
  assert.match(notifier, /grid-template-columns:200px minmax\(0,1fr\)/);
  assert.match(notifier, /max-width:1400px/);
  assert.match(notifier, /border-left:1px solid var\(--line\)/);
});
