import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { canonicalJson, sha256Hex } = await import("../app/api/_lib/static-site-contract.ts");
const { assertProductionReadback, verifyArtifact } = await import("../app/api/_lib/static-publish-verify.ts");
const { assertStaticJobTransition } = await import("../app/api/_lib/static-site-store.ts");
const { assertNetlifyBindingSite, mediaRecordsFromRows, publishAndReadBackExistingDeploy } = await import("../app/api/_lib/static-publish.ts");
const orchestratorSource = await readFile(new URL("../app/api/_lib/static-publish.ts", import.meta.url), "utf8");
const netlifyClientSource = await readFile(new URL("../app/api/_lib/netlify-client.ts", import.meta.url), "utf8");
const followDirective = new RegExp(["redirect:", "\\s*", "[", "\"'", "]", "follow", "[", "\"'", "]"].join(""), "u");
const restartedGenerationSymbol = ["restartStaticJob", "Generation"].join("");

const legalTransitions = [
  ["FROZEN", "BUILD_TRIGGERED"], ["BUILD_TRIGGERED", "DRAFT_DEPLOY_LOCATED"],
  ["DRAFT_DEPLOY_LOCATED", "DRAFT_DEPLOY_READY"], ["DRAFT_DEPLOY_READY", "ARTIFACT_VERIFIED"],
  ["ARTIFACT_VERIFIED", "PUBLISH_REQUESTED"], ["PUBLISH_REQUESTED", "PRODUCTION_READBACK_VERIFIED"],
  ["PRODUCTION_READBACK_VERIFIED", "PUBLISHED"], ["PUBLISHED", "ROLLBACK_IN_PROGRESS"],
  ["ROLLBACK_IN_PROGRESS", "ROLLED_BACK"], ["FAILED_RETRYABLE", "BUILD_TRIGGERED"],
  ["FAILED_RETRYABLE", "DRAFT_DEPLOY_LOCATED"], ["FAILED_RETRYABLE", "ARTIFACT_VERIFIED"],
];

async function fixture() {
  const files = [{ path: "index.html", byteSize: 5, contentType: "text/html", sha256: "a".repeat(64), providerSha1: "b".repeat(40) }];
  const artifactSha256 = await sha256Hex(canonicalJson(files));
  const manifest = { schemaVersion: 1, providerRequestKey: "sp-aaaaaaaaaaaaaaaaaaaaaaaa", deployId: "deploy-1", publicRevision: 1,
    candidateSha256: "c".repeat(64), sourceCommitSha: "d".repeat(40), artifactSha256, fileCount: 1, totalBytes: 5, files };
  const marker = { deployId: manifest.deployId, providerRequestKey: manifest.providerRequestKey, candidateSha256: manifest.candidateSha256,
    artifactSha256, publicRevision: 1, sourceCommitSha: manifest.sourceCommitSha };
  const deploy = { id: "deploy-1", site_id: "site-1", state: "ready" };
  const providerFiles = [{ path: "/index.html", size: 5, sha: "b".repeat(40) }, { path: "/artifact-manifest.json", size: 1, sha: "e".repeat(40) }, { path: "/__static-release.json", size: 1, sha: "f".repeat(40) }];
  return { manifest, marker, deploy, providerFiles,
    manifestFileEvidence: { byteSize: 1, providerSha1: "e".repeat(40) },
    markerFileEvidence: { byteSize: 1, providerSha1: "f".repeat(40) } };
}

test("artifact verification binds exact deploy, candidate, request, revision, source and provider file set", async () => {
  const value = await fixture();
  const result = await verifyArtifact({ ...value, expectedCandidateSha256: value.manifest.candidateSha256,
    expectedSourceCommitSha: value.manifest.sourceCommitSha, expectedProviderRequestKey: value.manifest.providerRequestKey, expectedPublicRevision: 1 });
  assert.equal(result.artifactSha256, value.manifest.artifactSha256);
  assert.doesNotThrow(() => assertProductionReadback(value.marker, value.deploy.id, value.manifest.artifactSha256));
});

test("wrong deploy, candidate, provider file or production readback blocks publication", async () => {
  for (const mutate of [
    (value) => { value.deploy.id = "wrong"; },
    (value) => { value.manifest.candidateSha256 = "e".repeat(64); },
    (value) => { value.providerFiles[0].sha = "0".repeat(40); },
    (value) => { value.providerFiles.push({ path: "/unexpected.txt", size: 1, sha: "1".repeat(40) }); },
  ]) {
    const value = await fixture(); mutate(value);
    await assert.rejects(verifyArtifact({ ...value, expectedCandidateSha256: "c".repeat(64), expectedSourceCommitSha: "d".repeat(40),
      expectedProviderRequestKey: "sp-aaaaaaaaaaaaaaaaaaaaaaaa", expectedPublicRevision: 1 }));
  }
  const value = await fixture();
  assert.throws(() => assertProductionReadback(value.marker, "another-deploy", value.manifest.artifactSha256));
});

test("state machine permits the exact forward path and bounded retry/rollback edges", () => {
  for (const [from, to] of legalTransitions) assert.doesNotThrow(() => assertStaticJobTransition(from, to));
  for (const state of ["FROZEN", "BUILD_TRIGGERED", "DRAFT_DEPLOY_LOCATED", "DRAFT_DEPLOY_READY", "ARTIFACT_VERIFIED",
    "PUBLISH_REQUESTED", "PRODUCTION_READBACK_VERIFIED"]) {
    assert.doesNotThrow(() => assertStaticJobTransition(state, "FAILED_RETRYABLE"));
    assert.doesNotThrow(() => assertStaticJobTransition(state, "FAILED_FINAL"));
  }
});

test("state machine fails closed on shortcuts, terminal resurrection and wrong rollback targets", () => {
  for (const [from, to] of [
    ["FROZEN", "PUBLISHED"], ["BUILD_TRIGGERED", "PUBLISH_REQUESTED"], ["DRAFT_DEPLOY_READY", "PUBLISHED"],
    ["ARTIFACT_VERIFIED", "PRODUCTION_READBACK_VERIFIED"], ["FAILED_FINAL", "BUILD_TRIGGERED"],
    ["ROLLED_BACK", "PUBLISHED"], ["PUBLISHED", "ROLLED_BACK"], ["FAILED_RETRYABLE", "PUBLISHED"],
  ]) assert.throws(() => assertStaticJobTransition(from, to), /非法静态发布状态转换/u);
});

test("each generation locates its Deploy from the current trigger timestamp", () => {
  assert.match(orchestratorSource, /findDeployByRequestKey\([^\n]+new Date\(job\.updated_at\)\)/gu);
  assert.equal((orchestratorSource.match(/new Date\(job\.updated_at\)/gu) ?? []).length, 2);
  assert.doesNotMatch(orchestratorSource, /findDeployByRequestKey\([^\n]+new Date\(job\.created_at\)/u);
});

test("publishing reads back first and recovers an unknown response without a second request", async () => {
  const calls = [];
  const alreadyPublished = {
    async getSite() { calls.push("read"); return { id: "site-1", published_deploy: { id: "deploy-1" } }; },
    async publishExistingDeploy() { calls.push("publish"); },
  };
  await publishAndReadBackExistingDeploy(alreadyPublished, "site-1", "deploy-1");
  assert.deepEqual(calls, ["read"]);

  let published = false;
  const responseLost = {
    async getSite() { calls.push("read-loss"); return { id: "site-1", published_deploy: published ? { id: "deploy-1" } : null }; },
    async publishExistingDeploy() { calls.push("publish-loss"); published = true; throw new Error("response lost"); },
  };
  const result = await publishAndReadBackExistingDeploy(responseLost, "site-1", "deploy-1");
  assert.equal(result.published_deploy?.id, "deploy-1");
  assert.deepEqual(calls.slice(1), ["read-loss", "publish-loss", "read-loss"]);
});

test("the runtime binds the exact Netlify account, Site, slug and fixed URL", async () => {
  const accountId = "account-1";
  const binding = { provider: "netlify", account_identity_hash: await sha256Hex(accountId), site_id: "site-1", site_slug: "student-one",
    production_url: "https://student-one.netlify.app/", build_branch: "static-build/v1.3.1-b", expected_commit_sha: "d".repeat(40), status: "configured" };
  const site = { id: "site-1", account_id: accountId, name: "student-one", ssl_url: "https://student-one.netlify.app" };
  await assert.doesNotReject(assertNetlifyBindingSite(binding, site));
  for (const changed of [
    { ...site, account_id: "another-account" },
    { ...site, name: "another-site" },
    { ...site, ssl_url: "https://another-site.netlify.app" },
  ]) await assert.rejects(assertNetlifyBindingSite(binding, changed), /冻结身份/u);
});

test("legacy R2 media freezes the current provider ETag and rejects a changed migration identity", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } });
  const bucket = { async get() { return { body, size: 90, httpEtag: "etag-v1", range: { offset: 0, length: 1 }, httpMetadata: { contentType: "video/mp4" } }; } };
  const row = { id: "media-1", object_key: "legacy/video.mp4", content_type: "video/mp4", byte_size: 90,
    storage_backend: "r2", chunk_count: 1, status: "uploaded", source_etag: "etag-v1" };
  const [frozen] = await mediaRecordsFromRows([row], bucket);
  assert.equal(frozen.sourceEtag, "etag-v1");
  const changedBody = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } });
  await assert.rejects(mediaRecordsFromRows([row], { async get() { return { body: changedBody, size: 90, httpEtag: "etag-v2", range: { offset: 0, length: 1 } }; } }), /身份已变化/u);
});

test("every artifact identity, summary, digest, marker and file-set mismatch fails closed", async () => {
  const mutations = [
    (value) => { value.manifest.providerRequestKey = "sp-bbbbbbbbbbbbbbbbbbbbbbbb"; },
    (value) => { value.manifest.sourceCommitSha = "e".repeat(40); },
    (value) => { value.manifest.publicRevision = 2; },
    (value) => { value.manifest.fileCount = 2; },
    (value) => { value.manifest.totalBytes = 6; },
    (value) => { value.manifest.artifactSha256 = "0".repeat(64); },
    (value) => { value.marker.sourceCommitSha = "e".repeat(40); },
    (value) => { value.marker.publicRevision = 2; },
    (value) => { value.providerFiles[0].size = 6; },
    (value) => { value.providerFiles.splice(1, 1); },
    (value) => { value.providerFiles[1].sha = "0".repeat(40); },
    (value) => { value.providerFiles[2].size = 2; },
  ];
  for (const mutate of mutations) {
    const value = await fixture(); mutate(value);
    await assert.rejects(verifyArtifact({ ...value, expectedCandidateSha256: "c".repeat(64), expectedSourceCommitSha: "d".repeat(40),
      expectedProviderRequestKey: "sp-aaaaaaaaaaaaaaaaaaaaaaaa", expectedPublicRevision: 1 }));
  }
});

test("the uncertainty catch performs exact-key recovery before recording failure", () => {
  const catchStart = orchestratorSource.indexOf("  } catch (error) {", orchestratorSource.indexOf("freezeAndTriggerStaticPublish"));
  const catchEnd = orchestratorSource.indexOf("  return { job: await getStaticPublishJob(jobId)", catchStart);
  const uncertaintyBlock = orchestratorSource.slice(catchStart, catchEnd);
  assert.match(uncertaintyBlock, /findDeployByRequestKey\(binding\.site_id, providerRequestKey/u);
  assert.match(uncertaintyBlock, /transitionStaticJob\(jobId, "BUILD_TRIGGERED", "DRAFT_DEPLOY_LOCATED"/u);
  assert.match(uncertaintyBlock, /未创建第二个 Build/u);
});

test("retry recovery never creates a new generation or calls the Hook again", () => {
  const retryStart = orchestratorSource.indexOf("export async function retryStaticPublish");
  const retryEnd = orchestratorSource.indexOf("export async function rollbackStaticPublish", retryStart);
  const retryBlock = orchestratorSource.slice(retryStart, retryEnd);
  assert.doesNotMatch(retryBlock, new RegExp(restartedGenerationSymbol, "u"));
  assert.doesNotMatch(retryBlock, /triggerDraftBuild/u);
  assert.doesNotMatch(retryBlock, /bootstrap_expires_at/u);
  assert.match(retryBlock, /findDeployByRequestKey\(binding\.site_id, job\.provider_request_key/u);
  assert.match(retryBlock, /deployMatch: "none"/u);
  assert.match(retryBlock, /return advanceStaticPublish\(job\.id, actorEmail\)/u);
});

test("zero match remains pending after bootstrap expiry and cannot gain a generation", () => {
  const retryStart = orchestratorSource.indexOf("export async function retryStaticPublish");
  const retryEnd = orchestratorSource.indexOf("export async function rollbackStaticPublish", retryStart);
  const retryBlock = orchestratorSource.slice(retryStart, retryEnd);
  assert.match(retryBlock, /if \(!found\)[\s\S]+NETLIFY_DEPLOY_PENDING/u);
  assert.doesNotMatch(retryBlock, /Date\.parse\(job\.bootstrap_expires_at\)/u);
  assert.doesNotMatch(retryBlock, /export_generation \+ 1/u);
});

test("a unique terminal Deploy is stopped, not ignored or replaced", () => {
  assert.match(orchestratorSource, /isTerminalFailedDeploy\(deploy\)\) throw new StaticPublishError\("NETLIFY_DRAFT_DEPLOY_FAILED"/u);
  assert.match(orchestratorSource, /isTerminalFailedDeploy\(deploy\)/u);
  const retryStart = orchestratorSource.indexOf("export async function retryStaticPublish");
  const retryEnd = orchestratorSource.indexOf("export async function rollbackStaticPublish", retryStart);
  const retryBlock = orchestratorSource.slice(retryStart, retryEnd);
  assert.doesNotMatch(retryBlock, /!isTerminalFailedDeploy/u);
});

test("multiple exact Deploy matches fail closed and no transport follow is present", () => {
  assert.match(netlifyClientSource, /NETLIFY_DEPLOY_AMBIGUOUS/u);
  assert.match(netlifyClientSource, /deployMatchForCount\(matches\.length\)/u);
  assert.doesNotMatch(netlifyClientSource, followDirective);
  assert.doesNotMatch(orchestratorSource, followDirective);
});

test("freeze path has one Hook call site and recovery binds that same Deploy", () => {
  const freezeStart = orchestratorSource.indexOf("export async function freezeAndTriggerStaticPublish");
  const freezeEnd = orchestratorSource.indexOf("export async function advanceStaticPublish", freezeStart);
  const freezeBlock = orchestratorSource.slice(freezeStart, freezeEnd);
  assert.equal((freezeBlock.match(/triggerDraftBuild\(/gu) ?? []).length, 1);
  assert.match(freezeBlock, /providerRequestKey\)/u);
  assert.match(orchestratorSource, /deployId: recovered\.id/u);
});

test("same-Deploy publication, production readback, and rollback paths remain explicit", () => {
  assert.match(orchestratorSource, /publishAndReadBackExistingDeploy\(client, binding\.site_id, deployId\)/u);
  assert.match(orchestratorSource, /assertProductionReadback\(marker\.value, deployId, artifactSha256\)/u);
  const rollbackStart = orchestratorSource.indexOf("export async function rollbackStaticPublish");
  const rollbackBlock = orchestratorSource.slice(rollbackStart);
  assert.match(rollbackBlock, /publishAndReadBackExistingDeploy\(client, binding\.site_id, targetDeployId\)/u);
  assert.match(rollbackBlock, /assertProductionReadback\(marker\.value, targetDeployId/u);
});
