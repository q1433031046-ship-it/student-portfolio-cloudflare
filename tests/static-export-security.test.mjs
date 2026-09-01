import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { bootstrapExpiresAt, exportLeaseAllows, frozenR2ObjectMatches, leaseExpiresAt, parseExportRange, signExportLease, tokenDigest, verifyExportLease } = await import("../app/api/_lib/static-site-export.ts");

const secret = "test-export-signing-key-that-is-long-enough";
const jobId = `job_${"a".repeat(32)}`;
const leaseId = "lease_identifier_that_is_long_enough";
const exp = 2_000_000_000;

test("bootstrap and lease windows are bounded to 30 and 120 minutes", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");
  assert.equal(Date.parse(bootstrapExpiresAt(now)) - now.getTime(), 30 * 60 * 1000);
  assert.equal(Date.parse(leaseExpiresAt(now)) - now.getTime(), 120 * 60 * 1000);
});

test("signed lease binds job, generation, methods and absolute expiry", async () => {
  const token = await signExportLease({ jobId, generation: 2, leaseId, methods: ["GET", "HEAD"], exp }, secret);
  const claims = await verifyExportLease(token, secret, exp - 1);
  assert.deepEqual(claims, { jobId, generation: 2, leaseId, methods: ["GET", "HEAD"], exp });
  assert.equal(await verifyExportLease(token, secret, exp), null);
  assert.equal(await verifyExportLease(`${token}x`, secret, exp - 1), null);
});

test("lease fails closed across job, generation, method, terminal state and digest", async () => {
  const claims = { jobId, generation: 2, leaseId, methods: ["GET", "HEAD"], exp };
  const digest = await tokenDigest(leaseId);
  const base = { claims, jobId, generation: 2, leaseIdDigest: digest, leaseExpiresAt: new Date(exp * 1000).toISOString(), status: "BUILD_TRIGGERED", method: "GET", nowSeconds: exp - 1 };
  assert.equal(exportLeaseAllows(base, digest), true);
  assert.equal(exportLeaseAllows({ ...base, jobId: `job_${"b".repeat(32)}` }, digest), false);
  assert.equal(exportLeaseAllows({ ...base, generation: 3 }, digest), false);
  assert.equal(exportLeaseAllows({ ...base, method: "POST" }, digest), false);
  assert.equal(exportLeaseAllows({ ...base, status: "PUBLISHED" }, digest), false);
  assert.equal(exportLeaseAllows(base, await tokenDigest("different-lease")), false);
  assert.equal(exportLeaseAllows({ ...base, leaseExpiresAt: new Date((exp + 1) * 1000).toISOString() }, digest), false);
  assert.equal(exportLeaseAllows({ ...base, method: "HEAD" }, digest), true);
  for (const status of ["PUBLISHED", "FAILED_RETRYABLE", "FAILED_FINAL", "ROLLED_BACK", "ROLLBACK_IN_PROGRESS"]) {
    assert.equal(exportLeaseAllows({ ...base, status }, digest), false);
  }
});

test("R2 export remains bound to the frozen size, ETag and media type", () => {
  const object = { size: 1024, httpEtag: "etag-v1", httpMetadata: { contentType: "video/mp4" } };
  const frozen = { byteSize: 1024, sourceEtag: "etag-v1", contentType: "video/mp4" };
  assert.equal(frozenR2ObjectMatches(object, frozen), true);
  assert.equal(frozenR2ObjectMatches({ ...object, size: 1025 }, frozen), false);
  assert.equal(frozenR2ObjectMatches({ ...object, httpEtag: "etag-v2" }, frozen), false);
  assert.equal(frozenR2ObjectMatches({ ...object, httpMetadata: { contentType: "image/png" } }, frozen), false);
});

test("single and multi-chunk HTTP byte ranges are normalized and invalid ranges fail closed", () => {
  const size = 10 * 1024 * 1024;
  assert.deepEqual(parseExportRange("bytes=0-0", size), { start: 0, end: 0 });
  assert.deepEqual(parseExportRange(`bytes=${4 * 1024 * 1024 - 4}-${4 * 1024 * 1024 + 4}`, size),
    { start: 4 * 1024 * 1024 - 4, end: 4 * 1024 * 1024 + 4 });
  assert.deepEqual(parseExportRange("bytes=-512", size), { start: size - 512, end: size - 1 });
  assert.deepEqual(parseExportRange(`bytes=${size - 1}-${size + 100}`, size), { start: size - 1, end: size - 1 });
  for (const value of ["bytes=", "items=0-1", "bytes=10-1", `bytes=${size}-`, "bytes=1-2,3-4"]) {
    assert.equal(parseExportRange(value, size), "invalid");
  }
});
