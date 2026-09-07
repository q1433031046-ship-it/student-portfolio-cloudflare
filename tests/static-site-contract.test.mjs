import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { createDefaultPortfolioDocument } = await import("../app/portfolio/default-document.ts");
const { canonicalJson, freezeStaticCandidate, StaticSiteContractError } = await import("../app/api/_lib/static-site-contract.ts");

function candidateDocument() {
  const document = createDefaultPortfolioDocument();
  document.hero.slides[0].media.key = "portfolio/hero/private-object.webp";
  document.hero.slides[0].media.id = "hero_primary";
  return document;
}

function mediaRecord(status = "uploaded") {
  return [{ id: "hero_primary", objectKey: "portfolio/hero/private-object.webp", contentType: "image/webp", byteSize: 1234,
    storageBackend: "kv", sourceEtag: "etag-1", status }];
}

test("static candidate rewrites internal object keys to stable public paths", async () => {
  const result = await freezeStaticCandidate(candidateDocument(), mediaRecord());
  assert.equal(result.candidate.hero.slides[0].media.src, "/media/hero_primary.webp");
  assert.equal(result.candidate.hero.slides[0].media.key, undefined);
  assert.equal(result.media[0].publicPath, "media/hero_primary.webp");
  assert.doesNotMatch(result.canonicalJson, /private-object|owner_email|accessToken|auditLogs/u);
  assert.match(result.candidateSha256, /^[a-f0-9]{64}$/u);
});

test("canonical JSON is independent from object insertion order", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), canonicalJson({ a: { x: 3, y: 2 }, z: 1 }));
});

test("missing, unfinished and unsupported media fail closed", async () => {
  await assert.rejects(freezeStaticCandidate(candidateDocument(), []), (error) => error instanceof StaticSiteContractError && error.code === "STATIC_MEDIA_NOT_READY");
  await assert.rejects(freezeStaticCandidate(candidateDocument(), mediaRecord("deleting")), (error) => error.code === "STATIC_MEDIA_NOT_READY");
  const wrongType = mediaRecord(); wrongType[0].contentType = "text/html";
  await assert.rejects(freezeStaticCandidate(candidateDocument(), wrongType), (error) => error.code === "STATIC_MEDIA_TYPE_UNSUPPORTED");
});

test("candidate rejects injected administrative or credential fields", async () => {
  const document = candidateDocument();
  document.ownerEmail = "owner@example.com";
  await assert.rejects(freezeStaticCandidate(document, mediaRecord()), (error) => error.code === "STATIC_CANDIDATE_SENSITIVE_DATA");
});
