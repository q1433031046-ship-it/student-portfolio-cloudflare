import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { readFile } from "node:fs/promises";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { signPlaybackGrant, verifyPlaybackGrant } = await import("../app/api/_lib/media-security.ts");
const { buildEventDedupeKey, hmacIdentifier, sanitizeReferrer } = await import("../app/api/_lib/request-context.ts");
const { authorizeAdmin } = await import("../app/api/_lib/auth.ts");
const { readJsonBody } = await import("../app/api/_lib/request-body.ts");
const { uploadPolicy } = await import("../app/api/admin/media/[projectId]/[slot]/route.ts");
const mediaRoute = await import("../app/api/media/[...path]/route.ts");
const { createDefaultPortfolioDocument } = await import("../app/portfolio/default-document.ts");
const { env } = await import("cloudflare:workers");

test("accepts a valid short-lived playback grant", async () => {
  const key = "portfolio/project-one/final-file.mp4";
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const secret = randomTestSecret();
  const signature = await signPlaybackGrant(key, expiresAt, secret);
  assert.equal(await verifyPlaybackGrant(key, expiresAt, signature, secret), true);
});

test("rejects expired or key-swapped playback grants", async () => {
  const key = "portfolio/project-one/final-file.mp4";
  const secret = randomTestSecret();
  const activeExpiry = Math.floor(Date.now() / 1000) + 300;
  const signature = await signPlaybackGrant(key, activeExpiry, secret);
  assert.equal(await verifyPlaybackGrant("portfolio/project-two/final-file.mp4", activeExpiry, signature, secret), false);

  const expired = Math.floor(Date.now() / 1000) - 1;
  const expiredSignature = await signPlaybackGrant(key, expired, secret);
  assert.equal(await verifyPlaybackGrant(key, expired, expiredSignature, secret), false);
});

test("network identifiers are keyed and referrers lose query strings", async () => {
  const first = await hmacIdentifier("203.0.113.9", randomTestSecret());
  const second = await hmacIdentifier("203.0.113.9", randomTestSecret());
  assert.notEqual(first, "203.0.113.9");
  assert.notEqual(first, second);
  assert.equal(sanitizeReferrer("https://example.com/path?token=secret#section"), "https://example.com/path");
});

test("Sites identity headers are trusted only on the Sites platform", async () => {
  const request = new Request("https://portfolio.example/api/admin/portfolio", {
    headers: { "oai-authenticated-user-email": "owner@example.com" },
  });

  delete env.AUTH_PLATFORM;
  assert.equal(await authorizeAdmin(request), null);

  env.AUTH_PLATFORM = "password";
  assert.equal(await authorizeAdmin(request), null);

  env.AUTH_PLATFORM = "sites";
  assert.deepEqual(await authorizeAdmin(request), {
    kind: "sites",
    user: "owner@example.com",
  });
  delete env.AUTH_PLATFORM;
});

test("event aggregation keys are stable inside a time bucket", async () => {
  const secret = randomTestSecret();
  const first = await buildEventDedupeKey({
    sessionId: "e0c64b6f-c721-46dc-943c-2e987305856a",
    eventType: "project_open",
    path: "/",
    projectId: "project-one",
    mediaVersion: null,
    action: "allow",
    now: 1_800_000_010_000,
  }, secret);
  const repeated = await buildEventDedupeKey({
    sessionId: "e0c64b6f-c721-46dc-943c-2e987305856a",
    eventType: "project_open",
    path: "/",
    projectId: "project-one",
    mediaVersion: null,
    action: "allow",
    now: 1_800_000_200_000,
  }, secret);
  const later = await buildEventDedupeKey({
    sessionId: "e0c64b6f-c721-46dc-943c-2e987305856a",
    eventType: "project_open",
    path: "/",
    projectId: "project-one",
    mediaVersion: null,
    action: "allow",
    now: 1_800_000_400_000,
  }, secret);

  assert.equal(first, repeated);
  assert.notEqual(first, later);
  assert.match(first, /^[a-f0-9]{32}$/);
});

test("media upload policy accepts bounded web fonts without weakening image and video slots", () => {
  assert.deepEqual(uploadPolicy("font", "font/woff2"), { kind: "font", maxBytes: 10 * 1024 * 1024 });
  assert.deepEqual(uploadPolicy("font", "font/ttf"), { kind: "font", maxBytes: 10 * 1024 * 1024 });
  assert.equal(uploadPolicy("font", "video/mp4"), null);
  assert.equal(uploadPolicy("final", "font/woff2"), null);
  assert.deepEqual(uploadPolicy("final", "video/mp4"), { kind: "video", maxBytes: 50 * 1024 * 1024 });
  assert.deepEqual(uploadPolicy("cover", "image/webp"), { kind: "image", maxBytes: 8 * 1024 * 1024 });
  assert.deepEqual(uploadPolicy("contact", "image/png"), { kind: "image", maxBytes: 8 * 1024 * 1024 });
});

test("public portfolio, playback, event and media routes share the QR access check", async () => {
  const paths = [
    "../app/api/portfolio/route.ts",
    "../app/api/playback/route.ts",
    "../app/api/events/route.ts",
    "../app/api/media/[...path]/route.ts",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /checkPortfolioAccess\(request\)/, path);
  }
});

test("bounds streamed JSON bodies even when content length is missing", async () => {
  const accepted = await readJsonBody(new Request("https://portfolio.example/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  }), 64);
  assert.deepEqual(accepted, { ok: true });

  await assert.rejects(
    readJsonBody(new Request("https://portfolio.example/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(80) }),
    }), 64),
    (error) => error?.status === 413,
  );
});

test("streams chunked MP4 ranges and serves ten complete viewers", async () => {
  const objectKey = "portfolio/project-one/final-test.mp4";
  const document = createDefaultPortfolioDocument();
  document.projects[0].finalVideo = {
    ...document.projects[0].finalVideo,
    key: objectKey,
    src: undefined,
  };
  const serialized = JSON.stringify(document);
  const chunks = new Map([
    [`${objectKey}::chunk:0000`, new TextEncoder().encode("ABCD").buffer],
    [`${objectKey}::chunk:0001`, new TextEncoder().encode("EFGH").buffer],
    [`${objectKey}::chunk:0002`, new TextEncoder().encode("IJ").buffer],
  ]);
  let kvReads = 0;
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = randomTestSecret();
  env.MEDIA_KV = {
    async get(key) {
      kvReads += 1;
      return chunks.get(key) ?? null;
    },
  };
  env.DB = mediaD1({
    portfolio: {
      id: "default",
      owner_email: "site-owner",
      revision: 1,
      draft_json: serialized,
      published_json: serialized,
      updated_at: "2026-08-28T00:00:00.000Z",
      published_at: "2026-08-28T00:00:00.000Z",
    },
    media: {
      id: "media-test",
      object_key: objectKey,
      content_type: "video/mp4",
      byte_size: 10,
      storage_backend: "kv",
      chunk_size: 4,
      chunk_count: 3,
    },
  });
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const signature = await signPlaybackGrant(objectKey, expiresAt, env.INITIAL_ADMIN_CODE);
  const url = `https://portfolio.example/api/media/${objectKey}?exp=${expiresAt}&sig=${signature}`;

  const range = await mediaRoute.GET(new Request(url, { headers: { Range: "bytes=2-7" } }), {
    params: Promise.resolve({ path: objectKey.split("/") }),
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 2-3/10");
  assert.equal(await range.text(), "CD");

  const responses = await Promise.all(Array.from({ length: 10 }, () => mediaRoute.GET(new Request(url), {
    params: Promise.resolve({ path: objectKey.split("/") }),
  })));
  const bodies = await Promise.all(responses.map((response) => response.text()));
  assert.equal(responses.every((response) => response.status === 200), true);
  assert.deepEqual(new Set(bodies), new Set(["ABCDEFGHIJ"]));
  assert.equal(kvReads, 31);

  delete env.DB;
  delete env.MEDIA_KV;
  delete env.AUTH_PLATFORM;
  delete env.INITIAL_ADMIN_CODE;
});

function mediaD1(rows) {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes("portfolio_access_settings")) return null;
          if (sql.includes("FROM portfolio_documents")) return rows.portfolio;
          if (sql.includes("FROM portfolio_media")) return rows.media;
          throw new Error(`Unexpected media query: ${sql}`);
        },
      };
    },
  };
}

function randomTestSecret() {
  return `T${crypto.randomUUID().replaceAll("-", "")}9`;
}
