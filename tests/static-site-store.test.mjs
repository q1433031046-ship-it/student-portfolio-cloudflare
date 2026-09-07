import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../drizzle/0008_static_site_publish.sql", import.meta.url), "utf8");
const store = await readFile(new URL("../app/api/_lib/static-site-store.ts", import.meta.url), "utf8");

test("migration is forward-only and keeps legacy published source unknown", () => {
  assert.match(migration, /ADD `static_published_source_revision` integer/u);
  assert.doesNotMatch(migration, /UPDATE\s+`?portfolio_documents`?|DROP\s+(TABLE|COLUMN)|DELETE\s+FROM/iu);
  assert.match(migration, /`current_public_revision` integer DEFAULT 0 NOT NULL/u);
});

test("migration enforces one site identity and one idempotency key", () => {
  assert.match(migration, /UNIQUE INDEX `static_site_bindings_site_id_idx`/u);
  assert.match(migration, /UNIQUE INDEX `static_publish_jobs_idempotency_idx`/u);
  assert.match(migration, /PRIMARY KEY\(`job_id`, `media_id`\)/u);
});

test("public revisions stay monotonic after rollback and rollback restores the target job", () => {
  assert.match(store, /MAX\(public_revision\)/u);
  assert.match(store, /Math\.max\(binding\.current_public_revision/u);
  assert.match(store, /SET status = 'PUBLISHED'.*status IN \('PUBLISHED','ROLLED_BACK'\)/su);
});

test("store uses CAS for freezing, transitions and final publication", () => {
  assert.match(store, /WHERE EXISTS \(SELECT 1 FROM portfolio_documents WHERE id = 'default' AND revision = \?\)/u);
  assert.match(store, /WHERE id = \? AND status = \?/u);
  assert.match(store, /current_public_revision = \?/u);
  assert.match(store, /static_published_source_revision = \?/u);
  assert.match(store, /status = 'PRODUCTION_READBACK_VERIFIED'/u);
  assert.match(store, /assertStaticJobTransition\(expected, next\)/u);
  assert.match(store, /abs\(-9223372036854775808\)/u);
});

test("rollback is record-last and accepts only the previous verified deploy", () => {
  assert.match(store, /binding\.previous_deploy_id !== targetDeployId/u);
  assert.match(store, /status IN \('PUBLISHED','ROLLED_BACK'\) AND artifact_sha256 IS NOT NULL/u);
  assert.match(store, /status = 'rollback_in_progress'/u);
  assert.match(store, /static_published_source_revision = \?/u);
});
