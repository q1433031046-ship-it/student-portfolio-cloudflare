import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("generated Worker config keeps independent auto-provisioned storage bindings", async () => {
  const config = JSON.parse(await readFile("dist/server/wrangler.json", "utf8"));
  const databaseBindings = config.d1_databases?.filter((binding) => binding.binding === "DB") ?? [];
  const mediaBindings = config.kv_namespaces?.filter((binding) => binding.binding === "MEDIA_KV") ?? [];

  assert.equal(databaseBindings.length, 1);
  assert.equal(resolve("dist/server", databaseBindings[0].migrations_dir), resolve("drizzle"));
  assert.equal("database_name" in databaseBindings[0], false);
  assert.equal("database_id" in databaseBindings[0], false);
  assert.equal(mediaBindings.length, 1);
  assert.equal("id" in mediaBindings[0], false);
  assert.deepEqual(config.r2_buckets ?? [], []);
  assert.equal(new Set(config.compatibility_flags ?? []).size, (config.compatibility_flags ?? []).length);
});

test("Worker root redirects only from a committed static pointer and keeps admin/API paths local", async () => {
  const source = await readFile("cloudflare/worker-entry.js", "utf8");
  assert.match(source, /requestUrl\.pathname === "\/" && !requestUrl\.search/u);
  assert.match(source, /request\.method === "GET" \|\| request\.method === "HEAD"/u);
  assert.match(source, /current_deploy_id.*current_public_revision/u);
  assert.match(source, /Number\(binding\.current_public_revision\) > 0/u);
  assert.match(source, /target\.hostname\.endsWith\("\.netlify\.app"\)/u);
  assert.match(source, /Response\.redirect\(target\.toString\(\), 302\)/u);
  assert.doesNotMatch(source, /requestUrl\.searchParams\.get/u);
});
