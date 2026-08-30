import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const security = await import("../app/api/_lib/portfolio-access-security.ts");
const { env } = await import("cloudflare:workers");
const {
  ACCESS_SESSION_SECONDS,
  accessPassStatus,
  calculateAccessSessionExpiry,
  checkPortfolioAccess,
  inspectAccessPassToken,
  isAccessPassSessionValid,
  redeemAccessPass,
} = await import("../app/api/_lib/portfolio-access.ts");
const { createQrMatrix, qrSvg } = await import("../app/lib/qr-code.ts");

const secret = "test-access-signing-key-with-more-than-thirty-two-characters";
const passId = "qr_0123456789abcdef0123456789abcdef";

test("signs opaque access links and rejects modified credentials", async () => {
  const token = await security.createAccessToken(passId, secret);
  assert.equal(await security.verifyAccessToken(token, secret), passId);
  assert.equal(await security.verifyAccessToken(`${token.slice(0, -1)}x`, secret), null);
  assert.equal(await security.verifyAccessToken(token, `${secret}-wrong`), null);
});

test("keeps a signed browser session until its expiry", async () => {
  const session = await security.createAccessSession(passId, 2_000, secret);
  assert.deepEqual(await security.verifyAccessSession(session, secret, 1_999), { passId, expiresAt: 2_000 });
  assert.equal(await security.verifyAccessSession(session, secret, 2_000), null);
});

test("limits visitor access to a fixed 24 hours and clamps it to the QR expiry", () => {
  assert.equal(ACCESS_SESSION_SECONDS, 86_400);
  assert.equal(calculateAccessSessionExpiry(1_000, null), 87_400);
  assert.equal(calculateAccessSessionExpiry(1_000, "1970-01-01T12:00:00.000Z"), 43_200);
});

test("redeems one use, reuses the fixed browser session, and preserves exhausted sessions", async () => {
  const database = await createAccessDatabase();
  env.DB = d1Adapter(database);
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  const now = new Date("2030-01-01T00:00:00.000Z");

  insertAccessPass(database, { maxUses: 1 });
  const token = await security.createAccessToken(passId, secret);
  const inspection = await inspectAccessPassToken(token);
  assert.equal(inspection.validToken, true);
  assert.equal(inspection.redeemable, true);
  assert.equal(readUsedCount(database), 0);

  const first = await redeemAccessPass(new Request("https://portfolio.example/access/redeem"), token, now);
  assert.equal(first.ok, true);
  assert.equal(first.reused, false);
  assert.equal(readUsedCount(database), 1);
  const rawCookie = first.cookie.split(";", 1)[0];
  const sessionValue = security.readCookie(rawCookie, security.PORTFOLIO_ACCESS_COOKIE);
  const verified = await security.verifyAccessSession(sessionValue, secret, Math.floor(now.getTime() / 1000));
  assert.equal(verified.expiresAt, Math.floor(now.getTime() / 1000) + ACCESS_SESSION_SECONDS);

  const exhaustedInspection = await inspectAccessPassToken(token);
  assert.equal(exhaustedInspection.validToken, true);
  assert.equal(exhaustedInspection.redeemable, false);
  assert.equal(exhaustedInspection.reason, "二维码使用次数已用完");

  const repeated = await redeemAccessPass(new Request("https://portfolio.example/access/redeem", {
    headers: { Cookie: rawCookie },
  }), token, new Date(now.getTime() + 60_000));
  assert.equal(repeated.ok, true);
  assert.equal(repeated.reused, true);
  assert.equal(repeated.cookie, first.cookie);
  assert.equal(readUsedCount(database), 1);

  const newBrowser = await redeemAccessPass(new Request("https://portfolio.example/access/redeem"), token, new Date(now.getTime() + 120_000));
  assert.deepEqual(newBrowser, { ok: false, reason: "二维码使用次数已用完" });

  const existingAccess = await checkPortfolioAccess(new Request("https://portfolio.example/", {
    headers: { Cookie: rawCookie },
  }));
  assert.equal(existingAccess.allowed, true);
  assert.equal(existingAccess.reason, "session");

  database.prepare("UPDATE portfolio_access_passes SET enabled = 0 WHERE id = ?").run(passId);
  const pausedInspection = await inspectAccessPassToken(token);
  assert.equal(pausedInspection.validToken, true);
  assert.equal(pausedInspection.reason, "二维码已停用");
  const revoked = await checkPortfolioAccess(new Request("https://portfolio.example/", {
    headers: { Cookie: rawCookie },
  }));
  assert.equal(revoked.allowed, false);
  assert.equal(revoked.reason, "revoked");
  resetAccessEnv();
});

test("classifies paused, expired, exhausted and active passes", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");
  assert.equal(accessPassStatus({ enabled: true, expiresAt: null, maxUses: null, usedCount: 0 }, now), "active");
  assert.equal(accessPassStatus({ enabled: false, expiresAt: null, maxUses: null, usedCount: 0 }, now), "paused");
  assert.equal(accessPassStatus({ enabled: true, expiresAt: "2026-08-27T11:59:59.000Z", maxUses: null, usedCount: 0 }, now), "expired");
  assert.equal(accessPassStatus({ enabled: true, expiresAt: null, maxUses: 3, usedCount: 3 }, now), "exhausted");
  assert.equal(isAccessPassSessionValid({ enabled: true, expiresAt: null, maxUses: 3, usedCount: 3 }, now), true);
});

test("renders a complete version 10 QR matrix and SVG", () => {
  const link = "https://portfolio.example/access?key=v1.qr_0123456789abcdef0123456789abcdef.signature-placeholder";
  const matrix = createQrMatrix(link);
  assert.equal(matrix.length, 57);
  assert.equal(matrix.every((row) => row.length === 57), true);
  assert.deepEqual(matrix[0].slice(0, 7), [true, true, true, true, true, true, true]);
  assert.match(qrSvg(link, { title: "测试访问码" }), /^<svg[^>]+>/u);
  assert.match(qrSvg(link, { title: "测试访问码" }), /<title>测试访问码<\/title>/u);
});

test("parses the access cookie without trusting malformed encoding", () => {
  assert.equal(security.readCookie("a=1; portfolio-access=session%2Evalue; b=2", "portfolio-access"), "session.value");
  assert.equal(security.readCookie("portfolio-access=%E0%A4%A", "portfolio-access"), null);
});

test("uses a non-redeeming access page and a POST-only redeem endpoint", async () => {
  const [accessPage, redeemRoute, accessActions] = await Promise.all([
    readFile(new URL("../app/access/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/access/redeem/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/access/access-actions.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(accessPage, /action="\/access\/redeem"/u);
  assert.match(accessPage, /打开作品集/u);
  assert.match(accessPage, /打开此确认页不会扣除次数/u);
  assert.doesNotMatch(accessPage, /redeemAccessPass/u);
  assert.match(redeemRoute, /export async function POST/u);
  assert.doesNotMatch(redeemRoute, /export async function GET/u);
  assert.match(redeemRoute, /status: 303/u);
  assert.match(redeemRoute, /Referrer-Policy/u);
  assert.match(redeemRoute, /requestOrigin !== requestUrl\.origin/u);
  assert.match(accessActions, /url\.searchParams\.delete\("error"\)/u);
  assert.match(accessActions, /navigator\.clipboard\.writeText\(url\.toString\(\)\)/u);
});

test("redeem endpoint rejects cross-origin posts and redirects successful form posts", async () => {
  const database = await createAccessDatabase();
  env.DB = d1Adapter(database);
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  insertAccessPass(database, { maxUses: 2 });

  try {
    const token = await security.createAccessToken(passId, secret);
    const route = await import("../app/access/redeem/route.ts");
    const rejected = await route.POST(formRequest(token, { origin: "https://attacker.example" }));
    assert.equal(rejected.status, 303);
    assert.match(rejected.headers.get("location"), /^https:\/\/portfolio\.example\/access\?error=/u);
    assert.equal(readUsedCount(database), 0);

    const accepted = await route.POST(formRequest(token));
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get("location"), "https://portfolio.example/");
    assert.match(accepted.headers.get("set-cookie"), /portfolio-access=/u);
    assert.equal(accepted.headers.get("referrer-policy"), "no-referrer");
    assert.equal(readUsedCount(database), 1);

    const repeated = await route.POST(formRequest(token, {
      cookie: accepted.headers.get("set-cookie").split(";", 1)[0],
    }));
    assert.equal(repeated.status, 303);
    assert.equal(readUsedCount(database), 1);
  } finally {
    resetAccessEnv();
  }
});

test("explains the fixed visitor session without changing the administrator session", async () => {
  const [accessManager, accessGate, adminClient, readme, guide] = await Promise.all([
    readFile(new URL("../app/admin/access-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio/access-gate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin-guide-center.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(accessManager, /固定 24 小时/u);
  assert.match(accessManager, /不会延长/u);
  assert.match(accessGate, /此作品集已开启限制访问/u);
  assert.match(accessGate, /二维码或访问链接/u);
  assert.match(adminClient, /placeholder="请输入你的姓名"/u);
  assert.match(adminClient, /label: "联系方式"/u);
  assert.match(readme, /确认页不会扣除次数/u);
  assert.match(readme, /管理员登录仍保持 12 小时/u);
  assert.match(guide, /二维码访客会话固定为 24 小时/u);
  assert.match(guide, /管理员登录仍为 12 小时/u);
});

async function createAccessDatabase() {
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

function insertAccessPass(database, { maxUses = null, expiresAt = null } = {}) {
  const now = "2030-01-01T00:00:00.000Z";
  database.prepare("INSERT INTO portfolio_access_settings (id, restriction_enabled, updated_at, updated_by) VALUES ('default', 1, ?, 'site-owner')").run(now);
  database.prepare("INSERT INTO portfolio_access_passes (id, label, enabled, max_uses, used_count, expires_at, created_at, updated_at, created_by) VALUES (?, '测试访问码', 1, ?, 0, ?, ?, ?, 'site-owner')")
    .run(passId, maxUses, expiresAt, now, now);
}

function readUsedCount(database) {
  return Number(database.prepare("SELECT used_count FROM portfolio_access_passes WHERE id = ?").get(passId).used_count);
}

function resetAccessEnv() {
  delete env.DB;
  delete env.ACCESS_SIGNING_KEY;
  delete env.AUTH_PLATFORM;
}

function formRequest(token, { origin = "https://portfolio.example", cookie = "" } = {}) {
  const headers = new Headers({ Origin: origin });
  if (cookie) headers.set("Cookie", cookie);
  return new Request("https://portfolio.example/access/redeem", {
    method: "POST",
    headers,
    body: new URLSearchParams({ key: token }),
  });
}

function d1Adapter(database) {
  return {
    prepare(sql) {
      return new SqliteD1Statement(database, sql);
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
