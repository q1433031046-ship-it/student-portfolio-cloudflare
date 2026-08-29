import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const obsoleteStudentFiles = [
  "START-HERE.md",
  "FINAL-DELIVERY.md",
  "UPGRADE-GUIDE.md",
  "docs/guides/student-cloudflare-setup.md",
  "deployment/DEPLOY-PROMPT.txt",
  "deployment/UPGRADE-PROMPT.txt",
  "app/guide/page.tsx",
  "app/admin/admin-guide-step-two.tsx",
];

test("no-negative-echo audit keeps one final tutorial flow", async () => {
  const [readme, guide, audit, upgrade, adminPage] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("app/admin/admin-guide-center.tsx", "utf8"),
    readFile("app/admin/admin-guide-ui-audit.tsx", "utf8"),
    readFile("app/admin/admin-upgrade-center.tsx", "utf8"),
    readFile("app/admin/page.tsx", "utf8"),
  ]);

  for (const path of obsoleteStudentFiles) assert.equal(existsSync(path), false, `${path} should remain removed`);

  for (const phrase of [
    "先打开 GPT",
    "Cloudflare 一键部署",
    "INITIAL_ADMIN_CODE",
    "图片与视频建议尺寸",
    "程序升级",
  ]) {
    assert.match(readme, new RegExp(phrase));
    assert.match(guide, new RegExp(phrase));
  }

  assert.match(readme, /安全边界/);
  assert.match(readme, /完整复制部署引导语/);
  assert.match(readme, /不需要启用 R2/);
  assert.match(readme, /桌面 16:9/);
  assert.match(readme, /手机 4:5/);
  assert.match(readme, /媒体已上传，等待草稿保存/);
  assert.match(guide, /在 ChatGPT 里具体怎么点/);
  assert.match(guide, /不需要启用 R2/);
  assert.match(guide, /桌面 16:9/);
  assert.match(guide, /手机 4:5/);
  assert.match(guide, /媒体已上传，等待草稿保存/);
  assert.match(guide, /data-admin-tools/);
  assert.match(guide, /portfolio:open-upgrade/);
  assert.match(upgrade, /addEventListener\(OPEN_UPGRADE_EVENT/);
  assert.match(upgrade, /program-upgrade-center/);
  assert.match(adminPage, /AdminGuideUiAudit/);
  assert.doesNotMatch(adminPage, /AdminGuideStepTwo/);
  assert.match(audit, /GitHub 完整指南/);
});

test("tutorial overlay remains usable on mobile and by keyboard", async () => {
  const audit = await readFile("app/admin/admin-guide-ui-audit.tsx", "utf8");

  assert.match(audit, /data-admin-tools/);
  assert.match(audit, /data-kind="guide"/);
  assert.match(audit, /data-kind="upgrade"/);
  assert.match(audit, /@media\(max-width:720px\)/);
  assert.match(audit, /content:"教程"/);
  assert.match(audit, /content:"升级"/);
  assert.match(audit, /aria-labelledby/);
  assert.match(audit, /adminMain\.inert = true/);
  assert.match(audit, /event\.key !== "Tab"/);
  assert.match(audit, /opener\?\.focus/);
});
