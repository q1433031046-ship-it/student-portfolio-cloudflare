import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { env } = await import("cloudflare:workers");

test("requires an explicit administrator allowlist on Cloudflare", async () => {
  const { isAllowedAdmin } = await import("../app/api/_lib/auth.ts");
  assert.equal(isAllowedAdmin({ kind: "cloudflare-access", user: "owner@example.com" }), false);
  assert.equal(isAllowedAdmin({ kind: "cloudflare-access", user: "owner@example.com" }, "owner@example.com"), true);
  assert.equal(isAllowedAdmin({ kind: "cloudflare-access", user: "other@example.com" }, "owner@example.com"), false);
  assert.equal(isAllowedAdmin({ kind: "sites", user: "owner@example.com" }), true);
});

test("creates one immutable site owner and records onboarding mail delivery", async () => {
  const migration = await readFile(new URL("../drizzle/0004_owner_email_onboarding.sql", import.meta.url), "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec(migration.replaceAll("--> statement-breakpoint", ""));

  db.prepare("INSERT INTO site_ownership (id, owner_email, auth_provider, bound_at) VALUES (?, ?, ?, ?)")
    .run("default", "owner@example.com", "cloudflare-access", "2026-08-28T00:00:00.000Z");
  assert.throws(
    () => db.prepare("UPDATE site_ownership SET owner_email = ? WHERE id = ?").run("other@example.com", "default"),
    /owner email is immutable/u,
  );
  db.prepare("UPDATE site_ownership SET onboarding_email_sent_at = ?, onboarding_email_id = ? WHERE id = ?")
    .run("2026-08-28T00:01:00.000Z", "mail_123", "default");
  assert.deepEqual(
    { ...db.prepare("SELECT owner_email, onboarding_email_sent_at, onboarding_email_id FROM site_ownership WHERE id = ?").get("default") },
    {
      owner_email: "owner@example.com",
      onboarding_email_sent_at: "2026-08-28T00:01:00.000Z",
      onboarding_email_id: "mail_123",
    },
  );
});

test("builds a permanent same-origin admin link email and escapes display content", async () => {
  const { buildAdminLinkEmail } = await import("../app/api/_lib/onboarding-email.ts");
  const message = buildAdminLinkEmail({
    to: "owner@example.com",
    origin: "https://portfolio.example/path?ignored=1",
    siteTitle: "作品 <站点>",
    from: "后台通知 <admin@example.com>",
  });

  assert.equal(message.to, "owner@example.com");
  assert.equal(message.from, "后台通知 <admin@example.com>");
  assert.equal(message.subject, "你的作品网站后台入口");
  assert.match(message.text, /https:\/\/portfolio\.example\/admin/u);
  assert.match(message.html, /href="https:\/\/portfolio\.example\/admin"/u);
  assert.match(message.html, /作品 &lt;站点&gt;/u);
  assert.doesNotMatch(message.html, /作品 <站点>/u);
});

test("sends onboarding mail only through configured Cloudflare bindings", async () => {
  const { sendAdminLinkEmail } = await import("../app/api/_lib/onboarding-email.ts");
  delete env.EMAIL;
  delete env.ADMIN_EMAIL_FROM;
  await assert.rejects(
    sendAdminLinkEmail({ to: "owner@example.com", origin: "https://portfolio.example", siteTitle: "作品站" }),
    /邮件发送尚未配置/u,
  );

  let sent;
  env.ADMIN_EMAIL_FROM = "admin@example.com";
  env.EMAIL = {
    async send(message) {
      sent = message;
      return { messageId: "mail_123" };
    },
  };
  assert.deepEqual(
    await sendAdminLinkEmail({ to: "owner@example.com", origin: "https://portfolio.example", siteTitle: "作品站" }),
    { messageId: "mail_123" },
  );
  assert.equal(sent.to, "owner@example.com");
  assert.equal(sent.from, "admin@example.com");
  delete env.EMAIL;
  delete env.ADMIN_EMAIL_FROM;
});

test("keeps every management API locked until verified binding and email delivery finish", async () => {
  const database = new DatabaseSync(":memory:");
  for (const name of [
    "0000_bumpy_ultimo.sql",
    "0001_perpetual_firestar.sql",
    "0002_nosy_silhouette.sql",
    "0003_careful_justice.sql",
    "0004_owner_email_onboarding.sql",
  ]) {
    const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    database.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "sites";
  env.ADMIN_EMAIL_FROM = "admin@example.com";
  env.EMAIL = { async send() { return { messageId: "mail_setup_1" }; } };

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const portfolioRoute = await import("../app/api/admin/portfolio/route.ts");
  const headers = { "oai-authenticated-user-email": "owner@example.com" };

  const initial = await setupRoute.GET(new Request("https://portfolio.example/api/admin/setup", { headers }));
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).state, "unbound");

  const locked = await portfolioRoute.GET(new Request("https://portfolio.example/api/admin/portfolio", { headers }));
  assert.equal(locked.status, 428);

  const completed = await setupRoute.POST(new Request("https://portfolio.example/api/admin/setup", { method: "POST", headers }));
  assert.equal(completed.status, 200);
  const completedBody = await completed.json();
  assert.equal(completedBody.state, "ready");
  assert.equal(completedBody.email, "owner@example.com");
  assert.match(completedBody.boundAt, /^2026-|^20\d{2}-/u);
  assert.match(completedBody.onboardingEmailSentAt, /^2026-|^20\d{2}-/u);

  const unlocked = await portfolioRoute.GET(new Request("https://portfolio.example/api/admin/portfolio", { headers }));
  assert.equal(unlocked.status, 200);
  assert.equal((await unlocked.json()).identity.email, "owner@example.com");

  const differentOwner = await setupRoute.GET(new Request("https://portfolio.example/api/admin/setup", {
    headers: { "oai-authenticated-user-email": "other@example.com" },
  }));
  assert.equal(differentOwner.status, 403);

  delete env.DB;
  delete env.AUTH_PLATFORM;
  delete env.EMAIL;
  delete env.ADMIN_EMAIL_FROM;
});

test("admin clients and APIs enforce setup before management", async () => {
  const [adminClient, setupRoute, portfolioRoute, accessRoute, mediaRoute, homepage, previewPage] = await Promise.all([
    readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/setup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/portfolio/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/access/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/media/[projectId]/[slot]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/preview/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(adminClient, /\/api\/admin\/setup/u);
  assert.match(adminClient, /绑定当前邮箱/u);
  assert.doesNotMatch(adminClient, /<input[^>]+setup\.email/u);
  assert.match(setupRoute, /bindSiteOwner/u);
  assert.match(portfolioRoute, /requirePortfolioManager/u);
  assert.match(accessRoute, /requirePortfolioManager/u);
  assert.match(mediaRoute, /requirePortfolioManager/u);
  assert.match(homepage, /getSiteOwnership/u);
  assert.doesNotMatch(previewPage, /requireChatGPTUser/u);
});

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
