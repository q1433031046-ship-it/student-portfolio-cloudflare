import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { env } = await import("cloudflare:workers");
const { FIXED_INITIAL_ADMIN_CODE, PROGRAM_VERSION } = await import("../app/program-version.ts");
const { validatePassword } = await import("../app/api/_lib/admin-auth.ts");

test("new administrators use the fixed setup code and remain valid without it", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = FIXED_INITIAL_ADMIN_CODE;

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const password = randomPassword("New");

  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: FIXED_INITIAL_ADMIN_CODE,
    password,
  }));
  assert.equal(setup.status, 201);
  const recoveryCode = (await setup.json()).recoveryCode;
  assert.match(recoveryCode, /^REC-/u);

  delete env.INITIAL_ADMIN_CODE;
  const login = await loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", { password }));
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/u);

  const row = database.prepare("SELECT auth_scheme, security_version FROM admin_credentials WHERE id = 'default'").get();
  assert.equal(row.auth_scheme, "v2");
  assert.equal(row.security_version, PROGRAM_VERSION);
  resetEnv();
});

test("legacy credentials require the latest recovery code once and migrate to v2", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = randomPassword("LegacyCode");

  const oldPassword = randomPassword("Old");
  const newPassword = randomPassword("New");
  const recoveryCode = "REC-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ";
  const passwordSalt = "legacy-password-salt";
  const recoverySalt = "legacy-recovery-salt";
  const passwordHash = await legacyHash("password", oldPassword, passwordSalt, env.INITIAL_ADMIN_CODE);
  const recoveryHash = await legacyHash("recovery", normalizeRecoveryCode(recoveryCode), recoverySalt, env.INITIAL_ADMIN_CODE);
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO admin_credentials (
    id, password_hash, password_salt, recovery_hash, recovery_salt, failed_attempts,
    initialized_at, password_changed_at, recovery_code_created_at, updated_at,
    auth_scheme, security_version
  ) VALUES ('default', ?, ?, ?, ?, 0, ?, ?, ?, ?, 'v1', 'legacy')`)
    .run(passwordHash, passwordSalt, recoveryHash, recoverySalt, now, now, now, now);

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const recoverRoute = await import("../app/api/admin/recover/route.ts");

  const state = await setupRoute.GET(new Request("https://portfolio.example/api/admin/setup"));
  assert.equal(state.status, 200);
  assert.deepEqual(await state.json(), {
    state: "password_reset_required",
    currentVersion: PROGRAM_VERSION,
    identity: null,
  });

  const blockedLogin = await loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", { password: oldPassword }));
  assert.equal(blockedLogin.status, 428);
  assert.equal((await blockedLogin.json()).code, "PASSWORD_RESET_REQUIRED");

  const reset = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
    recoveryCode,
    password: newPassword,
  }));
  assert.equal(reset.status, 200);
  const nextRecoveryCode = (await reset.json()).recoveryCode;
  assert.notEqual(nextRecoveryCode, recoveryCode);

  delete env.INITIAL_ADMIN_CODE;
  const login = await loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", { password: newPassword }));
  assert.equal(login.status, 200);
  const row = database.prepare("SELECT auth_scheme, security_version FROM admin_credentials WHERE id = 'default'").get();
  assert.equal(row.auth_scheme, "v2");
  assert.equal(row.security_version, PROGRAM_VERSION);
  resetEnv();
});

test("password rules reject accidental surrounding spaces and invisible characters", () => {
  assert.throws(() => validatePassword(" Student2026A"), /开头和结尾不能有空格/u);
  assert.throws(() => validatePassword("Student2026A\u200b"), /隐藏字符/u);
  assert.throws(() => validatePassword("Student2026A\n"), /空格|隐藏字符/u);
  assert.doesNotThrow(() => validatePassword("Student2026A"));
});

test("administrator UI has timeout recovery and a dedicated version-reset screen", async () => {
  const client = await readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8");
  assert.match(client, /password_reset_required/u);
  assert.match(client, /upgrade_reset/u);
  assert.match(client, /REQUEST_TIMEOUT/u);
  assert.match(client, /confirmAdminSession/u);
  assert.match(client, /FIXED_INITIAL_ADMIN_CODE/u);
  assert.match(client, /旧恢复码已经失效/u);
});

async function createDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const name of [
    "0000_bumpy_ultimo.sql",
    "0001_perpetual_firestar.sql",
    "0002_nosy_silhouette.sql",
    "0003_careful_justice.sql",
    "0004_owner_email_onboarding.sql",
    "0005_password_auth_kv_media.sql",
    "0006_authentication_v2.sql",
  ]) {
    const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    database.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

async function legacyHash(purpose, value, salt, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v1\n${purpose}\n${salt}\n${value}`),
  );
  return base64Url(new Uint8Array(digest));
}

function normalizeRecoveryCode(value) {
  return value.trim().toUpperCase().replaceAll(/[^A-Z0-9]/gu, "");
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function jsonRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function randomPassword(prefix) {
  return `${prefix}${crypto.randomUUID().replaceAll("-", "")}9`;
}

function resetEnv() {
  delete env.DB;
  delete env.AUTH_PLATFORM;
  delete env.INITIAL_ADMIN_CODE;
}

function d1Adapter(database) {
  return {
    prepare(sql) {
      return new SqliteD1Statement(database, sql);
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

class SqliteD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) {
    return new SqliteD1Statement(this.database, this.sql, values);
  }
  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.values), meta: { changes: 0 } };
  }
}
