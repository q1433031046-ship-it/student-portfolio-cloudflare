import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("version metadata publishes the authenticated v1.3.1-b upgrade contract", async () => {
  const [manifest, promptManifest, agentManifest, migration0007, migration0008] = await Promise.all([
    readFile("deployment/template-version.json", "utf8").then(JSON.parse),
    readFile("deployment/upgrade-prompt.json", "utf8").then(JSON.parse),
    readFile("deployment/agent-manifest.json", "utf8").then(JSON.parse),
    readFile("drizzle/0007_legacy_media_and_access_state.sql", "utf8"),
    readFile("drizzle/0008_static_site_publish.sql", "utf8"),
  ]);

  assert.equal(manifest.version, "1.3.1-b");
  assert.equal(manifest.releaseTag, "v1.3.1-b");
  assert.equal(manifest.importance, "important");
  assert.equal(manifest.upgradePromptManifest, "deployment/upgrade-prompt.json");
  assert.match(manifest.releaseNotes.join("\n"), /固定静态/u);
  assert.match(manifest.releaseNotes.join("\n"), /draft Deploy/u);
  assert.match(manifest.releaseNotes.join("\n"), /migration 0008/u);
  assert.match(manifest.releaseNotes.join("\n"), /ACCESS_FEATURE_PAUSED/u);
  assert.equal(manifest.portfolioDocumentSchemaVersion, 5);
  assert.equal(promptManifest.schemaVersion, 1);
  assert.equal(promptManifest.program, manifest.program);
  assert.equal(promptManifest.promptVersion, manifest.version);
  assert.equal(promptManifest.releaseTag, manifest.releaseTag);
  assert.ok(promptManifest.prompt.length >= 300);

  const promptSha256 = createHash("sha256").update(promptManifest.prompt, "utf8").digest("hex");
  assert.match(promptSha256, /^[a-f0-9]{64}$/u);
  assert.equal(promptManifest.promptSha256, promptSha256);
  assert.equal(manifest.upgradePromptSha256, promptSha256);
  assert.equal(agentManifest.releaseContract.version, manifest.version);
  assert.equal(agentManifest.releaseContract.releaseTag, manifest.releaseTag);
  assert.equal(agentManifest.releaseContract.upgradePromptSha256, promptSha256);

  assert.deepEqual(agentManifest.databaseMigrationPolicy.runtimeSafeBootstrapMigrations, [
    "0006_auth_v2.sql",
    "0007_legacy_media_and_access_state.sql",
    "0008_static_site_publish.sql",
  ]);
  assert.equal(agentManifest.databaseMigrationPolicy.runtimeBootstrapRoute, "/admin");
  assert.equal(
    agentManifest.databaseMigrationPolicy.migrationSha256["0007_legacy_media_and_access_state.sql"],
    createHash("sha256").update(migration0007.replaceAll("\r\n", "\n"), "utf8").digest("hex"),
  );
  assert.equal(agentManifest.databaseMigrationPolicy.migrationSha256["0008_static_site_publish.sql"], createHash("sha256").update(migration0008, "utf8").digest("hex"));
  assert.match(agentManifest.resourceFingerprint.automaticFields.join("\n"), /configuredWorkersDevEnabled/);
  assert.match(agentManifest.resourceFingerprint.remoteWorkersDevState, /manual/u);
  assert.equal(agentManifest.authentication.passwordFailureScope, "same-cloudflare-client-network-bucket");
  assert.equal(agentManifest.authentication.passwordNetworkBucket.storesRawAddress, false);
  assert.equal(agentManifest.authentication.passwordLockAffectsOtherNetworkBuckets, false);
  assert.equal(agentManifest.authentication.passwordLockAffectsRecoveryCodeFlow, false);
  assert.equal(agentManifest.authentication.recoveryFailureAffectsPasswordLock, false);
  assert.equal(agentManifest.existingInstallUpgradeEligibility.minimumKnownVersion, "1.1.0");
  assert.deepEqual(agentManifest.existingInstallUpgradeEligibility.prerequisites, [
    "DB.database_id",
    "MEDIA_KV.id",
    "matching live DB and MEDIA_KV bindings",
  ]);
  assert.equal(agentManifest.existingInstallUpgradeEligibility.r2OnlyV1_0, "unsupported-fail-closed-in-v1.3.1-b");
  assert.equal(agentManifest.existingInstallUpgradeEligibility.provisionMissingResources, false);
  assert.equal(agentManifest.existingInstallUpgradeEligibility.remoteMutationBeforeEligibility, false);
  assert.equal(agentManifest.newDeploymentProvisioning.templateContainsResourceIds, false);
  assert.equal(agentManifest.newDeploymentProvisioning.templateContainsDatabaseName, false);
  assert.equal(agentManifest.newDeploymentProvisioning.fixedDatabaseNameReuseAllowed, false);
  assert.deepEqual(agentManifest.newDeploymentProvisioning.declaredBindings, ["DB", "MEDIA_KV"]);
  assert.equal(agentManifest.newDeploymentProvisioning.verifyClonedConfigAgainstLiveWorker, true);
  assert.equal(agentManifest.newDeploymentProvisioning.guessOrReuseResourceIds, false);
  assert.equal(agentManifest.commands.cloudBuildFirstDeployment, "npm run deploy");
  assert.equal("firstDirectDeploy" in agentManifest.commands, false);
  assert.equal(agentManifest.effectiveWorkerName.overrideVariable, "WRANGLER_CI_OVERRIDE_NAME");
  assert.equal(agentManifest.effectiveWorkerName.useForAllRemoteOperations, true);
  assert.deepEqual(agentManifest.effectiveWorkerName.operations, [
    "status",
    "version inspection",
    "resource fingerprint",
    "final deploy",
  ]);
  assert.equal(agentManifest.sourceUpgradePolicy.dirtyWorktree, "fail-closed-until-owner-confirmed-recoverable-save");
  assert.equal(agentManifest.sourceUpgradePolicy.destructiveGitCommandsAllowed, false);
});

test("version endpoint reads future metadata from main but accepts prompts only from a tagged digest", async () => {
  const route = await readFile("app/api/version/route.ts", "utf8");

  assert.match(route, /raw\.githubusercontent\.com\/q1433031046-ship-it\/student-portfolio-cloudflare\/main\/deployment\/template-version\.json/);
  assert.doesNotMatch(route, /main\/deployment\/upgrade-prompt\.json/);
  assert.match(route, /releaseTag === `v\$\{remote\.version\}`/);
  assert.match(route, /upgradePromptSha256/);
  assert.match(route, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(route, /encodeURIComponent\(releaseTag\)/);
  assert.match(route, /remotePrompt\.promptSha256 !== expectedPromptSha256/);
  assert.match(route, /remote\.program === localVersion\.program/);
  assert.match(route, /remotePrompt\.program !== localVersion\.program/);
  assert.match(route, /remotePrompt\.releaseTag !== releaseTag/);
  assert.match(route, /await sha256Hex\(remotePrompt\.prompt\)/);
  assert.match(route, /RELEASE_DATE_PATTERN\.test\(remote\.releasedAt\)/);
  assert.match(route, /VALID_IMPORTANCE\.has\(remote\.importance\)/);
  assert.match(route, /hasValidReleaseNotes\(remote\.releaseNotes\)/);
  assert.match(route, /MAXIMUM_RELEASE_NOTE_LENGTH/);
  assert.doesNotMatch(route, /remote\.releasedAt \?\? latestReleasedAt/u);
  assert.doesNotMatch(route, /remote\.importance \?\? importance/u);
  assert.doesNotMatch(route, /Array\.isArray\(remote\.releaseNotes\) \?/u);
  assert.match(route, /latestUpgradePrompt = localUpgradePrompt\.prompt\.trim\(\)/);
  assert.match(route, /upgradePromptCheckSucceeded/);
  assert.match(route, /latestUpgradePromptManifestUrl/);
  assert.match(route, /updateAvailable/);
  assert.match(route, /compareSemanticVersion/);
  assert.match(route, /shared\/semantic-version\.mjs/u);
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

  for (const source of [upgrade, guide]) {
    assert.match(source, /getUpgradePrompt/);
    assert.doesNotMatch(source, /\bUPGRADE_PROMPT\b/);
    assert.doesNotMatch(source, /PROGRAM_VERSION = "1\.0\.0"/);
    assert.doesNotMatch(source, /UPGRADE-GUIDE\.md/);
  }
  assert.doesNotMatch(enhancements, /getUpgradePrompt|ensureUpgradeCenter|data-program-upgrade-center/u);

  assert.match(content, /deployment\/upgrade-prompt\.json/);
  assert.match(content, /UPGRADE_PROMPT_SYNC_EVENT/);
  assert.match(content, /compareSemanticVersion\(promptVersion, activeUpgradePromptVersion\) < 0/);
  assert.match(guide, /addEventListener\(UPGRADE_PROMPT_SYNC_EVENT/);
  assert.match(guide, /<pre>\{upgradePrompt\}<\/pre>/);

  for (const phrase of [
    "目标版本固定为 v1.3.1-b",
    "发布标签 v1.3.1-b",
    "SHA-256",
    "npm run cloudflare:fingerprint -- --output",
    "npm run cloudflare:deploy",
    ".wrangler/upgrade-before-fingerprint.json",
    ".wrangler/upgrade-predeploy-fingerprint.json",
    ".wrangler/upgrade-after-fingerprint.json",
    "configuredWorkersDevEnabled",
    "步骤 1/8",
    "步骤 8/8",
    "已有 BUCKET",
    "R2",
    "90 MiB",
    "R2 对象 ETag",
    "final-verifying",
    "最终 KV 复验",
    "私有文档归档",
    "服务端返回公开文档前必须剔除该引用",
    "不得要求开通付费套餐",
    "不得把模板仓库中的任何资源 ID 覆盖",
    "10 个独立 Cookie 会话",
    "无害的只读检查",
    "从中断步骤继续",
    "隔离工作树",
    "脚本会把 Wrangler 的运行目录固定为已验证标签工作树根目录",
    "纯 v1.0 R2-only",
    "本版本未支持",
    "不得创建、复用或认领新的 MEDIA_KV",
    "记录原分支和 commit",
    "禁止 force checkout、reset --hard",
    "WRANGLER_CI_OVERRIDE_NAME",
    "有效 Worker 名",
    "原站.*wrangler.jsonc",
    "npm run deploy.*首次部署",
    "0600",
    "只捕获一次",
    "跨失败续跑",
    "当前最新系统恢复码",
    "旧管理员会话",
    "同一 Cloudflare 客户网络",
    "错误恢复码不会触发密码登录锁定",
    "调整裁切",
    "0008_static_site_publish.sql",
    "保存草稿不得触发 Netlify",
    "重试原发布任务",
    "旧限制访问卡片必须保持不可写",
    "固定 URL、二维码和 Worker 根路径跳转",
    "移除成稿视频",
    "仅能在生产站人工验收",
  ]) {
    assert.match(promptManifest.prompt, new RegExp(phrase));
    assert.match(readme, new RegExp(phrase));
  }

  assert.ok(promptManifest.prompt.includes("{hostname}-v1.3.1-b-系统恢复码-{YYYYMMDDTHHMMSSZ}.txt"));
  assert.match(promptManifest.prompt, /唯一 draft Deploy/u);
  assert.match(promptManifest.prompt, /原稳定版本 1\.3\.1 仍处于搁置状态/u);
  assert.doesNotMatch(promptManifest.prompt, /<升级前指纹文件>|<upgrade-before-fingerprint-file>/u);
  assert.match(promptManifest.prompt, /远端 workers\.dev 开关.*人工基线/su);
  assert.match(promptManifest.prompt, /upgrade-predeploy-fingerprint\.json.*upgrade-before-fingerprint\.json/su);
  assert.match(promptManifest.prompt, /migrations list 已成功并可靠列出全部 pending/u);
  assert.match(promptManifest.prompt, /list 自身失败或无法证明完整 pending/u);
  assert.match(promptManifest.prompt, /全部块最终复验.*CAS/su);

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
