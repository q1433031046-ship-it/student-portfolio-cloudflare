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
];

test("no-negative-echo audit keeps only the final tutorial flow", async () => {
  const [readme, guide, stepTwo, audit, adminPage] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("app/admin/admin-guide-center.tsx", "utf8"),
    readFile("app/admin/admin-guide-step-two.tsx", "utf8"),
    readFile("app/admin/admin-guide-ui-audit.tsx", "utf8"),
    readFile("app/admin/page.tsx", "utf8"),
  ]);

  for (const path of obsoleteStudentFiles) assert.equal(existsSync(path), false, `${path} should remain removed`);

  for (const phrase of [
    "GitHub 本指南",
    "先打开 GPT",
    "Cloudflare 一键部署",
    "INITIAL_ADMIN_CODE",
    "图片与视频建议尺寸",
    "程序升级",
  ]) assert.match(readme, new RegExp(phrase));

  assert.match(readme, /默认公开；也可以在后台启用二维码限制访问/);
  assert.doesNotMatch(readme, /同版教程|同版的操作说明|\/guide/);

  assert.match(guide, /使用教程/);
  assert.match(guide, /默认公开，也可以在后台启用二维码限制访问/);
  assert.doesNotMatch(guide, /同版指南|模板不再提供公开/);

  assert.match(stepTwo, /在 ChatGPT 里具体怎么点/);
  assert.match(adminPage, /AdminGuideUiAudit/);
  assert.match(audit, /GitHub 完整指南/);
  assert.match(audit, /data-secondary-deploy-link/);
});

test("tutorial overlay remains usable on mobile and by keyboard", async () => {
  const audit = await readFile("app/admin/admin-guide-ui-audit.tsx", "utf8");

  assert.match(audit, /data-admin-guide-button/);
  assert.match(audit, /data-admin-upgrade-shortcut/);
  assert.match(audit, /@media\(max-width:720px\)/);
  assert.match(audit, /content:"教程"/);
  assert.match(audit, /content:"升级"/);
  assert.match(audit, /aria-labelledby/);
  assert.match(audit, /adminMain\.inert = true/);
  assert.match(audit, /event\.key !== "Tab"/);
  assert.match(audit, /opener\?\.focus/);
});
