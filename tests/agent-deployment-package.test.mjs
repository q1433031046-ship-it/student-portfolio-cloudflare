import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships a machine-readable agent deployment contract", async () => {
  const manifest = JSON.parse(
    await readFile("deployment/agent-manifest.json", "utf8"),
  );
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.project.target, "cloudflare-workers");
  assert.equal(manifest.project.defaultHostname, "workers.dev");
  assert.equal(manifest.project.initialContent, "empty");
  assert.deepEqual(manifest.authentication.protectedPaths, [
    "/admin*",
    "/api/admin*",
    "/preview*",
  ]);
  assert.equal(manifest.authentication.loginMethod, "password");
  assert.equal(manifest.authentication.initializationMethod, "one-time-deployment-code");
  assert.equal(manifest.authentication.recoveryMethod, "single-use-rotating-system-code");
  assert.equal(manifest.media.videoMaxBytes, 50 * 1024 * 1024);
  assert.equal(manifest.media.storageLimitBytes, 800 * 1024 * 1024);
  assert.equal(manifest.authorizationFlow.preflight, "harmless-read-only-check");
  assert.equal(manifest.authorizationFlow.reuseValidConnections, true);
  assert.equal(manifest.authorizationFlow.maximumAutomaticAuthorizationAttempts, 1);
  assert.equal(manifest.authorizationFlow.resumeInterruptedStep, true);
  assert.equal(manifest.authorizationFlow.restartDeploymentAfterAuthorization, false);
  assert.equal(manifest.access.visitorSessionHours, 24);
  assert.equal(manifest.access.slidingSession, false);
  assert.equal(manifest.access.intermediateRoute, "/access");
  assert.equal(manifest.access.redeemRoute, "/access/redeem");
  assert.equal(manifest.authentication.sessionHours, 12);
  assert.ok(manifest.liveTests.length >= 10);
});

test("exposes a public Deploy to Cloudflare template with storage bindings", async () => {
  const wrangler = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
  const readme = await readFile("README.md", "utf8");
  assert.equal(wrangler.main, "./cloudflare/worker-entry.js");
  assert.equal("no_bundle" in wrangler, false);
  assert.equal(wrangler.d1_databases[0].binding, "DB");
  assert.equal(wrangler.kv_namespaces[0].binding, "MEDIA_KV");
  assert.match(readme, /deploy\.workers\.cloudflare\.com\/\?url=https:\/\/github\.com\//);
  assert.match(readme, /student-portfolio-cloudflare/);
});

test("keeps one public human guide and the same guidance behind admin login", async () => {
  const [readme, adminGuide, adminUpgrade, adminPage] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("app/admin/admin-guide-center.tsx", "utf8"),
    readFile("app/admin/admin-upgrade-center.tsx", "utf8"),
    readFile("app/admin/page.tsx", "utf8"),
  ]);

  for (const phrase of [
    "先打开 GPT",
    "Cloudflare 一键部署",
    "INITIAL_ADMIN_CODE",
    "图片与视频建议尺寸",
    "程序升级",
  ]) {
    assert.match(readme, new RegExp(phrase));
    assert.match(adminGuide, new RegExp(phrase));
  }

  assert.match(readme, /Set up your application/);
  assert.match(readme, /一个 GPT 帮不同学生部署/);
  assert.match(readme, /同一个托管账号部署多个网站/);
  assert.match(readme, /安全边界/);
  assert.match(adminGuide, /一个 GPT 帮不同学生/);
  assert.match(adminGuide, /同一托管账号部署多个网站/);
  assert.match(adminGuide, /data-admin-tools/);
  assert.match(adminGuide, /portfolio:open-upgrade/);
  assert.match(adminUpgrade, /addEventListener\(OPEN_UPGRADE_EVENT/);
  assert.match(adminUpgrade, /program-upgrade-center/);
  assert.match(adminPage, /AdminGuideCenter/);
  assert.match(adminPage, /AdminUpgradeCenter/);
  assert.match(adminGuide, /使用教程/);
  assert.match(adminGuide, /在 GitHub 打开同版指南/);
  assert.equal(existsSync("app/admin/admin-guide-step-two.tsx"), false);
  assert.equal(existsSync("app/guide/page.tsx"), false);
  assert.equal(existsSync("START-HERE.md"), false);
  assert.equal(existsSync("FINAL-DELIVERY.md"), false);
  assert.equal(existsSync("UPGRADE-GUIDE.md"), false);
  assert.equal(existsSync("docs/guides/student-cloudflare-setup.md"), false);
  assert.equal(existsSync("deployment/DEPLOY-PROMPT.txt"), false);
  assert.equal(existsSync("deployment/UPGRADE-PROMPT.txt"), false);
});

test("tells deployment agents to use account authorization without collecting passwords", async () => {
  const instructions = await readFile("AGENTS.md", "utf8");
  assert.match(instructions, /official browser login/i);
  assert.match(instructions, /Do not ask the owner to type shell commands/i);
  assert.match(instructions, /Never request a Cloudflare password/i);
  assert.match(instructions, /recovery code/i);
  assert.match(instructions, /harmless read-only action/i);
  assert.match(instructions, /Reuse every connection that succeeds/i);
  assert.match(instructions, /resume the exact interrupted step/i);
  assert.match(instructions, /resume/i);
  assert.match(instructions, /Do not expose a public `\/guide` route/i);
});
