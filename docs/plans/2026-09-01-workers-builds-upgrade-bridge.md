# Workers Builds Upgrade Bridge Implementation Plan

> **For implementation:** Execute this plan task-by-task with the workflow available in the current environment. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed GitHub-triggered Cloudflare Workers Builds bridge that migrates an eligible existing v1.3.0 site before deploying the unchanged v1.3.0 runtime to the same Worker.

**Architecture:** Extend the existing deployment controller with a dedicated `workers-builds-upgrade` mode rather than creating a second remote-state implementation. A separate machine-readable bridge contract pins the v1.3.0 product source and the only allowed forward migrations; the controller captures a live in-memory fingerprint, applies and re-lists migrations, deploys through a temporary vars-free Wrangler config, and verifies the fingerprint again before emitting success.

**Tech Stack:** Node.js 22 ESM, Wrangler 4.127.1, Cloudflare Workers Builds, D1 migrations, Node test runner, Bash, JSON/JSONC.

**Spec:** `docs/specs/2026-09-01-workers-builds-upgrade-bridge.md`

## Global Constraints

- Product version is exactly `1.3.0`, immutable tag is `v1.3.0`, product commit is `4658bc834d6ea21aa94ce0db0d9c99e82b856235`, and product tree is `2d9bc4a77dc96bbc75aa85ed5bdca13c9823ea54`.
- Do not modify v1.3.0 application/runtime/schema/migration payloads or the immutable tag.
- Operate only on branch `emergency/v1.3.0-workers-builds-upgrade-bridge` in its isolated worktree; do not touch the 3A governance Candidate or `governance-state`.
- Do not merge `main`, publish a release, create or adopt a Worker/D1/KV/R2 resource, or deploy any production site while preparing the Candidate.
- Existing-site eligibility requires one fixed `DB.database_id`, one fixed `MEDIA_KV.id`, the same live bindings, and an existing Worker proven by Cloudflare Workers Builds' validated `WRANGLER_CI_OVERRIDE_NAME`.
- Apply only the missing ordered suffix of `0006_auth_v2.sql` and `0007_legacy_media_and_access_state.sql`; migration list/apply/re-list uncertainty or failure blocks deployment.
- Preserve the same Worker, workers.dev address, D1, MEDIA_KV, optional R2, Secrets, remote vars, and all data. Source configuration must not overwrite remote vars.
- Never request or persist a Cloudflare token, cookie, administrator password, initial administrator code, or recovery code.
- Emit explicit success, blocked, and failed outcomes; success requires post-deploy identity verification.

---

## File Structure

- Create `deployment/workers-builds-upgrade-bridge.json`: immutable bridge contract for release identity, product payload digest, migration allowlist/digests, and preservation policy.
- Modify `scripts/cloudflare-deploy.mjs`: add the `workers-builds-upgrade` state machine, strict migration re-list, temporary vars-free deploy config, post-deploy fingerprint verification, and structured result logging.
- Modify `scripts/deploy-cloudflare.sh`: retain the single Node entry point and document the bridge mode in shell help coverage.
- Modify `package.json`: make `npm run deploy` build first and then invoke the strict bridge; retain the old first-install command under an explicit non-default script.
- Modify `.gitignore`: ignore process-unique temporary bridge configs if a killed process prevents cleanup.
- Modify `deployment/agent-manifest.json`: record the bridge entry, no-fallback migration rule, source pin, and remote-vars preservation rule without changing release version/tag.
- Modify `AGENTS.md`: separate the Workers Builds bridge from the retained manual fingerprint workflow and pin the current release contract to v1.3.0.
- Modify `README.md`: document the GitHub-only trigger boundary and truthful success/block/failure interpretation.
- Create `tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`: isolated fake-Wrangler integration harness and all bridge-specific state-machine tests.
- Modify `tests/agent-deployment-package.test.mjs`: assert canonical packaging, source pin, and command wiring.
- Modify `tests/update-notifier.test.mjs`: keep the immutable prompt digest while asserting the new first-deploy/bridge command split.
- Create `docs/internal/2026-09-01-workers-builds-upgrade-bridge-compatibility.md`: redacted, non-destructive evidence from the real `0000`–`0005` legacy source structure.

### Task 1: Freeze the bridge contract and command wiring

**Files:**
- Create: `deployment/workers-builds-upgrade-bridge.json`
- Modify: `package.json:7-25`
- Modify: `.gitignore:30-45`
- Test: `tests/agent-deployment-package.test.mjs`

**Interfaces:**
- Consumes: `deployment/agent-manifest.json.releaseContract`, `drizzle/meta/_journal.json`, and the fixed release identity from the spec.
- Produces: bridge manifest fields `productRelease`, `productPayload`, `eligibleBindings`, `allowedPendingMigrations`, `preserveRemote`, and package command `npm run deploy`.

- [ ] **Step 1: Write failing packaging tests**

```js
assert.equal(bridge.productRelease.commit, "4658bc834d6ea21aa94ce0db0d9c99e82b856235");
assert.equal(bridge.productRelease.tree, "2d9bc4a77dc96bbc75aa85ed5bdca13c9823ea54");
assert.deepEqual(bridge.allowedPendingMigrations.map(({ name }) => name), [
  "0006_auth_v2.sql",
  "0007_legacy_media_and_access_state.sql",
]);
assert.match(packageJson.scripts.deploy, /npm run build/);
assert.match(packageJson.scripts.deploy, /--mode workers-builds-upgrade/);
```

- [ ] **Step 2: Run the focused test and verify the missing manifest/command fails**

Run: `node --test tests/agent-deployment-package.test.mjs`

Expected: FAIL because `deployment/workers-builds-upgrade-bridge.json` and `workers-builds-upgrade` wiring do not exist.

- [ ] **Step 3: Add the exact contract and command wiring**

```json
{
  "schemaVersion": 1,
  "productRelease": {
    "version": "1.3.0",
    "tag": "v1.3.0",
    "commit": "4658bc834d6ea21aa94ce0db0d9c99e82b856235",
    "tree": "2d9bc4a77dc96bbc75aa85ed5bdca13c9823ea54"
  },
  "productPayload": {
    "algorithm": "sha256-path-nul-file-sha256-newline-v1",
    "includePaths": [
      "app", "build", "cloudflare", "cloudflare-demo", "db", "drizzle", "public", "worker",
      "next.config.ts", "postcss.config.mjs", "tsconfig.json", "vite.config.ts",
      "worker-configuration.d.ts", "package-lock.json", "scripts/build-verified.sh", "scripts/sites-env.sh"
    ],
    "fileCount": 139,
    "sha256": "cb03afa02e202e4df39d23032e1d7997b4cce719c61c4244e30f5181ce887021"
  },
  "packageRuntimeProjection": {
    "algorithm": "canonical-json-sha256-v1",
    "fields": ["name", "version", "private", "engines", "dependencies", "devDependencies", "type"],
    "scriptFields": ["build"],
    "sha256": "e9fb70ba1e92044f5f4f4b32d75f17d05e082e53a90f6317f3eeec26916b7ac7"
  },
  "eligibleBindings": { "d1": "DB", "kv": "MEDIA_KV", "fixedIdsRequired": true },
  "allowedPendingMigrations": [
    { "name": "0006_auth_v2.sql", "sha256": "edee5672e5b8281ec495cf5f9d34db7df4311f51dfcb6136c9bdfe127d815ad4" },
    { "name": "0007_legacy_media_and_access_state.sql", "sha256": "c29e080e93d8fa71378c43d7afdbcef97a591e434dca092af84741428acd9a1e" }
  ],
  "preserveRemote": { "vars": true, "secrets": true, "removeSourceVarsBeforeDeploy": true }
}
```

Set `deploy` to `npm run build && bash scripts/deploy-cloudflare.sh --mode workers-builds-upgrade --bridge-manifest deployment/workers-builds-upgrade-bridge.json`, retain the old new-site path as `cloudflare:deploy:new`, and ignore `/.wrangler-upgrade-bridge-*.json`.

- [ ] **Step 4: Run the focused packaging test**

Run: `node --test tests/agent-deployment-package.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the contract task**

```bash
git add .gitignore package.json deployment/workers-builds-upgrade-bridge.json tests/agent-deployment-package.test.mjs
git commit -m "feat: pin the Workers Builds upgrade bridge contract"
```

### Task 2: Add strict Workers Builds eligibility and source verification

**Files:**
- Modify: `scripts/cloudflare-deploy.mjs:10-120,183-275,746-799`
- Test: `tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`

**Interfaces:**
- Consumes: `--mode workers-builds-upgrade`, `--bridge-manifest <path>`, `WRANGLER_CI_OVERRIDE_NAME`, retained `wrangler.jsonc`, and the bridge manifest from Task 1.
- Produces: `assertWorkersBuildsEligibility({ config, bridge, manifest })`, `verifyProductPayload({ bridge, projectRoot })`, and the first immutable `baselineFingerprint` before remote mutation.

- [ ] **Step 1: Write failing eligibility tests**

```js
test("blocks without Cloudflare's Worker override before migration", () => {
  const result = runBridge({ env: { WRANGLER_CI_OVERRIDE_NAME: undefined } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*WRANGLER_CI_OVERRIDE_NAME/su);
  assert.deepEqual(readCommands(), ["deployments status"]);
});

test("blocks a missing Worker and never calls migration or deploy", () => {
  const result = runBridge({ deploymentState: "missing" });
  assert.equal(result.status, 1);
  assert.doesNotMatch(readCommands().join("\n"), /migrations apply|wrangler deploy/u);
});
```

Also cover invalid override names, absent/duplicate DB or KV bindings, absent fixed IDs, mismatched active-version resource IDs, inconsistent active versions, a changed product-payload digest, and a changed package dependency projection.

- [ ] **Step 2: Run the bridge test and verify it fails**

Run: `node --test tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`

Expected: FAIL because the mode, contract argument, and verifier are missing.

- [ ] **Step 3: Implement the strict preflight**

Add `workers-builds-upgrade` to `VALID_MODES`, parse `--bridge-manifest`, require a non-empty platform override, validate product release fields and digests, require an existing deployment, and inspect every active version with one fixed effective name. Classify validation and eligibility failures as `[BRIDGE][BLOCKED]`; reserve `[BRIDGE][FAILED]` for an operation that began and failed.

```js
function bridgeBlocked(message) {
  return Object.assign(new Error(`[BRIDGE][BLOCKED] ${message}`), { bridgeOutcome: "blocked" });
}

function requiredWorkersBuildsName(config) {
  if (!process.env.WRANGLER_CI_OVERRIDE_NAME) {
    throw bridgeBlocked("缺少 Cloudflare Workers Builds 提供的 WRANGLER_CI_OVERRIDE_NAME");
  }
  return effectiveWorkerName(config);
}
```

- [ ] **Step 4: Run eligibility tests**

Run: `node --test --test-name-pattern="eligibility|source|missing|mismatch|active" tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`

Expected: PASS with no migration/deploy command in each blocked command trace.

- [ ] **Step 5: Commit the preflight task**

```bash
git add scripts/cloudflare-deploy.mjs tests/cloudflare-workers-builds-upgrade-bridge.test.mjs
git commit -m "feat: fail closed on ineligible Workers Builds targets"
```

### Task 3: Enforce list → apply → empty-list migration ordering

**Files:**
- Modify: `scripts/cloudflare-deploy.mjs:625-737,801-836`
- Test: `tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`

**Interfaces:**
- Consumes: `baselineFingerprint`, bridge `allowedPendingMigrations`, D1 migration-list text, and exact SQL files beneath the configured migrations directory.
- Produces: `validateBridgePendingMigrations(names, bridge) -> string[]` and a proven empty pending set before deployment.

- [ ] **Step 1: Write failing migration state-machine tests**

```js
test("applies only 0006 and 0007, then requires an empty second list", () => {
  const result = runBridge({ migrationLists: [["0006_auth_v2.sql", "0007_legacy_media_and_access_state.sql"], []] });
  assert.equal(result.status, 0);
  assert.deepEqual(remoteMutationCommands(), ["d1 migrations apply", "deploy"]);
  assert.ok(commandIndex("second list") < commandIndex("deploy"));
});

test("migration apply failure blocks deployment", () => {
  const result = runBridge({ applyStatus: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[FAILED\].*迁移/su);
  assert.doesNotMatch(readCommands().join("\n"), /wrangler deploy/u);
});
```

Add separate cases for list failure/ambiguous output, pending `0005`, unknown migration, duplicate or reordered names, changed 0006/0007 SHA-256, apply success followed by a still-pending second list, retry with only 0007, and no pending migration.

- [ ] **Step 2: Run the migration tests and verify failure**

Run: `node --test --test-name-pattern="migration|pending|0006|0007" tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`

Expected: FAIL because the current upgrade path can deploy after D1 permission failure and does not re-list.

- [ ] **Step 3: Implement the strict ordered migration gate**

```js
const allowed = bridge.allowedPendingMigrations.map(({ name }) => name);
const suffixes = [[], [allowed[1]], allowed];
if (!suffixes.some((suffix) => JSON.stringify(suffix) === JSON.stringify(pending))) {
  throw bridgeBlocked(`pending Migration 不属于允许的前向后缀：${pending.join(", ")}`);
}
```

Verify both SQL digests before the first remote mutation. In bridge mode, never call `assertRuntimeSafeFallback`; any apply error throws `[BRIDGE][FAILED]`, and the second list must parse to `[]` before continuing.

- [ ] **Step 4: Run all bridge migration tests**

Run: `node --test --test-name-pattern="migration|pending|0006|0007" tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`

Expected: PASS; command traces prove deploy is absent from every failure case.

- [ ] **Step 5: Commit the migration task**

```bash
git add scripts/cloudflare-deploy.mjs tests/cloudflare-workers-builds-upgrade-bridge.test.mjs
git commit -m "feat: gate deployment on completed D1 migrations"
```

### Task 4: Preserve remote configuration and verify the same Worker after deploy

**Files:**
- Modify: `scripts/cloudflare-deploy.mjs:1-10,739-841`
- Modify: `.gitignore`
- Test: `tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`

**Interfaces:**
- Consumes: retained parsed config, `baselineFingerprint`, fixed `workerName`, and the proven empty pending set.
- Produces: `withVarsFreeDeployConfig(configPath, config, callback)` and a verified `[BRIDGE][SUCCESS]` outcome.

- [ ] **Step 1: Write failing preservation/post-check tests**

```js
test("deploys with a temporary vars-free config and --keep-vars", () => {
  const result = runBridge({ remoteVars: { AUTH_PLATFORM: "remote-custom", STUDENT_FLAG: "kept" } });
  const deploy = readDeployInvocation();
  assert.equal(result.status, 0);
  assert.ok(deploy.args.includes("--keep-vars"));
  assert.equal(Object.hasOwn(deploy.config, "vars"), false);
  assert.equal(existsSync(deploy.configPath), false);
});

test("post-deploy variable or Secret drift is a failure, never success", () => {
  const result = runBridge({ postDeployDrift: "runtime-variable" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[FAILED\].*部署后/su);
  assert.doesNotMatch(result.stdout, /\[BRIDGE\]\[SUCCESS\]/u);
});
```

Also cover changed DB, KV, R2, Secret binding name, missing post-deploy version, deploy failure, and cleanup after callback failure. Assert logs contain no raw remote variable, token, cookie, password, or Secret value.

- [ ] **Step 2: Run the preservation tests and verify failure**

Run: `node --test --test-name-pattern="vars|Secret|post-deploy|cleanup|same Worker" tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`

Expected: FAIL because the current deployment uses the source config directly and lacks a post-deploy check.

- [ ] **Step 3: Implement temporary config and post-check**

Use an exclusive process/random filename beside the retained config, remove `vars`, set `keep_vars: true`, mode `0600`, and always `unlink` in `finally`. Immediately before deploy re-read the baseline fingerprint; deploy with the same validated name and `--keep-vars`; then poll/read the active deployment and compare normalized fingerprints exactly.

```js
const deployConfig = structuredClone(config);
delete deployConfig.vars;
deployConfig.keep_vars = true;
await writeFile(tempPath, `${JSON.stringify(deployConfig, null, 2)}\n`, { flag: "wx", mode: 0o600 });
try {
  return await callback(tempPath);
} finally {
  await unlink(tempPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
}
```

- [ ] **Step 4: Run the complete bridge test file**

Run: `node --test tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`

Expected: PASS; only fully verified runs emit `[BRIDGE][SUCCESS]`.

- [ ] **Step 5: Commit the preservation task**

```bash
git add .gitignore scripts/cloudflare-deploy.mjs tests/cloudflare-workers-builds-upgrade-bridge.test.mjs
git commit -m "feat: preserve remote Worker configuration across bridge deploys"
```

### Task 5: Prove real legacy structure compatibility without production mutation

**Files:**
- Modify: `tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`
- Create: `docs/internal/2026-09-01-workers-builds-upgrade-bridge-compatibility.md`

**Interfaces:**
- Consumes: historical repository commit `dbbbf185983449898b91da96de75d3e07f9ed345`, its tracked `wrangler.jsonc`, and its six SQL files `0000`–`0005`.
- Produces: a redacted compatibility record and a fake-Wrangler test proving `0006`/`0007` are the only mutations selected before a same-target deploy.

- [ ] **Step 1: Write the failing historical-structure test**

```js
test("real fixed-ID 0000-0005 legacy structure reaches only 0006/0007", async () => {
  const legacyConfig = await gitShow(legacyCommit, "wrangler.jsonc");
  assert.match(legacyConfig, /"database_id"/u);
  assert.match(legacyConfig, /"MEDIA_KV"[\s\S]*"id"/u);
  const result = runBridgeWithRedactedLegacyConfig(legacyConfig, {
    migrationLists: [["0006_auth_v2.sql", "0007_legacy_media_and_access_state.sql"], []],
  });
  assert.equal(result.status, 0);
  assert.deepEqual(appliedMigrationNames(), ["0006_auth_v2.sql", "0007_legacy_media_and_access_state.sql"]);
});
```

The test replaces IDs in memory before writing its temporary fixture, uses only the fake Wrangler executable, asserts no network tool is called, and never prints the original IDs.

- [ ] **Step 2: Run the historical test and verify failure**

Run: `node --test --test-name-pattern="real fixed-ID" tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`

Expected: FAIL until the historical fixture adapter and full bridge state machine are wired.

- [ ] **Step 3: Implement the redacted verification and evidence record**

Record the historical commit, observed binding names, migration range `0000`–`0005`, fake command trace, selected pending suffix, and `productionMutation: false`. Store no D1/KV ID, token, variable value, or recovery material.

- [ ] **Step 4: Run the test and scan evidence for secret-shaped content**

Run: `node --test --test-name-pattern="real fixed-ID" tests/cloudflare-workers-builds-upgrade-bridge.test.mjs && ! rg -n '\b[a-f0-9]{32}\b|\b[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\b' docs/internal/2026-09-01-workers-builds-upgrade-bridge-compatibility.md`

Expected: PASS and no resource-identifier-shaped match.

- [ ] **Step 5: Commit the compatibility task**

```bash
git add tests/cloudflare-workers-builds-upgrade-bridge.test.mjs docs/internal/2026-09-01-workers-builds-upgrade-bridge-compatibility.md
git commit -m "test: verify the bridge against a real legacy structure"
```

### Task 6: Synchronize canonical documentation and run Candidate gates

**Files:**
- Modify: `AGENTS.md:1-110`
- Modify: `deployment/agent-manifest.json:200-260`
- Modify: `README.md:550-620,680-715`
- Modify: `docs/plans/2026-09-01-workers-builds-upgrade-bridge.md`
- Test: `tests/agent-deployment-package.test.mjs`
- Test: `tests/cloudflare-workers-builds-upgrade-bridge.test.mjs`
- Test: `tests/update-notifier.test.mjs`

**Interfaces:**
- Consumes: completed bridge behavior and evidence from Tasks 1–5.
- Produces: one auditable Candidate commit and exact Candidate/tree SHAs; no merge, tag, or deployment.

- [ ] **Step 1: Add failing canonical-document assertions**

```js
assert.equal(manifest.commands.cloudBuildExistingWorker, "npm run deploy");
assert.equal(manifest.workersBuildsUpgradeBridge.productSourceCommit, bridge.productRelease.commit);
assert.equal(manifest.databaseMigrationPolicy.workersBuildsPermissionFallback, "forbidden");
assert.match(readme, /GitHub → Cloudflare Workers Builds Upgrade Bridge/u);
assert.match(readme, /迁移失败.*不会部署/su);
```

- [ ] **Step 2: Run packaging tests and verify the stale documentation fails**

Run: `node --test tests/agent-deployment-package.test.mjs`

Expected: FAIL because the canonical manifest still calls Cloud Builds an invalid upgrade entry.

- [ ] **Step 3: Update canonical documentation without changing release identity**

Describe the exact GitHub-trigger/build/migrate/re-list/deploy/post-check sequence, fixed-resource eligibility, remote vars/Secrets preservation, and log outcomes. Keep release version/tag/prompt digest unchanged and do not edit `deployment/upgrade-prompt.json`.

- [ ] **Step 4: Run focused and complete quality gates**

Run, in order:

```bash
npm ci
node --test tests/cloudflare-workers-builds-upgrade-bridge.test.mjs
npm test
npm run lint
./node_modules/.bin/tsc --noEmit
npm audit --omit=dev --audit-level=high
bash -n scripts/*.sh
node --check scripts/*.mjs
npm run db:generate
git status --porcelain --untracked-files=all -- drizzle
npx --no-install wrangler deploy --dry-run --keep-vars --config wrangler.jsonc
git diff --check
```

Expected: all tests/build/Lint/TypeScript/syntax/audit/dry-run/whitespace gates pass; `npm run db:generate` creates no Drizzle change; no command targets a remote production resource.

- [ ] **Step 5: Verify frozen boundaries and create the Candidate commit**

```bash
test "$(git rev-parse refs/tags/v1.3.0^{})" = "4658bc834d6ea21aa94ce0db0d9c99e82b856235"
test -z "$(git diff --name-only 4658bc834d6ea21aa94ce0db0d9c99e82b856235 -- app build cloudflare cloudflare-demo db drizzle public worker next.config.ts postcss.config.mjs tsconfig.json vite.config.ts worker-configuration.d.ts package-lock.json scripts/build-verified.sh scripts/sites-env.sh)"
test "$(git branch --show-current)" = "emergency/v1.3.0-workers-builds-upgrade-bridge"
git add .gitignore AGENTS.md README.md package.json deployment scripts tests docs
git commit -m "feat: add the v1.3.0 Workers Builds upgrade bridge"
git rev-parse HEAD
git rev-parse HEAD^{tree}
```

Expected: immutable tag still peels to the release commit, deployable product paths have no diff, and Git prints exact Candidate commit/tree SHAs.

- [ ] **Step 6: Stop for independent Candidate audit**

Report branch, Candidate SHA, tree SHA, changed files, gate results, risks, real-legacy compatibility evidence, and the fact that production, `main`, `v1.3.0`, 3A, and `governance-state` were untouched. Do not push unless separately authorized, do not merge, do not tag, and do not deploy.
