import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { env } = await import("cloudflare:workers");
const { PROGRAM_VERSION, RECOMMENDED_INITIAL_ADMIN_CODE } = await import("../app/lib/program-version.ts");
const { normalizePassword, programResetRequired } = await import("../app/api/_lib/admin-auth.ts");

test("new administrator credentials no longer depend on the public setup code", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = RECOMMENDED_INITIAL_ADMIN_CODE;

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const password = "StudentOwner2026!";
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: RECOMMENDED_INITIAL_ADMIN_CODE,
    password,
  }));
  assert.equal(setup.status, 201);
  const row = database.prepare("SELECT auth_version, confirmed_program_version FROM admin_credentials WHERE id = 'default'").get();
  assert.equal(row.auth_version, 2);
  assert.equal(row.confirmed_program_version, PROGRAM_VERSION);

  env.INITIAL_ADMIN_CODE = "AnotherSetupCode2026";
  const login = await loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", { password }));
  assert.equal(login.status, 200);
  const setupCodeLogin = await loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", { password: env.INITIAL_ADMIN_CODE }));
  assert.equal(setupCodeLogin.status, 401);
  resetEnv();
});

test("legacy recovery migrates credentials and survives later setup-code changes", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "LegacyStudentCode2026";
  const recoveryCode = "REC-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ";
  const passwordSalt = "legacy-password-salt";
  const recoverySalt = "legacy-recovery-salt";
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO admin_credentials (
    id, password_hash, password_salt, recovery_hash, recovery_salt,
    auth_version, confirmed_program_version, failed_attempts, initialized_at,
    password_changed_at, recovery_code_created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?, ?)`)
    .run(
      "default",
      await legacyHash("password", "OldPassword2026", passwordSalt, env.INITIAL_ADMIN_CODE),
      passwordSalt,
      await legacyHash("recovery", normalizeRecovery(recoveryCode), recoverySalt, env.INITIAL_ADMIN_CODE),
      recoverySalt,
      "1.0.0",
      now,
      now,
      now,
      now,
    );

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const recoverRoute = await import("../app/api/admin/recover/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const before = await setupRoute.GET(new Request("https://portfolio.example/api/admin/setup"));
  assert.equal(before.status, 200);
  assert.equal((await before.json()).state, "upgrade_required");

  const recovered = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
    recoveryCode,
    password: "MigratedPassword2026!",
  }));
  assert.equal(recovered.status, 200);
  const nextRecovery = (await recovered.json()).recoveryCode;
  assert.notEqual(nextRecovery, recoveryCode);
  const migrated = database.prepare("SELECT auth_version, confirmed_program_version FROM admin_credentials WHERE id = 'default'").get();
  assert.equal(migrated.auth_version, 2);
  assert.equal(migrated.confirmed_program_version, PROGRAM_VERSION);

  env.INITIAL_ADMIN_CODE = "ChangedAfterMigration2026";
  const login = await loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", { password: "MigratedPassword2026!" }));
  assert.equal(login.status, 200);
  const reused = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
    recoveryCode,
    password: "AnotherPassword2026!",
  }));
  assert.equal(reused.status, 401);
  resetEnv();
});

test("version changes require one recovery reset and password validation rejects hidden mistakes", () => {
  assert.equal(programResetRequired(PROGRAM_VERSION), false);
  assert.equal(programResetRequired("1.0.0"), true);
  assert.throws(() => normalizePassword(" Student2026"), /开头和结尾不能有空格/u);
  assert.throws(() => normalizePassword("Student\u200b2026"), /不可见字符/u);
  assert.equal(normalizePassword("学生Password2026"), "学生Password2026");
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
    "0006_auth_v2_runtime_secrets.sql",
  ]) {
    const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    database.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

function jsonRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function legacyHash(purpose, value, salt, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v1\n${purpose}\n${salt}\n${value}`));
  return base64Url(new Uint8Array(digest));
}

function normalizeRecovery(value) {
  return value.trim().toUpperCase().replaceAll(/[^A-Z0-9]/gu, "");
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
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
