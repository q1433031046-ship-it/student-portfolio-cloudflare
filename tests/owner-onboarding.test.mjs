import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { env } = await import("cloudflare:workers");

test("initializes password access once and keeps management APIs locked", async () => {
  const deploymentCode = randomTestValue("D");
  const password = randomTestValue("P");
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = deploymentCode;

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const portfolioRoute = await import("../app/api/admin/portfolio/route.ts");
  const initial = await setupRoute.GET(new Request("https://portfolio.example/api/admin/setup"));
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).state, "initial_setup");

  const locked = await portfolioRoute.GET(new Request("https://portfolio.example/api/admin/portfolio"));
  assert.equal(locked.status, 401);

  const wrongCode = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: randomTestValue("W"),
    password,
  }));
  assert.equal(wrongCode.status, 401);

  const completed = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password,
  }));
  assert.equal(completed.status, 201);
  const completedBody = await completed.json();
  assert.equal(completedBody.state, "recovery_code");
  assert.match(completedBody.recoveryCode, /^REC-(?:[A-Z2-9]{4}-){5}[A-Z2-9]{4}$/u);
  const cookie = completed.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Strict/u);

  const unlocked = await portfolioRoute.GET(new Request("https://portfolio.example/api/admin/portfolio", {
    headers: { Cookie: cookie },
  }));
  assert.equal(unlocked.status, 200);
  assert.equal((await unlocked.json()).identity.provider, "password");

  const deploymentCodeLogin = await loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", {
    password: deploymentCode,
  }));
  assert.equal(deploymentCodeLogin.status, 401);

  const duplicate = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: randomTestValue("A"),
  }));
  assert.equal(duplicate.status, 409);
  resetEnv();
});

test("recovers a password once, rotates the recovery code and revokes old sessions", async () => {
  const deploymentCode = randomTestValue("D");
  const oldPasswordValue = randomTestValue("P");
  const newPasswordValue = randomTestValue("N");
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = deploymentCode;

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const loginRoute = await import("../app/api/admin/login/route.ts");
  const recoverRoute = await import("../app/api/admin/recover/route.ts");
  const portfolioRoute = await import("../app/api/admin/portfolio/route.ts");

  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: oldPasswordValue,
  }));
  const firstCookie = setup.headers.get("set-cookie");
  const firstRecoveryCode = (await setup.json()).recoveryCode;

  const recovered = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
    recoveryCode: firstRecoveryCode,
    password: newPasswordValue,
  }));
  assert.equal(recovered.status, 200);
  const nextRecoveryCode = (await recovered.json()).recoveryCode;
  assert.notEqual(nextRecoveryCode, firstRecoveryCode);

  const revoked = await portfolioRoute.GET(new Request("https://portfolio.example/api/admin/portfolio", {
    headers: { Cookie: firstCookie },
  }));
  assert.equal(revoked.status, 401);

  const oldPassword = await loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", { password: oldPasswordValue }));
  assert.equal(oldPassword.status, 401);
  const newPassword = await loginRoute.POST(jsonRequest("https://portfolio.example/api/admin/login", { password: newPasswordValue }));
  assert.equal(newPassword.status, 200);

  const reusedRecovery = await recoverRoute.POST(jsonRequest("https://portfolio.example/api/admin/recover", {
    recoveryCode: firstRecoveryCode,
    password: randomTestValue("T"),
  }));
  assert.equal(reusedRecovery.status, 401);
  resetEnv();
});

test("admin UI exposes deployment-code setup, recovery and website-space status", async () => {
  const [adminClient, setupRoute, portfolioRoute, accessRoute, mediaRoute] = await Promise.all([
    readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/setup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/portfolio/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/access/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/media/[projectId]/[slot]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(adminClient, /一次性部署口令/u);
  assert.match(adminClient, /管理员密码/u);
  assert.match(adminClient, /系统恢复码/u);
  assert.match(adminClient, /网站空间/u);
  assert.match(setupRoute, /createLocalAdministrator/u);
  assert.match(portfolioRoute, /requirePortfolioManager/u);
  assert.match(accessRoute, /requirePortfolioManager/u);
  assert.match(mediaRoute, /requirePortfolioManager/u);
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

function randomTestValue(prefix) {
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
