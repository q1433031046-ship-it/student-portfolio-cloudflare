import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const security = await import("../app/api/_lib/portfolio-access-security.ts");
const { accessPassStatus, isAccessPassSessionValid } = await import("../app/api/_lib/portfolio-access.ts");
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
