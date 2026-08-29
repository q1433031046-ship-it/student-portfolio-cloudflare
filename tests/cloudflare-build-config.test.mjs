import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generated Worker config keeps one production D1 and no R2 binding", async () => {
  const config = JSON.parse(await readFile("dist/server/wrangler.json", "utf8"));
  const databaseBindings = config.d1_databases?.filter((binding) => binding.binding === "DB") ?? [];
  const mediaBindings = config.kv_namespaces?.filter((binding) => binding.binding === "MEDIA_KV") ?? [];

  assert.equal(databaseBindings.length, 1);
  assert.equal(databaseBindings[0].database_name, "student-portfolio-db");
  assert.equal(mediaBindings.length, 1);
  assert.deepEqual(config.r2_buckets ?? [], []);
  assert.equal(new Set(config.compatibility_flags ?? []).size, (config.compatibility_flags ?? []).length);
});
