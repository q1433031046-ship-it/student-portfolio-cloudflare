import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const deployScript = join(projectRoot, "scripts", "cloudflare-deploy.mjs");

async function createHarness(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "workers-builds-upgrade-bridge-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const migrations = join(root, "drizzle");
  const assets = join(root, "dist", "client");
  const server = join(root, "dist", "server");
  await Promise.all([mkdir(bin), mkdir(migrations), mkdir(assets, { recursive: true }), mkdir(server, { recursive: true })]);

  const configPath = join(root, "wrangler.jsonc");
  const manifestPath = join(root, "agent-manifest.json");
  const bridgePath = join(root, "workers-builds-upgrade-bridge.json");
  const scenarioPath = join(root, "scenario.json");
  const statePath = join(root, "state.json");
  const logPath = join(root, "wrangler-log.jsonl");
  const bridge = JSON.parse(await readFile("deployment/workers-builds-upgrade-bridge.json", "utf8"));
  if (overrides.bridgeMutation) overrides.bridgeMutation(bridge);

  const config = {
    name: "source-name-must-not-select-target",
    main: "./cloudflare/worker-entry.js",
    assets: { directory: "./dist/client", binding: "ASSETS" },
    workers_dev: true,
    vars: {
      AUTH_PLATFORM: "source-must-not-overwrite",
      SOURCE_ONLY_VALUE: "source-must-not-deploy",
    },
    d1_databases: [{
      binding: "DB",
      database_id: "db-fixed",
      migrations_dir: "./drizzle",
    }],
    kv_namespaces: [{ binding: "MEDIA_KV", id: "kv-fixed" }],
  };
  if (overrides.omitDbId) delete config.d1_databases[0].database_id;
  if (overrides.omitKvId) delete config.kv_namespaces[0].id;
  if (overrides.omitKv) delete config.kv_namespaces;
  if (overrides.duplicateDb) config.d1_databases.push({ ...config.d1_databases[0] });
  if (overrides.r2Bucket) config.r2_buckets = [{ binding: "BUCKET", bucket_name: "existing-bucket" }];
  if (overrides.configMutation) overrides.configMutation(config);

  const scenario = {
    workerState: "existing",
    preVersions: ["version-before"],
    postVersions: ["version-after"],
    migrationLists: [
      ["0006_auth_v2.sql", "0007_legacy_media_and_access_state.sql"],
      [],
    ],
    listResult: "success",
    applyResult: "success",
    deployResult: "success",
    pre: {
      db: "db-fixed",
      kv: "kv-fixed",
      r2: overrides.r2Bucket ? "existing-bucket" : null,
      assets: {},
      extraBindings: [],
      vars: {
        AUTH_PLATFORM: "remote-custom-value",
        STUDENT_FLAG: "remote-only-value",
      },
      secrets: ["INITIAL_ADMIN_CODE", "UPLOAD_API_TOKEN"],
    },
    post: null,
    ...overrides.scenario,
  };
  scenario.post ??= structuredClone(scenario.pre);

  await Promise.all([
    writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`),
    writeFile(manifestPath, `${JSON.stringify({
      releaseContract: {
        version: "1.3.0",
        releaseTag: "v1.3.0",
        sourceRef: "refs/tags/v1.3.0",
      },
      requiredSecrets: ["INITIAL_ADMIN_CODE"],
    }, null, 2)}\n`),
    writeFile(bridgePath, `${JSON.stringify(bridge, null, 2)}\n`),
    writeFile(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`),
    writeFile(statePath, `${JSON.stringify({ statusCalls: 0, listCalls: 0, deployed: false })}\n`),
    writeFile(join(assets, "index.html"), "test build output\n"),
    writeFile(join(server, "index.js"), "export default {};\n"),
    cp(join(projectRoot, "drizzle", "0006_auth_v2.sql"), join(migrations, "0006_auth_v2.sql")),
    cp(join(projectRoot, "drizzle", "0007_legacy_media_and_access_state.sql"), join(migrations, "0007_legacy_media_and_access_state.sql")),
  ]);
  if (overrides.missingAssets) await rm(assets, { recursive: true, force: true });
  if (overrides.missingServer) await rm(server, { recursive: true, force: true });

  if (overrides.migrationMutation) {
    await overrides.migrationMutation({ migrations });
  }

  const fakeNpx = join(bin, "npx");
  await writeFile(fakeNpx, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync(process.env.FAKE_SCENARIO, "utf8"));
const state = JSON.parse(fs.readFileSync(process.env.FAKE_STATE, "utf8"));
const command = args.join(" ");
function persist() { fs.writeFileSync(process.env.FAKE_STATE, JSON.stringify(state) + "\\n"); }
function log(extra = {}) { fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, ...extra }) + "\\n"); }
  function bindings(data) {
  const result = [
    { name: "DB", type: "d1", id: data.db },
    { name: "MEDIA_KV", type: "kv_namespace", namespace_id: data.kv },
    { name: "ASSETS", type: "assets", ...(data.assets || {}) },
  ];
  if (data.r2) result.push({ name: "BUCKET", type: "r2_bucket", bucket_name: data.r2 });
  for (const [name, text] of Object.entries(data.vars || {})) result.push({ name, type: "plain_text", text });
  for (const name of data.secrets || []) result.push({ name, type: "secret_text" });
  for (const binding of data.extraBindings || []) result.push(binding);
  return result;
}
if (command.includes("deployments status")) {
  state.statusCalls += 1;
  persist();
  log({ phase: "status", call: state.statusCalls });
  if (scenario.workerState === "missing") {
    process.stderr.write("The Worker has no deployments.\\n");
    process.exit(1);
  }
  const versions = state.deployed ? scenario.postVersions : scenario.preVersions;
  process.stdout.write(JSON.stringify({ versions: versions.map((version_id) => ({ version_id, percentage: 100 })) }) + "\\n");
  process.exit(0);
}
if (command.includes("versions view")) {
  const version = args[args.indexOf("view") + 1];
  const data = scenario.versionData && scenario.versionData[version]
    ? scenario.versionData[version]
    : scenario.postVersions.includes(version) ? scenario.post : scenario.pre;
  log({ phase: "view", version });
  process.stdout.write(JSON.stringify({ resources: { bindings: bindings(data) } }) + "\\n");
  process.exit(0);
}
if (command.includes("d1 migrations list")) {
  state.listCalls += 1;
  persist();
  log({ phase: "list", call: state.listCalls });
  if (scenario.listResult === "failure") {
    process.stderr.write((scenario.listError || "D1 list unavailable.") + "\\n");
    process.exit(1);
  }
  if (scenario.listResult === "ambiguous") {
    process.stdout.write("D1 query completed without a migration table.\\n");
    process.exit(0);
  }
  const names = scenario.migrationLists[Math.min(state.listCalls - 1, scenario.migrationLists.length - 1)];
  process.stdout.write(names.length ? "Migrations to be applied:\\n" + names.join("\\n") + "\\n" : "No migrations to apply!\\n");
  process.exit(0);
}
if (command.includes("d1 migrations apply")) {
  log({ phase: "apply" });
  if (scenario.applyResult !== "success") {
    process.stderr.write(scenario.applyResult === "permission" ? "Forbidden: D1 Edit permission is required.\\n" : "SQLITE_ERROR: migration failed.\\n");
    process.exit(1);
  }
  process.stdout.write("Migrations applied.\\n");
  process.exit(0);
}
if (command.includes("wrangler deploy")) {
  const configPath = args[args.indexOf("--config") + 1];
  const deployConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  log({ phase: "deploy", configPath, deployConfig });
  if (scenario.deployResult !== "success") {
    process.stderr.write("Worker deploy failed.\\n");
    process.exit(1);
  }
  state.deployed = true;
  persist();
  process.stdout.write("Worker deployed.\\n");
  process.exit(0);
}
log({ phase: "unexpected" });
process.stderr.write("Unexpected fake Wrangler command: " + command + "\\n");
process.exit(64);
`);
  await chmod(fakeNpx, 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_SCENARIO: scenarioPath,
    FAKE_STATE: statePath,
    FAKE_LOG: logPath,
  };
  delete env.WRANGLER_CI_OVERRIDE_NAME;
  if (!overrides.omitCiOverride) env.WRANGLER_CI_OVERRIDE_NAME = overrides.ciOverrideName ?? "connected-existing-worker";

  return { root, configPath, manifestPath, bridgePath, statePath, logPath, env };
}

async function runBridge(harness) {
  try {
    const result = await execFileAsync(process.execPath, [
      deployScript,
      "--mode", "workers-builds-upgrade",
      "--config", harness.configPath,
      "--manifest", harness.manifestPath,
      "--bridge-manifest", harness.bridgePath,
    ], { cwd: projectRoot, env: harness.env });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      status: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function readLog(harness) {
  const source = await readFile(harness.logPath, "utf8").catch(() => "");
  return source.trim() === "" ? [] : source.trim().split("\n").map(JSON.parse);
}

test("blocks without the Cloudflare Workers Builds Worker override before any remote call", async (t) => {
  const harness = await createHarness(t, { omitCiOverride: true });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*WRANGLER_CI_OVERRIDE_NAME/su);
  assert.deepEqual(await readLog(harness), []);
});

test("blocks before any remote call when the build-token permission contract omits D1 Edit", async (t) => {
  const harness = await createHarness(t, {
    bridgeMutation(bridge) {
      bridge.requiredBuildTokenPermissions = bridge.requiredBuildTokenPermissions
        .filter(({ permission }) => permission !== "D1");
    },
  });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*D1 Edit/su);
  assert.deepEqual(await readLog(harness), []);
});

test("blocks before any remote call when automatic Wrangler provisioning is not explicitly disabled", async (t) => {
  const harness = await createHarness(t, {
    bridgeMutation(bridge) {
      bridge.wranglerSafety.automaticResourceProvisioning = true;
    },
  });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*自动资源 provisioning/su);
  assert.deepEqual(await readLog(harness), []);
});

test("applies only 0006 and 0007, re-lists, deploys vars-free, and verifies a new version", async (t) => {
  const harness = await createHarness(t);
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[BRIDGE\]\[SUCCESS\]/u);
  assert.deepEqual(log.filter(({ phase }) => phase === "list").map(({ call }) => call), [1, 2]);
  assert.equal(log.filter(({ phase }) => phase === "apply").length, 1);
  const deploy = log.find(({ phase }) => phase === "deploy");
  assert.ok(deploy);
  assert.equal(Object.hasOwn(deploy.deployConfig, "vars"), false);
  assert.equal(deploy.deployConfig.keep_vars, true);
  assert.equal(deploy.deployConfig.workers_dev, true);
  assert.equal(deploy.deployConfig.d1_databases[0].database_id, "db-fixed");
  assert.equal(deploy.deployConfig.kv_namespaces[0].id, "kv-fixed");
  assert.ok(deploy.args.includes("--keep-vars"));
  assert.ok(deploy.args.includes("--strict"));
  assert.ok(deploy.args.includes("--experimental-provision=false"));
  assert.ok(deploy.args.includes("--experimental-auto-create=false"));
  assert.ok(deploy.args.includes("--autoconfig=false"));
  assert.ok(log.every(({ args }) => args.includes("--experimental-provision=false")));
  assert.ok(log.findIndex(({ phase, call }) => phase === "list" && call === 2) < log.findIndex(({ phase }) => phase === "deploy"));
  assert.ok(log.some(({ phase, version }) => phase === "view" && version === "version-after"));
  await assert.rejects(readFile(deploy.configPath), { code: "ENOENT" });
});

test("a migration-list failure blocks apply and deploy", async (t) => {
  const harness = await createHarness(t, { scenario: { listResult: "failure" } });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[FAILED\].*pending Migration/su);
  assert.equal(log.some(({ phase }) => phase === "apply" || phase === "deploy"), false);
});

test("an old or unknown pending migration blocks before apply", async (t) => {
  const harness = await createHarness(t, {
    scenario: { migrationLists: [["0005_password_auth_kv_media.sql", "0006_auth_v2.sql", "0007_legacy_media_and_access_state.sql"]] },
  });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*0005_password_auth_kv_media\.sql/su);
  assert.equal(log.some(({ phase }) => phase === "apply" || phase === "deploy"), false);
});

test("migration apply failure stops and never deploys runtime code", async (t) => {
  const harness = await createHarness(t, { scenario: { applyResult: "permission" } });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[FAILED\].*D1 Migration/su);
  assert.match(result.stderr, /D1 Edit permission is required/u);
  assert.doesNotMatch(result.stdout, /\[BRIDGE\]\[SUCCESS\]/u);
  assert.equal(log.some(({ phase }) => phase === "deploy"), false);
});

test("post-deploy remote variable drift is a failure and never a success", async (t) => {
  const harness = await createHarness(t, {
    scenario: {
      post: {
        db: "db-fixed",
        kv: "kv-fixed",
        r2: null,
        vars: { AUTH_PLATFORM: "changed-after-deploy", STUDENT_FLAG: "remote-only-value" },
        secrets: ["INITIAL_ADMIN_CODE", "UPLOAD_API_TOKEN"],
      },
    },
  });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[FAILED\].*部署后/su);
  assert.doesNotMatch(result.stdout, /\[BRIDGE\]\[SUCCESS\]/u);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /remote-custom-value|remote-only-value|changed-after-deploy/u);
});

test("invalid Worker override blocks before any remote call", async (t) => {
  const harness = await createHarness(t, { ciOverrideName: "Invalid Worker Name" });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*WRANGLER_CI_OVERRIDE_NAME/su);
  assert.deepEqual(await readLog(harness), []);
});

test("a missing Worker is blocked after one read and is never created", async (t) => {
  const harness = await createHarness(t, { scenario: { workerState: "missing" } });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*禁止创建新 Worker/su);
  assert.deepEqual(log.map(({ phase }) => phase), ["status"]);
});

for (const [label, options] of [
  ["DB database_id", { omitDbId: true }],
  ["MEDIA_KV id", { omitKvId: true }],
  ["MEDIA_KV binding", { omitKv: true }],
  ["single DB binding", { duplicateDb: true }],
]) {
  test(`fixed-resource eligibility blocks a missing or ambiguous ${label}`, async (t) => {
    const harness = await createHarness(t, options);
    const result = await runBridge(harness);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*固定资源配置/su);
    assert.deepEqual(await readLog(harness), []);
  });
}

test("a live DB or KV mismatch blocks before migration", async (t) => {
  const harness = await createHarness(t, {
    scenario: {
      pre: {
        db: "different-live-db",
        kv: "kv-fixed",
        r2: null,
        vars: { AUTH_PLATFORM: "remote-custom-value" },
        secrets: ["INITIAL_ADMIN_CODE"],
      },
      post: {
        db: "different-live-db",
        kv: "kv-fixed",
        r2: null,
        vars: { AUTH_PLATFORM: "remote-custom-value" },
        secrets: ["INITIAL_ADMIN_CODE"],
      },
    },
  });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*资源身份/su);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /different-live-db|db-fixed|kv-fixed/u);
  assert.equal(log.some(({ phase }) => phase === "list" || phase === "apply" || phase === "deploy"), false);
});

test("an unmodelled local resource binding blocks before every remote call", async (t) => {
  const harness = await createHarness(t, {
    configMutation(config) {
      config.services = [{ binding: "LEGACY_SERVICE", service: "legacy-worker-resource-id" }];
    },
  });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*未建模.*services/su);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /legacy-worker-resource-id/u);
  assert.deepEqual(await readLog(harness), []);
});

test("an unsupported live resource binding blocks before migration without logging its resource id", async (t) => {
  const harness = await createHarness(t, {
    scenario: {
      pre: {
        db: "db-fixed",
        kv: "kv-fixed",
        r2: null,
        assets: {},
        vars: { AUTH_PLATFORM: "remote-custom-value" },
        secrets: ["INITIAL_ADMIN_CODE"],
        extraBindings: [{ name: "SEARCH", type: "vectorize", index_id: "vector-resource-id-leak-marker" }],
      },
    },
  });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*SEARCH.*vectorize/su);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /vector-resource-id-leak-marker/u);
  assert.equal(log.some(({ phase }) => phase === "list" || phase === "apply" || phase === "deploy"), false);
});

test("active Worker versions with different bindings block before migration", async (t) => {
  const harness = await createHarness(t, {
    scenario: {
      preVersions: ["version-before", "version-before-two"],
      versionData: {
        "version-before-two": {
          db: "db-fixed",
          kv: "different-kv",
          r2: null,
          vars: { AUTH_PLATFORM: "remote-custom-value", STUDENT_FLAG: "remote-only-value" },
          secrets: ["INITIAL_ADMIN_CODE", "UPLOAD_API_TOKEN"],
        },
      },
    },
  });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*资源身份/su);
  assert.equal(log.some(({ phase }) => phase === "list" || phase === "deploy"), false);
});

test("changed bridge product digest blocks before any remote call", async (t) => {
  const harness = await createHarness(t, {
    bridgeMutation(bridge) {
      bridge.productPayload.sha256 = "0".repeat(64);
    },
  });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*固定 v1\.3\.0 release payload/su);
  assert.deepEqual(await readLog(harness), []);
});

test("missing production build output blocks before any remote call", async (t) => {
  const harness = await createHarness(t, { missingAssets: true });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*生产构建产物不存在/su);
  assert.deepEqual(await readLog(harness), []);
});

test("missing server bundle blocks before any remote call", async (t) => {
  const harness = await createHarness(t, { missingServer: true });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*服务端构建产物不存在/su);
  assert.deepEqual(await readLog(harness), []);
});

test("ambiguous successful migration-list output is blocked before mutation", async (t) => {
  const harness = await createHarness(t, { scenario: { listResult: "ambiguous" } });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*完整 pending Migration/su);
  assert.equal(log.some(({ phase }) => phase === "apply" || phase === "deploy"), false);
});

test("a retry with only 0007 pending applies exactly once and succeeds", async (t) => {
  const harness = await createHarness(t, {
    scenario: { migrationLists: [["0007_legacy_media_and_access_state.sql"], []] },
  });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(log.filter(({ phase }) => phase === "apply").length, 1);
  assert.deepEqual(log.filter(({ phase }) => phase === "list").map(({ call }) => call), [1, 2]);
});

test("an already migrated site skips apply and still verifies before deploy", async (t) => {
  const harness = await createHarness(t, { scenario: { migrationLists: [[]] } });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(log.filter(({ phase }) => phase === "list").length, 1);
  assert.equal(log.some(({ phase }) => phase === "apply"), false);
  assert.equal(log.filter(({ phase }) => phase === "status").length, 3);
});

test("a changed 0006 or 0007 file blocks before any remote call", async (t) => {
  const harness = await createHarness(t, {
    async migrationMutation({ migrations }) {
      await writeFile(join(migrations, "0006_auth_v2.sql"), "CREATE TABLE changed (id text);\n");
    },
  });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[BLOCKED\].*0006_auth_v2\.sql.*SHA-256/su);
  assert.deepEqual(await readLog(harness), []);
});

test("a partial migration apply that leaves pending files blocks deploy", async (t) => {
  const harness = await createHarness(t, {
    scenario: {
      migrationLists: [
        ["0006_auth_v2.sql", "0007_legacy_media_and_access_state.sql"],
        ["0007_legacy_media_and_access_state.sql"],
      ],
    },
  });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[FAILED\].*仍有 pending.*0007/su);
  assert.equal(log.some(({ phase }) => phase === "deploy"), false);
});

test("deploy failure removes the temporary config and never reports success", async (t) => {
  const harness = await createHarness(t, { scenario: { deployResult: "failure" } });
  const result = await runBridge(harness);
  const log = await readLog(harness);
  const deploy = log.find(({ phase }) => phase === "deploy");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[FAILED\].*Worker 部署失败/su);
  assert.doesNotMatch(result.stdout, /\[BRIDGE\]\[SUCCESS\]/u);
  assert.ok(deploy);
  await assert.rejects(readFile(deploy.configPath), { code: "ENOENT" });
});

test("post-deploy Secret binding drift fails the final gate", async (t) => {
  const harness = await createHarness(t, {
    scenario: {
      post: {
        db: "db-fixed",
        kv: "kv-fixed",
        r2: null,
        vars: { AUTH_PLATFORM: "remote-custom-value", STUDENT_FLAG: "remote-only-value" },
        secrets: ["INITIAL_ADMIN_CODE"],
      },
    },
  });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[FAILED\].*部署后.*全部远端 bindings/su);
  assert.doesNotMatch(result.stdout, /\[BRIDGE\]\[SUCCESS\]/u);
});

test("post-deploy ASSETS binding drift fails the complete binding gate", async (t) => {
  const harness = await createHarness(t, {
    scenario: {
      pre: {
        db: "db-fixed",
        kv: "kv-fixed",
        r2: null,
        assets: { deployment_id: "asset-baseline-private-id" },
        vars: { AUTH_PLATFORM: "remote-custom-value", STUDENT_FLAG: "remote-only-value" },
        secrets: ["INITIAL_ADMIN_CODE", "UPLOAD_API_TOKEN"],
      },
      post: {
        db: "db-fixed",
        kv: "kv-fixed",
        r2: null,
        assets: { deployment_id: "asset-drift-private-id" },
        vars: { AUTH_PLATFORM: "remote-custom-value", STUDENT_FLAG: "remote-only-value" },
        secrets: ["INITIAL_ADMIN_CODE", "UPLOAD_API_TOKEN"],
      },
    },
  });
  const result = await runBridge(harness);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[BRIDGE\]\[FAILED\].*全部远端 bindings/su);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /asset-baseline-private-id|asset-drift-private-id/u);
  assert.doesNotMatch(result.stdout, /\[BRIDGE\]\[SUCCESS\]/u);
});

for (const [label, options] of [
  ["DB", {
    scenario: {
      post: {
        db: "changed-db",
        kv: "kv-fixed",
        r2: null,
        vars: { AUTH_PLATFORM: "remote-custom-value", STUDENT_FLAG: "remote-only-value" },
        secrets: ["INITIAL_ADMIN_CODE", "UPLOAD_API_TOKEN"],
      },
    },
  }],
  ["MEDIA_KV", {
    scenario: {
      post: {
        db: "db-fixed",
        kv: "changed-kv",
        r2: null,
        vars: { AUTH_PLATFORM: "remote-custom-value", STUDENT_FLAG: "remote-only-value" },
        secrets: ["INITIAL_ADMIN_CODE", "UPLOAD_API_TOKEN"],
      },
    },
  }],
  ["R2", {
    r2Bucket: true,
    scenario: {
      post: {
        db: "db-fixed",
        kv: "kv-fixed",
        r2: "changed-bucket",
        vars: { AUTH_PLATFORM: "remote-custom-value", STUDENT_FLAG: "remote-only-value" },
        secrets: ["INITIAL_ADMIN_CODE", "UPLOAD_API_TOKEN"],
      },
    },
  }],
]) {
  test(`post-deploy ${label} drift fails the final gate`, async (t) => {
    const harness = await createHarness(t, options);
    const result = await runBridge(harness);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[BRIDGE\]\[FAILED\].*部署后/su);
    assert.doesNotMatch(result.stdout, /\[BRIDGE\]\[SUCCESS\]/u);
  });
}

test("duplicate or reordered pending migrations are blocked before apply", async (t) => {
  const [duplicate, reordered] = await Promise.all([
    createHarness(t, {
      scenario: { migrationLists: [["0006_auth_v2.sql", "0006_auth_v2.sql", "0007_legacy_media_and_access_state.sql"]] },
    }),
    createHarness(t, {
      scenario: { migrationLists: [["0007_legacy_media_and_access_state.sql", "0006_auth_v2.sql"]] },
    }),
  ]);
  const [duplicateResult, reorderedResult] = await Promise.all([runBridge(duplicate), runBridge(reordered)]);

  assert.equal(duplicateResult.status, 1);
  assert.match(duplicateResult.stderr, /\[BRIDGE\]\[BLOCKED\].*重复/su);
  assert.equal(reorderedResult.status, 1);
  assert.match(reorderedResult.stderr, /\[BRIDGE\]\[BLOCKED\].*前向后缀/su);
  for (const harness of [duplicate, reordered]) {
    assert.equal((await readLog(harness)).some(({ phase }) => phase === "apply" || phase === "deploy"), false);
  }
});

test("failure logs redact token, cookie, password, and secret-shaped values", async (t) => {
  const harness = await createHarness(t, {
    scenario: {
      listResult: "failure",
      listError: "api_token=cloudflare-token-marker cookie=session-cookie-marker password=admin-password-marker secret=secret-marker",
    },
  });
  const result = await runBridge(harness);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1);
  assert.doesNotMatch(output, /cloudflare-token-marker|session-cookie-marker|admin-password-marker|secret-marker/u);
  assert.match(output, /\[REDACTED\]/u);
});

test("failure logs redact D1, KV, namespace, bucket, and generic resource identifiers", async (t) => {
  const harness = await createHarness(t, {
    scenario: {
      listResult: "failure",
      listError: [
        "database_id=db-resource-leak-marker",
        "namespace_id=kv-resource-leak-marker",
        "bucket_name=bucket-resource-leak-marker",
        "resource_id=generic-resource-leak-marker",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "0123456789abcdef0123456789abcdef",
      ].join(" "),
    },
  });
  const result = await runBridge(harness);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 1);
  assert.doesNotMatch(output, /(?:db|kv|bucket|generic)-resource-leak-marker|aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee|0123456789abcdef0123456789abcdef/u);
  assert.match(output, /\[RESOURCE_REDACTED\]/u);
});

test("two student repositories run independently with distinct fixed resources", async (t) => {
  const makeOptions = (suffix) => ({
    ciOverrideName: `connected-worker-${suffix}`,
    configMutation(config) {
      config.d1_databases[0].database_id = `db-${suffix}`;
      config.kv_namespaces[0].id = `kv-${suffix}`;
    },
    scenario: {
      preVersions: [`before-${suffix}`],
      postVersions: [`after-${suffix}`],
      pre: {
        db: `db-${suffix}`,
        kv: `kv-${suffix}`,
        r2: null,
        vars: { SITE: suffix },
        secrets: ["INITIAL_ADMIN_CODE"],
      },
      post: {
        db: `db-${suffix}`,
        kv: `kv-${suffix}`,
        r2: null,
        vars: { SITE: suffix },
        secrets: ["INITIAL_ADMIN_CODE"],
      },
    },
  });
  const [left, right] = await Promise.all([
    createHarness(t, makeOptions("alpha")),
    createHarness(t, makeOptions("beta")),
  ]);
  const [leftResult, rightResult] = await Promise.all([runBridge(left), runBridge(right)]);

  assert.equal(leftResult.status, 0, leftResult.stderr);
  assert.equal(rightResult.status, 0, rightResult.stderr);
  const [leftLog, rightLog] = await Promise.all([readLog(left), readLog(right)]);
  assert.match(leftLog.find(({ phase }) => phase === "deploy").args.join(" "), /--name connected-worker-alpha/u);
  assert.match(rightLog.find(({ phase }) => phase === "deploy").args.join(" "), /--name connected-worker-beta/u);
});

test("real fixed-ID 0000-0005 legacy source structure reaches only 0006 and 0007 non-destructively", async (t) => {
  const legacyCommit = "dbbbf185983449898b91da96de75d3e07f9ed345";
  const [{ stdout: configSource }, { stdout: treeSource }] = await Promise.all([
    execFileAsync("git", ["show", `${legacyCommit}:wrangler.jsonc`], { cwd: projectRoot }),
    execFileAsync("git", ["ls-tree", "-r", "--name-only", legacyCommit, "drizzle"], { cwd: projectRoot }),
  ]);
  const legacyConfig = JSON.parse(configSource);
  assert.equal(typeof legacyConfig.d1_databases[0].database_id, "string");
  assert.equal(typeof legacyConfig.kv_namespaces[0].id, "string");
  assert.deepEqual(
    treeSource.split("\n").filter((path) => /^drizzle\/\d{4}.*\.sql$/u.test(path)).map((path) => path.split("/").at(-1)),
    [
      "0000_bumpy_ultimo.sql",
      "0001_perpetual_firestar.sql",
      "0002_nosy_silhouette.sql",
      "0003_careful_justice.sql",
      "0004_owner_email_onboarding.sql",
      "0005_password_auth_kv_media.sql",
    ],
  );
  const harness = await createHarness(t, {
    configMutation(config) {
      for (const key of Object.keys(config)) delete config[key];
      Object.assign(config, structuredClone(legacyConfig));
      config.d1_databases[0].database_id = "db-fixed";
      config.kv_namespaces[0].id = "kv-fixed";
    },
  });
  const result = await runBridge(harness);
  const log = await readLog(harness);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(log.filter(({ phase }) => phase === "apply").map(({ phase }) => phase), ["apply"]);
  assert.deepEqual(log.filter(({ phase }) => phase === "list").map(({ call }) => call), [1, 2]);
  assert.equal(log.filter(({ phase }) => phase === "deploy").length, 1);
});
