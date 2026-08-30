import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const deployOrchestratorPath = join(projectRoot, "scripts", "cloudflare-deploy.mjs");
const passwordVariableHash = createHash("sha256")
  .update("plain_text")
  .update("\0")
  .update("password")
  .digest("hex");
const fakeAuthMigration = 'CREATE TABLE IF NOT EXISTS "admin_auth_state" ("id" text PRIMARY KEY);\n';
const fakeConvergenceMigration = "CREATE TABLE IF NOT EXISTS legacy_media_migrations (id text PRIMARY KEY);\nCREATE TABLE IF NOT EXISTS portfolio_access_pass_state (id text PRIMARY KEY);\n";
const fakeConvergenceMigrationHash = createHash("sha256")
  .update(fakeConvergenceMigration, "utf8")
  .digest("hex");

async function createHarness(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "portfolio-deploy-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);

  const configPath = join(root, "wrangler.jsonc");
  const manifestPath = join(root, "agent-manifest.json");
  const logPath = join(root, "wrangler.log");
  const migrationsPath = join(root, "drizzle");
  await mkdir(migrationsPath);
  const config = {
    name: "student-portfolio-live",
    workers_dev: true,
    vars: { AUTH_PLATFORM: options.localAuthPlatform ?? "password" },
    d1_databases: [{
      binding: "DB",
      database_name: "student-db",
      ...(options.omitDbId ? {} : { database_id: "db-live" }),
      migrations_dir: "./drizzle",
    }],
    ...(options.omitKv ? {} : {
      kv_namespaces: [{
        binding: "MEDIA_KV",
        ...(options.omitKvId ? {} : { id: "kv-live" }),
      }],
    }),
  };
  if (options.localBucketName) {
    config.r2_buckets = [{ binding: "BUCKET", bucket_name: options.localBucketName }];
  }
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(manifestPath, `${JSON.stringify({
    requiredSecrets: ["INITIAL_ADMIN_CODE"],
    databaseMigrationPolicy: {
      runtimeSafeBootstrapMigrations: ["0006_auth_v2.sql", "0007_legacy_media_and_access_state.sql"],
      migrationSha256: {
        "0007_legacy_media_and_access_state.sql": fakeConvergenceMigrationHash,
      },
    },
  }, null, 2)}\n`);
  await Promise.all([
    writeFile(join(migrationsPath, "0006_auth_v2.sql"), fakeAuthMigration),
    writeFile(join(migrationsPath, "0007_legacy_media_and_access_state.sql"), fakeConvergenceMigration),
  ]);

  const fakeNpx = join(bin, "npx");
  await writeFile(fakeNpx, `#!/usr/bin/env bash
set -euo pipefail
printf 'cwd=%s\\n' "$PWD" >> "$FAKE_WRANGLER_LOG"
printf '%s\\n' "$*" >> "$FAKE_WRANGLER_LOG"
command_line="$*"
if [[ "$command_line" == *"deployments status"* ]]; then
  if [[ "\${FAKE_WORKER_STATE:-existing}" == "new" ]]; then
    printf 'The Worker has no deployments.\\n' >&2
    exit 1
  fi
  if [[ -n "\${FAKE_EXISTING_WORKER_NAME:-}" && "$command_line" != *"--name $FAKE_EXISTING_WORKER_NAME"* ]]; then
    printf 'The Worker has no deployments.\\n' >&2
    exit 1
  fi
  printf '{"versions":%s}\\n' "$FAKE_VERSIONS_JSON"
  exit 0
fi
if [[ "$command_line" == *"versions view"* ]]; then
  is_second=false
  if [[ "$command_line" == *"version-two"* ]]; then is_second=true; fi
  remote_db="\${FAKE_REMOTE_DB_ID:-db-live}"
  remote_kv="\${FAKE_REMOTE_KV_ID:-kv-live}"
  remote_bucket="\${FAKE_REMOTE_BUCKET_NAME:-}"
  remote_auth="\${FAKE_REMOTE_AUTH_PLATFORM:-password}"
  extra_var="\${FAKE_EXTRA_VAR_VALUE:-}"
  optional_secret_state="\${FAKE_OPTIONAL_SECRET_STATE:-missing}"
  if [[ "$is_second" == "true" ]]; then
    remote_db="\${FAKE_SECOND_REMOTE_DB_ID:-$remote_db}"
    remote_kv="\${FAKE_SECOND_REMOTE_KV_ID:-$remote_kv}"
    remote_bucket="\${FAKE_SECOND_REMOTE_BUCKET_NAME:-$remote_bucket}"
    remote_auth="\${FAKE_SECOND_REMOTE_AUTH_PLATFORM:-$remote_auth}"
    extra_var="\${FAKE_SECOND_EXTRA_VAR_VALUE:-$extra_var}"
    optional_secret_state="\${FAKE_SECOND_OPTIONAL_SECRET_STATE:-$optional_secret_state}"
  fi
  if [[ -n "$remote_bucket" ]]; then
    bucket_binding=',{"name":"BUCKET","type":"r2_bucket","bucket_name":"'"$remote_bucket"'"}'
  else
    bucket_binding=''
  fi
  variable_binding=',{"name":"AUTH_PLATFORM","type":"plain_text","text":"'"$remote_auth"'"}'
  if [[ -n "$extra_var" ]]; then
    extra_variable_binding=',{"name":"LEGACY_MODE","type":"plain_text","text":"'"$extra_var"'"}'
  else
    extra_variable_binding=''
  fi
  if [[ "\${FAKE_SECRET_STATE:-present}" == "present" ]]; then
    secret_binding=',{"name":"INITIAL_ADMIN_CODE","type":"secret_text","text":"super-secret-marker"}'
  else
    secret_binding=''
  fi
  if [[ "$optional_secret_state" == "present" ]]; then
    optional_secret_binding=',{"name":"UPLOAD_API_TOKEN","type":"secret_text","text":"upload-secret-marker"}'
  else
    optional_secret_binding=''
  fi
  printf '{"resources":{"bindings":[{"name":"DB","type":"d1","id":"%s"},{"name":"MEDIA_KV","type":"kv_namespace","namespace_id":"%s"}%s%s%s%s%s]}}\\n' "$remote_db" "$remote_kv" "$bucket_binding" "$variable_binding" "$extra_variable_binding" "$secret_binding" "$optional_secret_binding"
  exit 0
fi
if [[ "$command_line" == *"d1 migrations list"* ]]; then
  if [[ "\${FAKE_LIST_RESULT:-success}" == "permission" ]]; then
    printf 'Forbidden: D1 Edit permission is required while creating d1_migrations.\\n' >&2
    exit 1
  fi
  printf 'Migrations to be applied:\\n%s\\n' "\${FAKE_PENDING_MIGRATIONS:-0006_auth_v2.sql}"
  exit 0
fi
if [[ "$command_line" == *"d1 migrations apply"* ]]; then
  case "\${FAKE_APPLY_RESULT:-success}" in
    success) printf 'Migrations applied.\\n'; exit 0 ;;
    permission) printf 'Forbidden: D1 Edit permission is required.\\n' >&2; exit 1 ;;
    sql) printf 'SQLITE_ERROR: duplicate table.\\n' >&2; exit 1 ;;
  esac
fi
if [[ "$command_line" == *"wrangler deploy"* ]]; then
  printf 'Worker deployed.\\n'
  exit 0
fi
printf 'Unexpected fake npx command: %s\\n' "$command_line" >&2
exit 64
`);
  await chmod(fakeNpx, 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_WRANGLER_LOG: logPath,
    FAKE_WORKER_STATE: options.workerState ?? "existing",
    FAKE_EXISTING_WORKER_NAME: options.existingWorkerName ?? "",
    FAKE_VERSIONS_JSON: options.versionsJson ?? '[{"version_id":"version-live","percentage":100}]',
    FAKE_PENDING_MIGRATIONS: options.pendingMigrations ?? "0006_auth_v2.sql",
    FAKE_LIST_RESULT: options.listResult ?? "success",
    FAKE_APPLY_RESULT: options.applyResult ?? "success",
    FAKE_REMOTE_DB_ID: options.remoteDbId ?? "db-live",
    FAKE_REMOTE_KV_ID: options.remoteKvId ?? "kv-live",
    FAKE_REMOTE_BUCKET_NAME: options.remoteBucketName ?? "",
    FAKE_REMOTE_AUTH_PLATFORM: options.remoteAuthPlatform ?? "password",
    FAKE_EXTRA_VAR_VALUE: options.extraVarValue ?? "",
    FAKE_OPTIONAL_SECRET_STATE: options.optionalSecretState ?? "missing",
    FAKE_SECOND_REMOTE_DB_ID: options.secondRemoteDbId ?? "",
    FAKE_SECOND_REMOTE_KV_ID: options.secondRemoteKvId ?? "",
    FAKE_SECOND_REMOTE_BUCKET_NAME: options.secondRemoteBucketName ?? "",
    FAKE_SECOND_REMOTE_AUTH_PLATFORM: options.secondRemoteAuthPlatform ?? "",
    FAKE_SECOND_EXTRA_VAR_VALUE: options.secondExtraVarValue ?? "",
    FAKE_SECOND_OPTIONAL_SECRET_STATE: options.secondOptionalSecretState ?? "",
    FAKE_SECRET_STATE: options.secretState ?? "present",
  };
  delete env.WRANGLER_CI_OVERRIDE_NAME;
  if (options.ciOverrideName !== undefined) {
    env.WRANGLER_CI_OVERRIDE_NAME = options.ciOverrideName;
  }

  return {
    root,
    configPath,
    manifestPath,
    logPath,
    env,
  };
}

async function runDeploy(harness, extraArgs = [], mode = "auto") {
  try {
    const result = await execFileAsync("bash", [
      "scripts/deploy-cloudflare.sh",
      "--mode", mode,
      "--config", harness.configPath,
      "--manifest", harness.manifestPath,
      ...extraArgs,
    ], {
      cwd: process.cwd(),
      env: harness.env,
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      status: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function runDeployFromForeignCwd(harness, extraArgs = [], mode = "upgrade") {
  try {
    const result = await execFileAsync(process.execPath, [
      deployOrchestratorPath,
      "--mode", mode,
      "--config", harness.configPath,
      "--manifest", harness.manifestPath,
      ...extraArgs,
    ], {
      cwd: harness.root,
      env: harness.env,
    });
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
  return readFile(harness.logPath, "utf8").catch(() => "");
}

async function captureFingerprint(harness, filename = "fingerprint.json") {
  const fingerprintPath = join(harness.root, filename);
  const capture = await runDeploy(harness, ["--inspect", "--output", fingerprintPath], "upgrade");
  assert.equal(capture.status, 0, capture.stderr);
  await writeFile(harness.logPath, "");
  return fingerprintPath;
}

async function inspectExisting(harness, filename = "inspection.json") {
  return runDeploy(
    harness,
    ["--inspect", "--output", join(harness.root, filename)],
    "upgrade",
  );
}

test("platform-provisioned new deployment applies migrations before one deploy", async (t) => {
  const harness = await createHarness(t, {
    workerState: "new",
    ciOverrideName: "student-portfolio-second-site",
    pendingMigrations: "0000_bumpy_ultimo.sql\n0001_perpetual_firestar.sql\n0006_auth_v2.sql",
  });
  const result = await runDeploy(harness, [], "new");
  const log = await readLog(harness);

  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /deployments status.*--name student-portfolio-second-site/u);
  assert.match(log, /d1 migrations apply/u);
  assert.equal((log.match(/\bwrangler deploy --/gu) ?? []).length, 1);
  assert.match(log, /wrangler deploy.*--name student-portfolio-second-site/u);
  assert.ok(log.indexOf("d1 migrations list") < log.indexOf("d1 migrations apply"));
  assert.ok(log.indexOf("d1 migrations apply") < log.indexOf("wrangler deploy --"));
  assert.doesNotMatch(log, /npm run build/u);
  assert.doesNotMatch(log, /versions view/u);
});

test("CI Worker-name override cannot misclassify an existing deployment as new", async (t) => {
  const harness = await createHarness(t, {
    ciOverrideName: "connected-existing-worker",
    existingWorkerName: "connected-existing-worker",
  });
  const result = await runDeploy(harness, [], "new");
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Worker 已存在/u);
  assert.match(log, /deployments status.*--name connected-existing-worker/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("matching CI Worker-name override remains a valid new-deployment path", async (t) => {
  const harness = await createHarness(t, {
    workerState: "new",
    ciOverrideName: "student-portfolio-live",
    pendingMigrations: "",
  });
  const result = await runDeploy(harness, [], "new");
  const log = await readLog(harness);

  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /deployments status.*--name student-portfolio-live/u);
  assert.match(log, /wrangler deploy.*--name student-portfolio-live/u);
});

test("invalid CI Worker-name override fails before any remote call", async (t) => {
  const harness = await createHarness(t, { ciOverrideName: "INVALID worker name" });
  const result = await runDeploy(harness, [], "new");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WRANGLER_CI_OVERRIDE_NAME.*1–63/u);
  assert.equal(await readLog(harness), "");
});

test("generic local new deployment without platform-injected ids fails before mutation", async (t) => {
  const harness = await createHarness(t, {
    workerState: "new",
    omitDbId: true,
    omitKvId: true,
  });
  const result = await runDeploy(harness, [], "new");
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Deploy Button|database_id|MEDIA_KV id|本地无 ID/u);
  assert.match(log, /deployments status/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("existing upgrade captures and strictly rechecks the live fingerprint before mutation", async (t) => {
  const harness = await createHarness(t);
  const fingerprintPath = join(harness.root, "fingerprint.json");
  const capture = await runDeploy(harness, ["--inspect", "--output", fingerprintPath], "upgrade");
  assert.equal(capture.status, 0, capture.stderr);
  await writeFile(harness.logPath, "");

  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);
  const fingerprint = JSON.parse(await readFile(fingerprintPath, "utf8"));

  assert.equal(result.status, 0, result.stderr);
  assert.ok(log.indexOf("deployments status") < log.indexOf("versions view"));
  assert.ok(log.indexOf("versions view") < log.indexOf("d1 migrations list"));
  assert.ok(log.indexOf("d1 migrations list") < log.indexOf("d1 migrations apply"));
  assert.ok(log.indexOf("d1 migrations apply") < log.indexOf("wrangler deploy --"));
  assert.deepEqual(fingerprint, {
    schemaVersion: 1,
    workerName: "student-portfolio-live",
    configuredWorkersDevEnabled: true,
    d1: { binding: "DB", id: "db-live" },
    kv: { binding: "MEDIA_KV", id: "kv-live" },
    r2Buckets: [],
    runtimeVariables: [{ binding: "AUTH_PLATFORM", type: "plain_text", sha256: passwordVariableHash }],
    secretBindings: ["INITIAL_ADMIN_CODE"],
    requiredSecretBindings: ["INITIAL_ADMIN_CODE"],
  });
  assert.equal((await stat(fingerprintPath)).mode & 0o777, 0o600);
  const preservedConfig = JSON.parse(await readFile(harness.configPath, "utf8"));
  assert.equal(preservedConfig.d1_databases[0].database_id, "db-live");
  assert.equal(preservedConfig.kv_namespaces[0].id, "kv-live");
  assert.doesNotMatch(`${JSON.stringify(fingerprint)}${capture.stdout}${capture.stderr}`, /secret_text|secretValue|super-secret-marker|upload-secret-marker/u);
});

test("isolated tag tooling works from a foreign cwd with absolute original-site paths", async (t) => {
  const harness = await createHarness(t);
  const fingerprintPath = join(harness.root, ".wrangler", "upgrade-before-fingerprint.json");
  const result = await runDeployFromForeignCwd(
    harness,
    ["--inspect", "--output", fingerprintPath],
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(fingerprintPath, "utf8")).d1.id, "db-live");
  const log = await readLog(harness);
  assert.match(log, new RegExp(`cwd=${projectRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`));
  assert.doesNotMatch(log, new RegExp(`cwd=${harness.root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`));
  assert.match(log, /deployments status/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("explicit upgrade fails closed when no baseline fingerprint is provided", async (t) => {
  const harness = await createHarness(t);
  const result = await runDeploy(harness, [], "upgrade");
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--fingerprint|指纹文件/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("pure v1.0 R2-only configuration is explicitly unsupported before any remote action", async (t) => {
  const harness = await createHarness(t, {
    omitDbId: true,
    omitKv: true,
    localBucketName: "legacy-r2-media",
  });
  const result = await runDeploy(
    harness,
    ["--inspect", "--output", join(harness.root, "legacy-fingerprint.json")],
    "upgrade",
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /v1\.0 R2-only|本版未支持|固定 DB ID/u);
  assert.equal(await readLog(harness), "");
});

test("an existing site without MEDIA_KV cannot create or guess one during upgrade", async (t) => {
  const harness = await createHarness(t, {
    omitKv: true,
    localBucketName: "legacy-r2-media",
  });
  const result = await runDeploy(
    harness,
    ["--inspect", "--output", join(harness.root, "legacy-fingerprint.json")],
    "upgrade",
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MEDIA_KV|不会.*创建|本版未支持/u);
  assert.equal(await readLog(harness), "");
});

test("an existing MEDIA_KV binding without a fixed id fails closed", async (t) => {
  const harness = await createHarness(t, { omitKvId: true });
  const result = await runDeploy(
    harness,
    ["--inspect", "--output", join(harness.root, "legacy-fingerprint.json")],
    "upgrade",
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MEDIA_KV.*固定 id|其他站点/u);
  assert.equal(await readLog(harness), "");
});

test("auto mode also refuses to mutate an existing Worker without a baseline", async (t) => {
  const harness = await createHarness(t);
  const result = await runDeploy(harness);
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--fingerprint|升级前指纹文件/u);
  assert.match(log, /deployments status/u);
  assert.doesNotMatch(log, /versions view|d1 migrations|\bwrangler deploy --/u);
});

test("first-deploy mode refuses an existing Worker before migration", async (t) => {
  const harness = await createHarness(t, { omitDbId: true, omitKvId: true });
  const result = await runDeploy(harness, [], "new");
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Worker 已存在|首次部署模式/u);
  assert.doesNotMatch(log, /versions view|d1 migrations|\bwrangler deploy --/u);
});

test("changed baseline fingerprint blocks upgrade before migration", async (t) => {
  const harness = await createHarness(t);
  const fingerprintPath = join(harness.root, "fingerprint.json");
  const capture = await runDeploy(harness, ["--inspect", "--output", fingerprintPath], "upgrade");
  assert.equal(capture.status, 0, capture.stderr);
  const fingerprint = JSON.parse(await readFile(fingerprintPath, "utf8"));
  fingerprint.d1.id = "db-from-another-site";
  await writeFile(fingerprintPath, JSON.stringify(fingerprint) + "\n");
  await writeFile(harness.logPath, "");

  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /baseline|基线|fingerprint|资源指纹/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("upgrade rejects a fingerprint file readable by other users", async (t) => {
  const harness = await createHarness(t);
  const fingerprintPath = join(harness.root, "fingerprint.json");
  const capture = await runDeploy(harness, ["--inspect", "--output", fingerprintPath], "upgrade");
  assert.equal(capture.status, 0, capture.stderr);
  await chmod(fingerprintPath, 0o644);
  await writeFile(harness.logPath, "");

  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /0600|权限过宽/u);
  assert.equal(log, "");
});

test("fingerprint capture never overwrites an existing upgrade baseline", async (t) => {
  const harness = await createHarness(t);
  const fingerprintPath = await captureFingerprint(harness);
  const before = await readFile(fingerprintPath, "utf8");

  const result = await runDeploy(
    harness,
    ["--inspect", "--output", fingerprintPath],
    "upgrade",
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /已存在|避免覆盖|新的 --output/u);
  assert.equal(await readFile(fingerprintPath, "utf8"), before);
  assert.doesNotMatch(await readLog(harness), /d1 migrations|\bwrangler deploy --/u);
});

test("an optional secret name removed after capture blocks before migration without exposing values", async (t) => {
  const harness = await createHarness(t, { optionalSecretState: "present" });
  const fingerprintPath = join(harness.root, "fingerprint.json");
  const capture = await runDeploy(harness, ["--inspect", "--output", fingerprintPath], "upgrade");
  assert.equal(capture.status, 0, capture.stderr);
  harness.env.FAKE_OPTIONAL_SECRET_STATE = "missing";
  await writeFile(harness.logPath, "");

  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /秘密 binding|baseline fingerprint/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /super-secret-marker|upload-secret-marker/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("an optional secret name added after capture also blocks before mutation", async (t) => {
  const harness = await createHarness(t);
  const fingerprintPath = await captureFingerprint(harness);
  harness.env.FAKE_OPTIONAL_SECRET_STATE = "present";

  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /秘密 binding|baseline fingerprint/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /super-secret-marker|upload-secret-marker/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("a local workers_dev configuration change is rejected against the saved baseline", async (t) => {
  const harness = await createHarness(t);
  const fingerprintPath = await captureFingerprint(harness);
  const config = JSON.parse(await readFile(harness.configPath, "utf8"));
  config.workers_dev = false;
  await writeFile(harness.configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /workers_dev|baseline fingerprint/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("configured AUTH_PLATFORM mismatch blocks before migration and stores only a hash", async (t) => {
  const harness = await createHarness(t, { remoteAuthPlatform: "different-platform" });
  const result = await inspectExisting(harness);
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AUTH_PLATFORM|运行变量/u);
  assert.doesNotMatch(result.stderr, /different-platform/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("an extra preserved runtime variable changed after capture blocks before migration", async (t) => {
  const harness = await createHarness(t, { extraVarValue: "legacy-on" });
  const fingerprintPath = join(harness.root, "fingerprint.json");
  const capture = await runDeploy(harness, ["--inspect", "--output", fingerprintPath], "upgrade");
  assert.equal(capture.status, 0, capture.stderr);
  const fingerprint = JSON.parse(await readFile(fingerprintPath, "utf8"));
  assert.equal(fingerprint.runtimeVariables.find((entry) => entry.binding === "LEGACY_MODE")?.sha256.length, 64);
  assert.doesNotMatch(JSON.stringify(fingerprint), /legacy-on/u);
  harness.env.FAKE_EXTRA_VAR_VALUE = "legacy-off";
  await writeFile(harness.logPath, "");

  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /运行变量|baseline fingerprint/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /legacy-on|legacy-off/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("optional legacy R2 binding is part of the strict resource fingerprint", async (t) => {
  const harness = await createHarness(t, {
    localBucketName: "student-media-old",
    remoteBucketName: "student-media-old",
  });
  const fingerprintPath = join(harness.root, "fingerprint.json");
  const capture = await runDeploy(harness, ["--inspect", "--output", fingerprintPath], "upgrade");
  assert.equal(capture.status, 0, capture.stderr);
  const fingerprint = JSON.parse(await readFile(fingerprintPath, "utf8"));
  assert.deepEqual(fingerprint.r2Buckets, [{ binding: "BUCKET", bucketName: "student-media-old" }]);
});

test("an unconfigured live R2 binding blocks before migration to prevent data detachment", async (t) => {
  const harness = await createHarness(t, { remoteBucketName: "student-media-old" });
  const result = await inspectExisting(harness);
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /R2|BUCKET|resource fingerprint|资源指纹/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("existing upgrade refuses a changed D1 or KV target before migration", async (t) => {
  const harness = await createHarness(t, { remoteDbId: "db-other" });
  const result = await inspectExisting(harness);
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /resource fingerprint|资源指纹|DB/u);
  assert.doesNotMatch(log, /d1 migrations/u);
  assert.doesNotMatch(log, /\bwrangler deploy --/u);
});

test("existing upgrade requires the configured secret binding without exposing its value", async (t) => {
  const harness = await createHarness(t, { secretState: "missing" });
  const result = await inspectExisting(harness);
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /INITIAL_ADMIN_CODE/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("active Worker versions with different resource bindings fail before migration", async (t) => {
  const harness = await createHarness(t, {
    versionsJson: '[{"version_id":"version-live","percentage":50},{"version_id":"version-two","percentage":50}]',
    secondRemoteDbId: "db-other",
  });
  const result = await inspectExisting(harness);
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version-two|DB|active Worker versions/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("active Worker versions with different optional secret names fail before migration", async (t) => {
  const harness = await createHarness(t, {
    versionsJson: '[{"version_id":"version-live","percentage":50},{"version_id":"version-two","percentage":50}]',
    optionalSecretState: "present",
    secondOptionalSecretState: "missing",
  });
  const result = await inspectExisting(harness);
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /active Worker versions|秘密 binding/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /super-secret-marker|upload-secret-marker/u);
  assert.doesNotMatch(log, /d1 migrations|\bwrangler deploy --/u);
});

test("D1 migrations list permission failure always fails closed before deploy", async (t) => {
  const harness = await createHarness(t, { listResult: "permission" });
  const fingerprintPath = await captureFingerprint(harness);
  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /list|pending|关闭部署/u);
  assert.doesNotMatch(log, /d1 migrations apply|\bwrangler deploy --/u);
});

test("D1 permission failure may deploy only when every pending migration is runtime-safe", async (t) => {
  const harness = await createHarness(t, {
    pendingMigrations: "0006_auth_v2.sql\n0007_legacy_media_and_access_state.sql",
    applyResult: "permission",
  });
  const fingerprintPath = await captureFingerprint(harness);
  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /runtime bootstrap|运行时自举/u);
  assert.equal((log.match(/\bwrangler deploy --/gu) ?? []).length, 1);
});

test("unknown pending migration fails closed on a D1 permission error", async (t) => {
  const harness = await createHarness(t, {
    pendingMigrations: "0006_auth_v2.sql\n0008_unknown.sql",
    applyResult: "permission",
  });
  const fingerprintPath = await captureFingerprint(harness);
  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /0008_unknown\.sql|not runtime-safe|未声明/u);
  assert.doesNotMatch(log, /\bwrangler deploy --/u);
});

test("a runtime-safe migration with a changed contract digest fails closed", async (t) => {
  const harness = await createHarness(t, {
    pendingMigrations: "0007_legacy_media_and_access_state.sql",
    applyResult: "permission",
  });
  await writeFile(
    join(harness.root, "drizzle", "0007_legacy_media_and_access_state.sql"),
    `${fakeConvergenceMigration}CREATE INDEX IF NOT EXISTS unexpected_idx ON legacy_media_migrations (id);\n`,
  );
  const fingerprintPath = await captureFingerprint(harness);
  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /0007_legacy_media_and_access_state\.sql|SHA-256|部署契约/u);
  assert.doesNotMatch(log, /\bwrangler deploy --/u);
});

test("non-permission migration errors fail closed even for runtime-safe migrations", async (t) => {
  const harness = await createHarness(t, { applyResult: "sql" });
  const fingerprintPath = await captureFingerprint(harness);
  const result = await runDeploy(harness, ["--fingerprint", fingerprintPath], "upgrade");
  const log = await readLog(harness);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SQLITE_ERROR/u);
  assert.doesNotMatch(log, /\bwrangler deploy --/u);
});

function extractReleaseTagShell(workflow) {
  const stepMarker = "      - name: Create the release tag once\n";
  const stepOffset = workflow.indexOf(stepMarker);
  assert.notEqual(stepOffset, -1, "release tag step is missing");
  const step = workflow.slice(stepOffset);
  const runMarker = "        run: |\n";
  const runOffset = step.indexOf(runMarker);
  assert.notEqual(runOffset, -1, "release tag shell is missing");
  return step
    .slice(runOffset + runMarker.length)
    .split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n");
}

async function runConcurrentTagScenario(t, remoteTarget) {
  const root = await mkdtemp(join(tmpdir(), "portfolio-release-tag-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const statePath = join(root, "tag-ls-remote-count");
  await mkdir(bin);
  await writeFile(statePath, "0\n");
  const fakeGit = join(bin, "git");
  await writeFile(fakeGit, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "rev-parse" && "$2" == "HEAD" ]]; then
  printf '%s\\n' "$GITHUB_SHA"
  exit 0
fi
if [[ "$1" == "ls-remote" && "$*" == *"refs/heads/main"* ]]; then
  printf '%s\\trefs/heads/main\\n' "$GITHUB_SHA"
  exit 0
fi
if [[ "$1" == "ls-remote" && "$*" == *"refs/tags/"* ]]; then
  count="$(<"$FAKE_GIT_STATE")"
  printf '%s\\n' "$((count + 1))" > "$FAKE_GIT_STATE"
  if [[ "$count" == "0" ]]; then
    exit 2
  fi
  printf 'annotated-tag-object\\trefs/tags/%s\\n' "$RELEASE_TAG"
  printf '%s\\trefs/tags/%s^{}\\n' "$FAKE_RACE_TARGET" "$RELEASE_TAG"
  exit 0
fi
if [[ "$1" == "config" || "$1" == "tag" ]]; then
  exit 0
fi
if [[ "$1" == "push" ]]; then
  exit 1
fi
printf 'unexpected fake git command: %s\\n' "$*" >&2
exit 64
`);
  await chmod(fakeGit, 0o755);

  const workflow = await readFile(".github/workflows/release-verify.yml", "utf8");
  const shell = extractReleaseTagShell(workflow);
  try {
    const result = await execFileAsync("bash", [
      "--noprofile",
      "--norc",
      "-e",
      "-o",
      "pipefail",
      "-c",
      shell,
    ], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_GIT_STATE: statePath,
        FAKE_RACE_TARGET: remoteTarget,
        GITHUB_SHA: "verified-main-sha",
        RELEASE_TAG: "v1.2.1",
      },
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      status: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

test("a concurrent release tag succeeds only when its peeled target is the verified SHA", async (t) => {
  const sameTarget = await runConcurrentTagScenario(t, "verified-main-sha");
  assert.equal(sameTarget.status, 0, sameTarget.stderr);
  assert.match(sameTarget.stdout, /created concurrently at the verified commit/u);

  const differentTarget = await runConcurrentTagScenario(t, "different-main-sha");
  assert.notEqual(differentTarget.status, 0);
  assert.match(differentTarget.stderr, /different target|refusing/u);
});
