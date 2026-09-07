import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const source = await readFile(new URL("../scripts/build-netlify-static.mjs", import.meta.url), "utf8");
const config = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
const { buildNetlifyStatic, writeResponseWithDigests } = await import("../scripts/build-netlify-static.mjs");
const { createDefaultPortfolioDocument } = await import("../app/portfolio/default-document.ts");

test("Netlify config builds only the frozen branch and production context fails closed", () => {
  assert.match(config, /publish = "netlify-dist"/u);
  assert.match(config, /context\."static-build\/v1\.3\.1-b"/u);
  assert.match(config, /Production builds are disabled/u);
});

test("builder requires exact deploy identity and never logs hook body or bearer", () => {
  assert.match(source, /required\(environment\.DEPLOY_ID/u);
  assert.match(source, /required\(environment\.INCOMING_HOOK_BODY/u);
  assert.doesNotMatch(source, /console\.(log|error)\([^\n]*(INCOMING_HOOK_BODY|Authorization|bootstrapGrant|session\.lease)/u);
  assert.match(source, /artifact-manifest\.json/u);
  assert.match(source, /__static-release\.json/u);
});

test("a real frozen candidate produces a complete hashed, self-contained artifact with exact digests", async () => {
  const output = await mkdtemp(join(tmpdir(), "static-artifact-"));
  await rm(output, { recursive: true, force: true });
  const hook = { jobId: `job_${"a".repeat(32)}`, generation: 1, providerRequestKey: "sp-aaaaaaaaaaaaaaaaaaaaaaaa",
    bootstrapGrant: "bootstrap_grant_that_is_long_enough" };
  const candidate = createDefaultPortfolioDocument();
  const manifestSource = { schemaVersion: 1, jobId: hook.jobId, generation: 1, publicRevision: 1,
    providerRequestKey: hook.providerRequestKey, candidateSha256: "c".repeat(64), sourceCommitSha: "d".repeat(40),
    candidate, media: [] };
  try {
    const result = await buildNetlifyStatic({ output, env: {
      DEPLOY_ID: "deploy-unit", STATIC_EXPORT_ORIGIN: "https://worker.example.test",
      INCOMING_HOOK_BODY: JSON.stringify(hook), COMMIT_REF: "d".repeat(40), NETLIFY_SITE_ID_HASH: "site-hash",
      WORKER_ADMIN_URL: "https://worker.example.test/admin",
    }, fetcher: async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/session")) return jsonResponse({ lease: "lease_for_static_unit_test" });
      if (pathname.endsWith("/manifest")) return jsonResponse(manifestSource);
      return jsonResponse({}, 404);
    } });
    const paths = result.artifactManifest.files.map((file) => file.path);
    assert.ok(paths.some((path) => /^assets\/index-[A-Za-z0-9_-]+\.js$/u.test(path)), "hashed JavaScript is missing");
    assert.ok(paths.some((path) => /^assets\/index-[A-Za-z0-9_-]+\.css$/u.test(path)), "hashed CSS is missing");
    for (const file of result.artifactManifest.files) {
      const path = join(output, ...file.path.split("/"));
      const bytes = await readFile(path);
      assert.equal((await stat(path)).size, file.byteSize, file.path);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.path);
      assert.equal(createHash("sha1").update(bytes).digest("hex"), file.providerSha1, file.path);
      if (/\.(?:html|js|css|json|txt)$/u.test(file.path) || file.path === "_headers" || file.path === "_redirects") {
        const text = bytes.toString("utf8");
        assert.doesNotMatch(text, /\/api\/|NETLIFY_AUTH_TOKEN|NETLIFY_DRAFT_BUILD_HOOK|STATIC_EXPORT_SIGNING_KEY|owner@example\.invalid/u, file.path);
      }
    }
    const marker = JSON.parse(await readFile(join(output, "__static-release.json"), "utf8"));
    assert.equal(marker.deployId, "deploy-unit");
    assert.equal(marker.artifactSha256, result.artifactManifest.artifactSha256);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

for (const [label, byteSize] of [["new 50 MiB video", 50 * 1024 * 1024], ["legacy 90 MiB video", 90 * 1024 * 1024]]) {
  test(`streaming writer preserves ${label} without buffering the complete file`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "static-media-")); const target = join(directory, "video.mp4");
    const chunk = new Uint8Array(1024 * 1024); chunk.fill(0x5a); let sent = 0;
    const body = new ReadableStream({ pull(controller) { if (sent >= byteSize) return controller.close(); controller.enqueue(chunk); sent += chunk.byteLength; } });
    const result = await writeResponseWithDigests(new Response(body), target);
    assert.equal(result.byteSize, byteSize); assert.equal(result.sha256.length, 64); assert.equal(result.providerSha1.length, 40);
    assert.equal(createHash("sha256").update(await readFile(target)).digest("hex"), result.sha256);
    await rm(directory, { recursive: true, force: true });
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
