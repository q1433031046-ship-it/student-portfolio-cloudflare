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
  assert.equal("firstDirectDeploy" in manifest.commands, false);
  assert.equal(manifest.newDeploymentProvisioning.templateContainsDatabaseName, false);
  assert.equal(manifest.newDeploymentProvisioning.fixedDatabaseNameReuseAllowed, false);
  assert.equal(manifest.effectiveWorkerName.overrideVariable, "WRANGLER_CI_OVERRIDE_NAME");
  assert.equal(manifest.effectiveWorkerName.useForAllRemoteOperations, true);
  assert.equal(manifest.workersBuildsUpgradeBridge.contract, "deployment/workers-builds-upgrade-bridge.json");
  assert.equal(manifest.workersBuildsUpgradeBridge.productSourceCommit, "4658bc834d6ea21aa94ce0db0d9c99e82b856235");
  assert.equal(manifest.workersBuildsUpgradeBridge.productSourceTree, "2d9bc4a77dc96bbc75aa85ed5bdca13c9823ea54");
  assert.equal(manifest.workersBuildsUpgradeBridge.existingWorkerOnly, true);
  assert.equal(manifest.workersBuildsUpgradeBridge.provisionResources, false);
  assert.equal(manifest.workersBuildsUpgradeBridge.permissionFallback, false);
  assert.equal(manifest.workersBuildsUpgradeBridge.removeSourceVarsBeforeDeploy, true);
  assert.equal(manifest.commands.cloudBuildExistingWorker, "npm run deploy");
  assert.equal(manifest.commands.workersBuildsUpgrade, "npm run deploy");
  assert.match(manifest.databaseMigrationPolicy.workersBuildsPermissionFallback, /forbidden/u);
  assert.equal(manifest.responsiveUI.minimumViewportWidth, 320);
  assert.equal(manifest.responsiveUI.minimumTouchTargetPixels, 44);
  assert.equal(manifest.responsiveUI.mobileInputFontPixels, 16);
  assert.equal(manifest.responsiveUI.renderOnlyMobileLayout, true);
  assert.equal(manifest.responsiveUI.mobileSpecificStoredCoordinates, false);
  assert.equal(manifest.responsiveUI.mobileSpecificStoredCrop, false);
  assert.equal(manifest.responsiveUI.mobileSpecificDocumentFields, false);
  assert.ok(manifest.liveTests.length >= 10);
});

test("keeps package, lockfile and template release versions synchronized", async () => {
  const [packageJson, packageLock, templateVersion] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("package-lock.json", "utf8").then(JSON.parse),
    readFile("deployment/template-version.json", "utf8").then(JSON.parse),
  ]);

  assert.equal(packageJson.version, "1.3.0");
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.equal(templateVersion.version, packageJson.version);
});

test("publishes the current chunked media and playback API contract", async () => {
  const apiIndex = await readFile("app/api/route.ts", "utf8");

  assert.match(apiIndex, /申请 1 小时播放地址/u);
  assert.match(apiIndex, /创建 4 MiB 分片上传任务/u);
  assert.match(apiIndex, /新视频必须是 MP4 且不超过 50 MiB/u);
  assert.match(apiIndex, /\?uploadId=\{uploadId\}&chunk=\{index\}/u);
  assert.match(apiIndex, /\?uploadId=\{uploadId\}&complete=1/u);
  assert.doesNotMatch(apiIndex, /15 分钟播放地址|流式上传图片或视频|视频最大 90 MiB/u);
});

test("routes Workers Builds through the pinned existing-site upgrade bridge", async () => {
  const [packageJson, bridge] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("deployment/workers-builds-upgrade-bridge.json", "utf8").then(JSON.parse),
  ]);
  const [deployScript, deployOrchestrator] = await Promise.all([
    readFile("scripts/deploy-cloudflare.sh", "utf8"),
    readFile("scripts/cloudflare-deploy.mjs", "utf8"),
  ]);

  assert.equal(bridge.schemaVersion, 1);
  assert.deepEqual(bridge.productRelease, {
    version: "1.3.0",
    tag: "v1.3.0",
    commit: "4658bc834d6ea21aa94ce0db0d9c99e82b856235",
    tree: "2d9bc4a77dc96bbc75aa85ed5bdca13c9823ea54",
  });
  assert.equal(bridge.productPayload.fileCount, 139);
  assert.equal(bridge.productPayload.sha256, "cb03afa02e202e4df39d23032e1d7997b4cce719c61c4244e30f5181ce887021");
  assert.deepEqual(bridge.packageRuntimeProjection.scriptFields, ["build"]);
  assert.equal(bridge.packageRuntimeProjection.sha256, "e9fb70ba1e92044f5f4f4b32d75f17d05e082e53a90f6317f3eeec26916b7ac7");
  assert.deepEqual(bridge.allowedPendingMigrations, [
    {
      name: "0006_auth_v2.sql",
      sha256: "edee5672e5b8281ec495cf5f9d34db7df4311f51dfcb6136c9bdfe127d815ad4",
    },
    {
      name: "0007_legacy_media_and_access_state.sql",
      sha256: "c29e080e93d8fa71378c43d7afdbcef97a591e434dca092af84741428acd9a1e",
    },
  ]);
  assert.deepEqual(bridge.eligibleBindings, {
    d1: "DB",
    kv: "MEDIA_KV",
    fixedIdsRequired: true,
  });
  assert.deepEqual(bridge.preserveRemote, {
    vars: true,
    secrets: true,
    removeSourceVarsBeforeDeploy: true,
  });
  assert.match(packageJson.scripts.deploy, /deploy-cloudflare\.sh/);
  assert.match(packageJson.scripts.deploy, /npm run build/);
  assert.match(packageJson.scripts.deploy, /--mode workers-builds-upgrade/u);
  assert.match(packageJson.scripts.deploy, /--bridge-manifest deployment\/workers-builds-upgrade-bridge\.json/u);
  assert.match(packageJson.scripts["cloudflare:deploy:new"], /--mode new/u);
  assert.match(packageJson.scripts["cloudflare:deploy"], /npm run build/);
  assert.match(packageJson.scripts["cloudflare:deploy"], /deploy-cloudflare\.sh/);
  assert.match(packageJson.scripts["cloudflare:deploy"], /--fingerprint \.wrangler\/upgrade-before-fingerprint\.json/);
  assert.match(packageJson.scripts["cloudflare:fingerprint"], /--output \.wrangler\/upgrade-before-fingerprint\.json/);
  assert.match(deployScript, /cloudflare-deploy\.mjs/);
  assert.match(deployOrchestrator, /auto.*new.*upgrade|new.*upgrade.*auto/u);
  assert.equal((packageJson.scripts.deploy.match(/npm run build/gu) ?? []).length, 1);
  assert.equal((packageJson.scripts["cloudflare:deploy"].match(/npm run build/gu) ?? []).length, 1);
  assert.equal("cloudflare:setup" in packageJson.scripts, false);
  assert.equal(existsSync("scripts/setup-cloudflare.sh"), false);
});

test("documents the GitHub to Workers Builds bridge without changing the immutable v1.3.0 prompt", async () => {
  const [readme, promptManifest, templateVersion] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("deployment/upgrade-prompt.json", "utf8").then(JSON.parse),
    readFile("deployment/template-version.json", "utf8").then(JSON.parse),
  ]);

  assert.match(readme, /GitHub → Cloudflare Workers Builds Upgrade Bridge/u);
  assert.match(readme, /\[BRIDGE\]\[CHECK\]/u);
  assert.match(readme, /\[BRIDGE\]\[BLOCKED\]/u);
  assert.match(readme, /\[BRIDGE\]\[FAILED\]/u);
  assert.match(readme, /\[BRIDGE\]\[SUCCESS\]/u);
  assert.match(readme, /Migration 失败[\s\S]{0,100}不会部署/u);
  assert.match(readme, /源码 `vars`[\s\S]{0,100}不会覆盖/u);
  assert.equal(promptManifest.promptVersion, "1.3.0");
  assert.equal(promptManifest.releaseTag, "v1.3.0");
  assert.equal(templateVersion.upgradePromptSha256, "c72b072aa4c9a78121297078e572e7a1536fd5a1b1498f8cb103a825979b4149");
});

test("runs the complete production-safe gate for every main pull request", async () => {
  const workflow = await readFile(".github/workflows/verify.yml", "utf8");

  assert.match(workflow, /pull_request:\s*\n\s*branches: \[main\]/u);
  assert.doesNotMatch(workflow, /^\s+paths:/mu);
  for (const command of [
    "npm ci",
    "npm audit --omit=dev --audit-level=high",
    "bash -n scripts/*.sh",
    "node --check scripts/*.mjs",
    "npm run db:generate",
    "git status --porcelain --untracked-files=all -- drizzle",
    "npm test",
    "npx --no-install wrangler deploy --dry-run --keep-vars --config wrangler.jsonc",
    "git diff --exit-code -- wrangler.jsonc",
    "npm run lint",
    "./node_modules/.bin/tsc --noEmit",
  ]) {
    assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  }
});

test("tags only an explicitly verified release candidate from the protected main workflow", async () => {
  const workflow = await readFile(".github/workflows/release-verify.yml", "utf8");
  const [verificationJobs, tagJob = ""] = workflow.split(/\n  tag-release:\n/u);

  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/u);
  assert.match(workflow, /workflow_dispatch:\s*\n\s*inputs:/u);
  for (const input of ["candidate_sha", "base_main_sha", "confirm_version"]) {
    assert.match(
      workflow,
      new RegExp(`${input}:\\s*\\n\\s*required: true\\s*\\n\\s*type: string`, "u"),
    );
  }
  assert.doesNotMatch(workflow, /^\s+paths:/mu);
  assert.match(verificationJobs, /release-verify:/u);
  assert.match(verificationJobs, /permissions:\s*\n\s*contents: read/u);
  assert.match(verificationJobs, /ref:.*inputs\.candidate_sha.*github\.sha/u);
  assert.match(verificationJobs, /persist-credentials: false/u);
  assert.match(verificationJobs, /refs\/heads\/release\/v/u);
  assert.match(verificationJobs, /merge-base --is-ancestor/u);
  for (const command of [
    "npm ci",
    "npm audit --omit=dev --audit-level=high",
    "bash -n scripts/*.sh",
    "node --check scripts/*.mjs",
    "npm run db:generate",
    "git status --porcelain --untracked-files=all -- drizzle",
    "npm test",
    "npx --no-install wrangler deploy --dry-run --keep-vars --config wrangler.jsonc",
    "git diff --exit-code -- wrangler.jsonc",
    "npm run lint",
    "./node_modules/.bin/tsc --noEmit",
  ]) {
    assert.match(verificationJobs, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  }

  for (const browserGate of [
    "npm run test:e2e",
    "npm run test:e2e:codec:chrome",
    "npm run test:e2e:codec:webkit",
  ]) {
    assert.match(workflow, new RegExp(browserGate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  }
  assert.match(workflow, /playwright install --with-deps chromium webkit chrome/u);
  assert.match(workflow, /runs-on: macos-latest/u);

  assert.match(tagJob, /needs:\s*\[release-verify, macos-webkit\]/u);
  assert.match(tagJob, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(tagJob, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(tagJob, /permissions:\s*\n\s*contents: write/u);
  assert.match(tagJob, /persist-credentials: true/u);
  assert.match(tagJob, /INPUT_CANDIDATE_SHA/u);
  assert.match(tagJob, /INPUT_BASE_MAIN_SHA/u);
  assert.match(tagJob, /INPUT_CONFIRM_VERSION/u);
  assert.match(tagJob, /\["show", `\$\{candidate\}:\$\{path\}`\]/u);
  assert.match(tagJob, /node <<'NODE'/u);
  assert.match(tagJob, /createHash\("sha256"\)/u);
  assert.match(tagJob, /promptSha256 === promptDigest/u);
  assert.match(tagJob, /git tag -a "\$release_tag" "\$candidate_sha"/u);
  assert.match(tagJob, /git ls-remote origin refs\/heads\/main/u);
  assert.match(tagJob, /refs\/tags\/\$release_tag\^\{\}/u);
  assert.match(tagJob, /git tag -a/u);
  assert.doesNotMatch(tagJob, /npm (?:ci|install|run|test)/u);
  assert.doesNotMatch(workflow, /expectedVersion/u);
  assert.doesNotMatch(tagJob, /needs\.[^.]+\.outputs/u);
  assert.doesNotMatch(tagJob, /--force|-f\s+["']?\$RELEASE_TAG/u);
});

test("exposes a public Deploy to Cloudflare template with storage bindings", async () => {
  const wranglerSource = await readFile("wrangler.jsonc", "utf8");
  const wrangler = JSON.parse(wranglerSource);
  const readme = await readFile("README.md", "utf8");
  assert.equal(wrangler.main, "./cloudflare/worker-entry.js");
  assert.equal("no_bundle" in wrangler, false);
  assert.equal(wrangler.d1_databases.length, 1);
  assert.equal(wrangler.d1_databases[0].binding, "DB");
  assert.equal(wrangler.d1_databases[0].migrations_dir, "./drizzle");
  assert.equal("database_name" in wrangler.d1_databases[0], false);
  assert.equal("database_id" in wrangler.d1_databases[0], false);
  assert.equal(wrangler.kv_namespaces.length, 1);
  assert.equal(wrangler.kv_namespaces[0].binding, "MEDIA_KV");
  assert.equal("id" in wrangler.kv_namespaces[0], false);
  assert.doesNotMatch(wranglerSource, /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[0-9a-f]{32}\b/iu);
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
  assert.match(adminGuide, /在 GitHub 打开完整指南/);
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
  assert.match(instructions, /Workers Builds existing-site upgrade bridge/u);
  assert.match(instructions, /apply or re-list failure stops before Worker deployment/u);
  assert.match(instructions, /temporary config that contains no source `vars`/u);
  assert.match(instructions, /\[BRIDGE\]\[SUCCESS\]/u);
});
