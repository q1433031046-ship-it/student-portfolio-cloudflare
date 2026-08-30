import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { env } = await import("cloudflare:workers");
const { PROGRAM_VERSION } = await import("../app/lib/program-version.ts");
const { normalizePassword, programResetRequired } = await import("../app/api/_lib/admin-auth.ts");

test("new administrator credentials and sessions no longer depend on the initial deployment code", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "InitialStudentCode2026";

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const portfolioRoute = await import("../app/api/admin/portfolio/route.ts");
  const password = "StudentOwner2026!";
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password,
  }));
  assert.equal(setup.status, 201);
  const setupCookie = setup.headers.get("set-cookie");
  const row = database.prepare("SELECT auth_version, confirmed_program_version FROM admin_auth_state WHERE id = 'default'").get();
  assert.equal(row.auth_version, 2);
  assert.equal(row.confirmed_program_version, PROGRAM_VERSION);

  delete env.INITIAL_ADMIN_CODE;
  const existingSession = await portfolioRoute.GET(new Request("https://portfolio.example/api/admin/portfolio", {
    headers: { Cookie: setupCookie },
  }));
  assert.equal(existingSession.status, 200);
  const login = await loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", { password }));
  assert.equal(login.status, 200);
  resetEnv();
});

test("legacy recovery performs the one-time version confirmation and rotates the recovery code", async () => {
  const database = await createDatabase({ includeAuthMigration: false });
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "LegacyStudentCode2026";
  const recoveryCode = "REC-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ";
  const passwordSalt = "legacy-password-salt";
  const recoverySalt = "legacy-recovery-salt";
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO admin_credentials (
    id, password_hash, password_salt, recovery_hash, recovery_salt,
    failed_attempts, initialized_at,
    password_changed_at, recovery_code_created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
    .run(
      "default",
      await legacyHash("password", "OldPassword2026", passwordSalt, env.INITIAL_ADMIN_CODE),
      passwordSalt,
      await legacyHash("recovery", normalizeRecovery(recoveryCode), recoverySalt, env.INITIAL_ADMIN_CODE),
      recoverySalt,
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

  const reusedDeploymentCode = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
    recoveryCode,
    password: env.INITIAL_ADMIN_CODE,
  }));
  assert.equal(reusedDeploymentCode.status, 400);

  const recovered = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
    recoveryCode,
    password: "MigratedPassword2026!",
  }));
  assert.equal(recovered.status, 200);
  const nextRecovery = (await recovered.json()).recoveryCode;
  assert.notEqual(nextRecovery, recoveryCode);
  const migrated = database.prepare("SELECT auth_version, confirmed_program_version FROM admin_auth_state WHERE id = 'default'").get();
  assert.equal(migrated.auth_version, 2);
  assert.equal(migrated.confirmed_program_version, PROGRAM_VERSION);
  const authMigration = await readFile(new URL("../drizzle/0006_auth_v2.sql", import.meta.url), "utf8");
  assert.doesNotThrow(() => database.exec(authMigration.replaceAll("--> statement-breakpoint", "")));

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

test("version gate and password normalization reject hidden input mistakes", () => {
  assert.equal(programResetRequired(PROGRAM_VERSION), false);
  assert.equal(programResetRequired("1.1.6"), true);
  assert.equal(programResetRequired("1.3.0", "1.3.0"), false);
  assert.equal(programResetRequired("1.2.0", "1.3.0"), true);
  assert.equal(programResetRequired("1.2.1", "1.3.0"), true);
  assert.throws(() => normalizePassword(" Student2026"), /开头和结尾不能有空格/u);
  assert.throws(() => normalizePassword("Student\u200b2026"), /不可见字符/u);
  assert.equal(normalizePassword("学生Password2026"), "学生Password2026");
});

test("atomically locks only the matching Cloudflare client network after concurrent wrong passwords", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "ConcurrentSetupCode2026";

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const password = "ConcurrentOwner2026";
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password,
  }));
  assert.equal(setup.status, 201);

  const lockedNetwork = "203.0.113.10";
  const attempts = await Promise.all(Array.from({ length: 20 }, (_, index) => loginRoute.POST(
    jsonRequest(
      "https://portfolio.example/api/admin/login",
      { password: `WrongConcurrent${index}9` },
      { "cf-connecting-ip": lockedNetwork },
    ),
  )));
  assert.equal(attempts.every((response) => response.status === 401 || response.status === 429), true);

  const throttle = database.prepare("SELECT bucket_key, failed_attempts, locked_until FROM admin_login_throttle").all();
  assert.equal(throttle.length, 1);
  assert.match(throttle[0].bucket_key, /^b1-[a-f0-9]{3}$/u);
  assert.equal(throttle[0].failed_attempts, 0);
  assert.equal(Date.parse(throttle[0].locked_until) > Date.now(), true);
  const correctWhileLocked = await loginRoute.POST(jsonRequest(
    "https://portfolio.example/api/admin/login",
    { password },
    { "cf-connecting-ip": lockedNetwork },
  ));
  assert.equal(correctWhileLocked.status, 429);

  const passwordHash = database.prepare("SELECT password_hash FROM admin_credentials WHERE id = 'default'").get().password_hash;
  const otherNetwork = await findNetworkInDifferentBucket(passwordHash, throttle[0].bucket_key);
  assert.equal((await loginRoute.POST(jsonRequest(
    "https://portfolio.example/api/admin/login",
    { password: "OtherNetworkWrong2026" },
    { "cf-connecting-ip": otherNetwork },
  ))).status, 401);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM admin_login_throttle").get().count, 2);
  const correctFromOtherNetwork = await loginRoute.POST(jsonRequest(
    "https://portfolio.example/api/admin/login",
    { password },
    { "cf-connecting-ip": otherNetwork },
  ));
  assert.equal(correctFromOtherNetwork.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM admin_login_throttle").get().count, 1);
  assert.equal(database.prepare("SELECT bucket_key FROM admin_login_throttle LIMIT 1").get().bucket_key, throttle[0].bucket_key);
  resetEnv();
});

test("a correct recovery code bypasses a locked password network and clears every throttle bucket", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "RecoveryBypassSetup2026";

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const recoverRoute = await import("../app/api/admin/recover/route.ts");
  const oldPassword = "RecoveryBypassOld2026";
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: oldPassword,
  }));
  assert.equal(setup.status, 201);
  const recoveryCode = (await setup.json()).recoveryCode;
  const network = { "cf-connecting-ip": "203.0.113.40" };

  const failures = await Promise.all(Array.from({ length: 8 }, (_, index) => loginRoute.POST(jsonRequest(
    "https://portfolio.example/api/admin/login",
    { password: `RecoveryBypassWrong${index}9` },
    network,
  ))));
  assert.equal(failures.every((response) => response.status === 401 || response.status === 429), true);
  assert.equal((await loginRoute.POST(jsonRequest(
    "https://portfolio.example/api/admin/login",
    { password: oldPassword },
    network,
  ))).status, 429);

  const recovered = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
    recoveryCode,
    password: "RecoveryBypassNew2026",
  }, network));
  assert.equal(recovered.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM admin_login_throttle").get().count, 0);
  assert.equal((await loginRoute.POST(jsonRequest(
    "https://portfolio.example/api/admin/login",
    { password: "RecoveryBypassNew2026" },
    network,
  ))).status, 200);
  resetEnv();
});

test("wrong recovery codes never charge or lock password login", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "RecoveryIsolationSetup2026";

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const recoverRoute = await import("../app/api/admin/recover/route.ts");
  const password = "RecoveryIsolationOwner2026";
  assert.equal((await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password,
  }))).status, 201);
  const network = { "cf-connecting-ip": "198.51.100.70" };

  for (let index = 0; index < 8; index += 1) {
    const response = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
      recoveryCode: `REC-WRNG-WRNG-WRNG-WRNG-WRNG-${String(index).padStart(4, "0")}`,
      password: `RecoveryIsolationNext${index}9`,
    }, network));
    assert.equal(response.status, 401);
  }
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM admin_login_throttle").get().count, 0);
  assert.equal((await loginRoute.POST(jsonRequest(
    "https://portfolio.example/api/admin/login",
    { password },
    network,
  ))).status, 200);
  resetEnv();
});

test("recovers v2 credentials without the initial deployment code", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "IndependentSetupCode2026";

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const recoverRoute = await import("../app/api/admin/recover/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "OriginalOwner2026",
  }));
  assert.equal(setup.status, 201);
  const recoveryCode = (await setup.json()).recoveryCode;

  delete env.INITIAL_ADMIN_CODE;
  const recovered = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
    recoveryCode,
    password: "IndependentOwner2026",
  }));
  assert.equal(recovered.status, 200);
  assert.match((await recovered.json()).recoveryCode, /^REC-(?:[A-Z2-9]{4}-){5}[A-Z2-9]{4}$/u);
  const login = await loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", {
    password: "IndependentOwner2026",
  }));
  assert.equal(login.status, 200);
  resetEnv();
});

test("allows exactly one concurrent rotation of a recovery code", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "RecoveryRaceSetup2026";

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const recoverRoute = await import("../app/api/admin/recover/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "BeforeRecoveryRace2026",
  }));
  assert.equal(setup.status, 201);
  const recoveryCode = (await setup.json()).recoveryCode;
  const passwords = ["RecoveryWinnerA2026", "RecoveryWinnerB2026"];

  const responses = await Promise.all(passwords.map((password) => recoverRoute.POST(
    jsonRequest("https://portfolio.example/api/admin/recover", { recoveryCode, password }),
  )));
  assert.deepEqual(responses.map((response) => response.status).sort((left, right) => left - right), [200, 401]);
  const winnerIndex = responses.findIndex((response) => response.status === 200);
  const winnerBody = await responses[winnerIndex].json();
  assert.match(winnerBody.recoveryCode, /^REC-(?:[A-Z2-9]{4}-){5}[A-Z2-9]{4}$/u);
  assert.deepEqual(await responses[1 - winnerIndex].json(), { error: "系统恢复码不正确" });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get().count, 1);

  const loginStatuses = await Promise.all(passwords.map((password) => loginRoute.POST(
    jsonRequest("https://portfolio.example/api/admin/login", { password }),
  ).then((response) => response.status)));
  assert.equal(loginStatuses[winnerIndex], 200);
  assert.equal(loginStatuses[1 - winnerIndex], 401);
  resetEnv();
});

test("does not create an old-password session after concurrent recovery", async () => {
  const database = await createDatabase();
  const gate = createSqlGate((sql) => /UPDATE admin_credentials SET\s+failed_attempts = 0, locked_until = NULL/u.test(sql));
  env.DB = d1Adapter(database, gate);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "LoginRaceSetupCode2026";

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const recoverRoute = await import("../app/api/admin/recover/route.ts");
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "LoginRaceOldPassword2026",
  }));
  assert.equal(setup.status, 201);
  const recoveryCode = (await setup.json()).recoveryCode;

  gate.arm();
  const staleLoginPromise = loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", {
    password: "LoginRaceOldPassword2026",
  }));
  await gate.reached;
  try {
    const recovered = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
      recoveryCode,
      password: "LoginRaceNewPassword2026",
    }));
    assert.equal(recovered.status, 200);
  } finally {
    gate.release();
  }

  const staleLogin = await staleLoginPromise;
  assert.equal(staleLogin.status, 401);
  assert.deepEqual(await staleLogin.json(), { error: "管理员密码不正确" });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get().count, 1);
  resetEnv();
});

test("does not charge a rotated credential for an in-flight wrong password", async () => {
  const database = await createDatabase();
  const gate = createSqlGate((sql) => sql.includes("INSERT INTO admin_login_throttle"));
  env.DB = d1Adapter(database, gate);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "FailureRaceSetupCode2026";

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const recoverRoute = await import("../app/api/admin/recover/route.ts");
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "FailureRaceOldPassword2026",
  }));
  assert.equal(setup.status, 201);
  const recoveryCode = (await setup.json()).recoveryCode;

  gate.arm();
  const staleFailurePromise = loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", {
    password: "FailureRaceWrongPassword2026",
  }));
  await gate.reached;
  try {
    const recovered = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
      recoveryCode,
      password: "FailureRaceNewPassword2026",
    }));
    assert.equal(recovered.status, 200);
  } finally {
    gate.release();
  }

  const staleFailure = await staleFailurePromise;
  assert.equal(staleFailure.status, 401);
  assert.deepEqual(await staleFailure.json(), { error: "管理员密码不正确" });
  const state = database.prepare("SELECT failed_attempts, locked_until FROM admin_credentials WHERE id = 'default'").get();
  assert.equal(state.failed_attempts, 0);
  assert.equal(state.locked_until, null);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM admin_login_throttle").get().count, 0);
  resetEnv();
});

async function createDatabase({ includeAuthMigration = true } = {}) {
  const database = new DatabaseSync(":memory:");
  const migrations = [
    "0000_bumpy_ultimo.sql",
    "0001_perpetual_firestar.sql",
    "0002_nosy_silhouette.sql",
    "0003_careful_justice.sql",
    "0004_owner_email_onboarding.sql",
    "0005_password_auth_kv_media.sql",
    "0006_auth_v2.sql",
  ];
  for (const name of includeAuthMigration ? migrations : migrations.slice(0, -1)) {
    const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    database.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

function jsonRequest(url, body, headers = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function findNetworkInDifferentBucket(passwordHash, excludedBucket) {
  for (let index = 1; index <= 4096; index += 1) {
    const network = `198.51.${Math.floor(index / 256)}.${index % 256}`;
    if (await expectedNetworkBucket(passwordHash, network) !== excludedBucket) return network;
  }
  throw new Error("unable to find an isolated login network bucket");
}

async function expectedNetworkBucket(passwordHash, network) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`admin-login-throttle\nv1\n${passwordHash}\n${network}`),
  ));
  const bucket = ((digest[0] << 8) | digest[1]) & 0x0fff;
  return `b1-${bucket.toString(16).padStart(3, "0")}`;
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

function d1Adapter(database, controls = {}) {
  return {
    prepare(sql) { return new SqliteD1Statement(database, sql, [], controls); },
    async batch(statements) {
      await controls.beforeBatch?.(statements);
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
  constructor(database, sql, values = [], controls = {}) {
    this.database = database;
    this.sql = sql;
    this.values = values;
    this.controls = controls;
  }
  bind(...values) { return new SqliteD1Statement(this.database, this.sql, values, this.controls); }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
  async run() {
    await this.controls.beforeRun?.(this.sql);
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async all() { return { success: true, results: this.database.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
}

function createSqlGate(predicate) {
  let armed = false;
  let signalReached;
  let releaseGate;
  const reached = new Promise((resolve) => { signalReached = resolve; });
  const released = new Promise((resolve) => { releaseGate = resolve; });
  async function pauseIfMatched(statements) {
    if (!armed || !statements.some((statement) => predicate(statement.sql ?? statement))) return;
    armed = false;
    signalReached();
    await released;
  }
  return {
    reached,
    arm() { armed = true; },
    release() { releaseGate(); },
    beforeBatch(statements) { return pauseIfMatched(statements); },
    beforeRun(sql) { return pauseIfMatched([sql]); },
  };
}
