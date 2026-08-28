import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships a machine-readable agent deployment contract", async () => {
  const manifest = JSON.parse(
    await readFile("deployment/agent-manifest.json", "utf8"),
  );
  assert.equal(manifest.project.target, "cloudflare-workers");
  assert.equal(manifest.project.defaultHostname, "workers.dev");
  assert.equal(manifest.project.initialContent, "empty");
  assert.deepEqual(manifest.authentication.protectedPaths, [
    "/admin*",
    "/api/admin*",
    "/preview*",
  ]);
  assert.equal(manifest.authentication.loginMethod, "one-time-pin");
  assert.equal(manifest.authentication.ownerBinding, "first-verified-email-immutable");
  assert.ok(manifest.liveTests.length >= 10);
});

test("exposes a public Deploy to Cloudflare template with auto-provisioned storage", async () => {
  const wrangler = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
  const readme = await readFile("README.md", "utf8");
  assert.equal(wrangler.main, "./cloudflare/worker-entry.js");
  assert.equal(wrangler.d1_databases[0].binding, "DB");
  assert.equal("database_id" in wrangler.d1_databases[0], false);
  assert.equal(wrangler.r2_buckets[0].binding, "BUCKET");
  assert.match(readme, /deploy\.workers\.cloudflare\.com\/\?url=https:\/\/github\.com\//);
  assert.match(readme, /student-portfolio-cloudflare/);
});

test("tells deployment agents to use account authorization without collecting passwords", async () => {
  const instructions = await readFile("AGENTS.md", "utf8");
  assert.match(instructions, /official browser login/i);
  assert.match(instructions, /Do not ask the owner to type shell commands/i);
  assert.match(instructions, /Never request a Cloudflare password/i);
  assert.match(instructions, /resume/i);
});
