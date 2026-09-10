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
  deleteAccessPass,
  inspectAccessPassToken,
  isAccessPassSessionValid,
  redeemAccessPass,
  setAccessRestriction,
  updateAccessPass,
  validateAccessPassPatch,
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
  const session = await security.createAccessSession(passId, 7, 2_000, secret);
  assert.deepEqual(await security.verifyAccessSession(session, secret, 1_999), {
    passId,
    sessionGeneration: 7,
    expiresAt: 2_000,
  });
  assert.equal(await security.verifyAccessSession(session, secret, 2_000), null);
});

test("keeps a valid legacy s1 session as generation one until the pass is revoked", async () => {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const expiresAt = nowSeconds + 3_600;
  const legacySession = await createLegacyAccessSession(passId, expiresAt, secret);
  assert.deepEqual(await security.verifyAccessSession(legacySession, secret, nowSeconds), {
    passId,
    sessionGeneration: 1,
    expiresAt,
  });

  const database = await createAccessDatabase();
  env.DB = d1Adapter(database);
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  insertAccessPass(database);
  const rawCookie = `${security.PORTFOLIO_ACCESS_COOKIE}=${encodeURIComponent(legacySession)}`;
  const beforePause = await checkPortfolioAccess(new Request("https://portfolio.example/", {
    headers: { Cookie: rawCookie },
  }));
  assert.equal(beforePause.allowed, true);

  await updateAccessPass(passId, { enabled: false });
  await updateAccessPass(passId, { enabled: true });
  const afterResume = await checkPortfolioAccess(new Request("https://portfolio.example/", {
    headers: { Cookie: rawCookie },
  }));
  assert.equal(afterResume.allowed, false);
  assert.equal(afterResume.reason, "revoked");
  resetAccessEnv();
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
  const now = new Date();

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
  assert.equal(verified.sessionGeneration, 1);

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

  await updateAccessPass(passId, { enabled: false });
  const pausedInspection = await inspectAccessPassToken(token);
  assert.equal(pausedInspection.validToken, true);
  assert.equal(pausedInspection.reason, "二维码已停用");
  const revoked = await checkPortfolioAccess(new Request("https://portfolio.example/", {
    headers: { Cookie: rawCookie },
  }));
  assert.equal(revoked.allowed, false);
  assert.equal(revoked.reason, "revoked");

  await updateAccessPass(passId, { enabled: true });
  const stillRevokedAfterResume = await checkPortfolioAccess(new Request("https://portfolio.example/", {
    headers: { Cookie: rawCookie },
  }));
  assert.equal(stillRevokedAfterResume.allowed, false);
  assert.equal(stillRevokedAfterResume.reason, "revoked");
  resetAccessEnv();
});

test("does not revive a visitor session after an expiry is tightened and later extended", async () => {
  const database = await createAccessDatabase();
  env.DB = d1Adapter(database);
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  const now = new Date();

  insertAccessPass(database);
  const token = await security.createAccessToken(passId, secret);
  const first = await redeemAccessPass(new Request("https://portfolio.example/access/redeem"), token, now);
  assert.equal(first.ok, true);
  const rawCookie = first.cookie.split(";", 1)[0];

  await updateAccessPass(passId, { expiresAt: new Date(now.getTime() - 60_000).toISOString() });
  const expired = await checkPortfolioAccess(new Request("https://portfolio.example/", {
    headers: { Cookie: rawCookie },
  }));
  assert.equal(expired.allowed, false);

  await updateAccessPass(passId, { expiresAt: new Date(now.getTime() + ACCESS_SESSION_SECONDS * 1_000).toISOString() });
  const stillRevokedAfterExtension = await checkPortfolioAccess(new Request("https://portfolio.example/", {
    headers: { Cookie: rawCookie },
  }));
  assert.equal(stillRevokedAfterExtension.allowed, false);
  assert.equal(stillRevokedAfterExtension.reason, "revoked");
  resetAccessEnv();
});

test("allows the final QR pass to be paused or deleted while restriction stays enabled", async () => {
  const database = await createAccessDatabase();
  env.DB = d1Adapter(database);
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  insertAccessPass(database);

  await updateAccessPass(passId, { enabled: false });
  assert.equal(database.prepare("SELECT enabled FROM portfolio_access_passes WHERE id = ?").get(passId).enabled, 0);
  await deleteAccessPass(passId);
  assert.equal(database.prepare("SELECT id FROM portfolio_access_passes WHERE id = ?").get(passId), undefined);
  assert.equal(database.prepare("SELECT restriction_enabled FROM portfolio_access_settings WHERE id = 'default'").get().restriction_enabled, 1);
  resetAccessEnv();
});

test("does not consume a QR use or issue an access cookie while the portfolio is public", async () => {
  const database = await createAccessDatabase();
  env.DB = d1Adapter(database);
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  insertAccessPass(database, { maxUses: 1 });
  database.prepare("UPDATE portfolio_access_settings SET restriction_enabled = 0 WHERE id = 'default'").run();
  const token = await security.createAccessToken(passId, secret);

  const result = await redeemAccessPass(new Request("https://portfolio.example/access/redeem"), token);
  assert.equal(result.ok, true);
  assert.equal(result.unrestricted, true);
  assert.equal(result.cookie, null);
  assert.equal(readUsedCount(database), 0);

  const route = await import("../app/access/redeem/route.ts");
  const response = await route.POST(formRequest(token));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://portfolio.example/");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(readUsedCount(database), 0);
  resetAccessEnv();
});

test("a concurrent switch to public that wins before consume returns unrestricted without charging", async () => {
  const database = await createAccessDatabase();
  let interposed = false;
  env.DB = d1Adapter(database, {
    async beforeBatch(statements) {
      if (interposed || !statements.some((statement) => statement.sql.includes("used_count = used_count + 1"))) return;
      interposed = true;
      await setAccessRestriction(false, "site-owner");
    },
    async afterBatch(statements) {
      if (!interposed || !statements.some((statement) => statement.sql.includes("used_count = used_count + 1"))) return;
      await setAccessRestriction(true, "site-owner");
    },
  });
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  insertAccessPass(database, { maxUses: 1 });
  const token = await security.createAccessToken(passId, secret);

  const result = await redeemAccessPass(new Request("https://portfolio.example/access/redeem"), token);
  assert.equal(interposed, true);
  assert.deepEqual(result, { ok: true, cookie: null, pass: null, reused: false, unrestricted: true });
  assert.equal(readUsedCount(database), 0);
  assert.equal(database.prepare("SELECT restriction_enabled FROM portfolio_access_settings WHERE id = 'default'").get().restriction_enabled, 1);
  resetAccessEnv();
});

test("a consume that wins before the concurrent public switch keeps the charged redemption", async () => {
  const database = await createAccessDatabase();
  let interposed = false;
  env.DB = d1Adapter(database, {
    async afterBatch(statements) {
      if (interposed || !statements.some((statement) => statement.sql.includes("used_count = used_count + 1"))) return;
      interposed = true;
      await setAccessRestriction(false, "site-owner");
    },
  });
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  insertAccessPass(database, { maxUses: 1 });
  const token = await security.createAccessToken(passId, secret);

  const result = await redeemAccessPass(new Request("https://portfolio.example/access/redeem"), token);
  assert.equal(interposed, true);
  assert.equal(result.ok, true);
  assert.equal(result.unrestricted, false);
  assert.equal(result.reused, false);
  assert.match(result.cookie, /^portfolio-access=/u);
  assert.equal(readUsedCount(database), 1);
  assert.equal(database.prepare("SELECT restriction_enabled FROM portfolio_access_settings WHERE id = 'default'").get().restriction_enabled, 0);
  resetAccessEnv();
});

test("validates access-pass PATCH fields independently without clearing omitted limits", () => {
  assert.deepEqual(validateAccessPassPatch({ label: " 新名称 " }), { label: "新名称" });
  assert.deepEqual(validateAccessPassPatch({ maxUses: 5 }), { maxUses: 5 });
  assert.deepEqual(validateAccessPassPatch({ expiresAt: null }), { expiresAt: null });
  assert.throws(() => validateAccessPassPatch({ maxUses: 0 }), /访问次数/u);
});

test("preserves concurrent access-pass patches without rolling back another field", async () => {
  const database = await createAccessDatabase();
  const passReadBarrier = createBarrier(2);
  env.DB = d1Adapter(database, { passReadBarrier });
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  const nextExpiry = new Date(Date.now() + ACCESS_SESSION_SECONDS * 2_000).toISOString();
  insertAccessPass(database, { maxUses: 20, expiresAt: nextExpiry });

  await Promise.all([
    updateAccessPass(passId, { enabled: false }),
    updateAccessPass(passId, { label: "并发修改", maxUses: 8 }),
  ]);

  const row = database.prepare("SELECT label, enabled, max_uses, expires_at FROM portfolio_access_passes WHERE id = ?").get(passId);
  assert.deepEqual({ ...row }, { label: "并发修改", enabled: 0, max_uses: 8, expires_at: nextExpiry });
  const state = database.prepare("SELECT session_generation FROM portfolio_access_pass_state WHERE pass_id = ?").get(passId);
  assert.equal(Number(state.session_generation), 2);
  resetAccessEnv();
});

test("binds redemption count, pass snapshot and generation before a concurrent pause", async () => {
  const database = await createAccessDatabase();
  let interposed = false;
  env.DB = d1Adapter(database, {
    async afterBatch(statements) {
      if (interposed || !statements.some((statement) => statement.sql.includes("used_count = used_count + 1"))) return;
      interposed = true;
      await updateAccessPass(passId, { enabled: false });
    },
  });
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  insertAccessPass(database, { maxUses: 2 });
  const token = await security.createAccessToken(passId, secret);

  const result = await redeemAccessPass(new Request("https://portfolio.example/access/redeem"), token);
  assert.equal(interposed, true, "pause must run after the atomic redemption snapshot and before signing");
  assert.equal(result.ok, true);
  assert.equal(readUsedCount(database), 1);
  const rawCookie = result.cookie.split(";", 1)[0];
  const denied = await checkPortfolioAccess(new Request("https://portfolio.example/", {
    headers: { Cookie: rawCookie },
  }));
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "revoked");
  resetAccessEnv();
});

test("invalidates a redemption snapshot when an expiry is tightened before signing", async () => {
  const database = await createAccessDatabase();
  let interposed = false;
  env.DB = d1Adapter(database, {
    async afterBatch(statements) {
      if (interposed || !statements.some((statement) => statement.sql.includes("used_count = used_count + 1"))) return;
      interposed = true;
      await updateAccessPass(passId, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    },
  });
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  insertAccessPass(database, { maxUses: 2 });
  const token = await security.createAccessToken(passId, secret);

  const result = await redeemAccessPass(new Request("https://portfolio.example/access/redeem"), token);
  assert.equal(interposed, true, "expiry tightening must run after the snapshot and before signing");
  assert.equal(result.ok, true);
  const rawCookie = result.cookie.split(";", 1)[0];
  const denied = await checkPortfolioAccess(new Request("https://portfolio.example/", {
    headers: { Cookie: rawCookie },
  }));
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "revoked");
  resetAccessEnv();
});

test("rejects redemption when an expiry tightening wins before the atomic consume gate", async () => {
  const database = await createAccessDatabase();
  env.DB = d1Adapter(database);
  env.ACCESS_SIGNING_KEY = secret;
  env.AUTH_PLATFORM = "password";
  insertAccessPass(database, { maxUses: 2 });
  const token = await security.createAccessToken(passId, secret);

  await updateAccessPass(passId, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const result = await redeemAccessPass(new Request("https://portfolio.example/access/redeem"), token);
  assert.deepEqual(result, { ok: false, reason: "二维码已过期" });
  assert.equal(readUsedCount(database), 0);
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
  assert.match(accessPage, /decision\.reason === "open"/u);
  assert.doesNotMatch(accessPage, /redeemAccessPass/u);
  assert.match(redeemRoute, /export async function POST/u);
  assert.doesNotMatch(redeemRoute, /export async function GET/u);
  assert.match(redeemRoute, /status: 303/u);
  assert.match(redeemRoute, /Referrer-Policy/u);
  assert.match(redeemRoute, /requestOrigin !== requestUrl\.origin/u);
  assert.match(accessActions, /url\.searchParams\.delete\("error"\)/u);
  assert.match(accessActions, /navigator\.clipboard\.writeText\(url\.toString\(\)\)/u);
});

test("administrative access writes are paused server-side while GET remains read-only", async () => {
  const route = await readFile(new URL("../app/api/admin/access/route.ts", import.meta.url), "utf8");
  const manager = await readFile(new URL("../app/admin/access-manager.tsx", import.meta.url), "utf8");
  assert.match(route, /featureStatus: "paused"/u);
  assert.match(route, /ACCESS_FEATURE_PAUSED/u);
  assert.match(route, /status: 409/u);
  assert.doesNotMatch(route, /createAccessPass|updateAccessPass|deleteAccessPass|setAccessRestriction/u);
  assert.match(manager, /<fieldset disabled/u);
  assert.match(manager, /既有访问码、次数和到期设置均已保留/u);
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

test("retains legacy visitor data while documentation clearly pauses access writes", async () => {
  const [accessManager, accessGate, adminClient, readme, guide] = await Promise.all([
    readFile(new URL("../app/admin/access-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio/access-gate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/admin-guide-center.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(accessManager, /固定 24 小时/u);
  assert.match(accessManager, /不会延长/u);
  assert.match(accessManager, /公开访问时不会扣除二维码次数/u);
  assert.match(accessManager, /access\.restrictionEnabled && usableCount === 0/u);
  assert.match(accessManager, /当前所有访客均被阻断/u);
  assert.match(accessManager, /启用一张当前可用的二维码，或新建二维码/u);
  assert.match(accessGate, /此作品集已开启限制访问/u);
  assert.match(accessGate, /二维码或访问链接/u);
  assert.match(adminClient, /placeholder="请输入你的姓名"/u);
  assert.match(adminClient, /label: "联系方式"/u);
  assert.match(readme, /暂停旧“限制访问”功能的所有写操作/u);
  assert.match(readme, /原设置、访问码、次数、到期时间和历史记录完整保留/u);
  assert.match(readme, /管理员登录仍保持 12 小时/u);
  assert.match(guide, /暂停旧限制访问功能的写入/u);
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

async function createLegacyAccessSession(id, expiresAt, signingSecret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = `portfolio-access-session\ns1\n${id}\n${expiresAt}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return `s1.${id}.${expiresAt}.${encoded}`;
}

function d1Adapter(database, hooks = {}) {
  let batchQueue = Promise.resolve();
  return {
    prepare(sql) {
      return new SqliteD1Statement(database, sql, [], hooks);
    },
    async batch(statements) {
      const transaction = batchQueue.then(async () => {
        await hooks.beforeBatch?.(statements);
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
      });
      batchQueue = transaction.then(() => undefined, () => undefined);
      const results = await transaction;
      await hooks.afterBatch?.(statements, results);
      return results;
    },
  };
}

class SqliteD1Statement {
  constructor(database, sql, values = [], hooks = {}) {
    this.database = database;
    this.sql = sql;
    this.values = values;
    this.hooks = hooks;
  }
  bind(...values) {
    return new SqliteD1Statement(this.database, this.sql, values, this.hooks);
  }
  async first() {
    const row = this.database.prepare(this.sql).get(...this.values) ?? null;
    if (this.hooks.passReadBarrier && /FROM portfolio_access_passes WHERE id = \? LIMIT 1/u.test(this.sql)) {
      await this.hooks.passReadBarrier.wait();
    }
    return row;
  }
  async run() {
    if (/^\s*SELECT\b/iu.test(this.sql)) {
      return { success: true, results: this.database.prepare(this.sql).all(...this.values), meta: { changes: 0 } };
    }
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.values), meta: { changes: 0 } };
  }
}

function createBarrier(required) {
  let arrived = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  return {
    async wait() {
      arrived += 1;
      if (arrived >= required) release();
      await ready;
    },
  };
}
