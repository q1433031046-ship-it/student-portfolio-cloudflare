import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("version metadata advertises the first automatic update-notification release", async () => {
  const manifest = JSON.parse(await readFile("deployment/template-version.json", "utf8"));
  assert.equal(manifest.version, "1.1.0");
  assert.equal(manifest.importance, "recommended");
  assert.ok(Array.isArray(manifest.releaseNotes));
  assert.ok(manifest.releaseNotes.length >= 3);
});

test("version endpoint compares the installed version with the canonical GitHub template", async () => {
  const route = await readFile("app/api/version/route.ts", "utf8");
  assert.match(route, /raw\.githubusercontent\.com\/q1433031046-ship-it\/student-portfolio-cloudflare\/main\/deployment\/template-version\.json/);
  assert.match(route, /updateAvailable/);
  assert.match(route, /compareVersions/);
  assert.match(route, /checkSucceeded/);
  assert.match(route, /releaseNotes/);
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
