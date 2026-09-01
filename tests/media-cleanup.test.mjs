import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { env } = await import("cloudflare:workers");
const { cleanupUnreferencedMedia } = await import("../app/api/_lib/media-cleanup.ts");
const { getPortfolioRecord, savePortfolioDraft } = await import("../app/api/_lib/portfolio-store.ts");
const { createDefaultPortfolioDocument } = await import("../app/portfolio/default-document.ts");

test("a first publish after schema 1 normalization retains archived media during cleanup", async () => {
  const current = createDefaultPortfolioDocument();
  const firstSlide = current.hero.slides[0];
  const legacy = {
    ...current,
    schemaVersion: 1,
    hero: {
      name: current.hero.name,
      role: current.hero.role,
      targetRole: current.hero.targetRole,
      email: current.hero.email,
      statement: current.hero.statement,
      availability: current.hero.availability,
      effect: firstSlide.effect,
      animationEnabled: firstSlide.animationEnabled,
      media: { ...firstSlide.media, key: "portfolio/site/schema-one-hero.jpg" },
    },
    projects: current.projects.map((project, index) => ({
      ...project,
      ...(index === 0
        ? {
            draftVideo: {
              id: "schema-one-draft-video",
              label: "旧媒体",
              alt: "",
              kind: "video",
              visualKey: "storyboard",
              key: "portfolio/project-one/schema-one-draft.mp4",
            },
          }
        : {}),
    })),
  };
  const deletedKvKeys = [];
  const markedDeleted = [];
  env.MEDIA_KV = {
    async delete(key) { deletedKvKeys.push(key); },
  };
  env.DB = cleanupD1({
    portfolio: {
      id: "default",
      owner_email: "owner@example.com",
      revision: 1,
      draft_json: JSON.stringify(legacy),
      published_json: JSON.stringify(legacy),
      updated_at: "2026-08-30T00:00:00.000Z",
      published_at: "2026-08-30T00:00:00.000Z",
    },
    media: [
      {
        object_key: "portfolio/project-one/schema-one-draft.mp4",
        storage_backend: "kv",
        chunk_count: 23,
      },
      {
        object_key: "portfolio/project-one/unreferenced.webp",
        storage_backend: "kv",
        chunk_count: 1,
      },
    ],
    markedDeleted,
  });

  const record = await getPortfolioRecord();
  assert.equal(record.draft.hero.slides[0].media.key, "portfolio/site/schema-one-hero.jpg");
  assert.equal(record.draft.archivedMedia[0].key, "portfolio/project-one/schema-one-draft.mp4");

  const removed = await cleanupUnreferencedMedia(record.draft, record.revision);
  assert.equal(removed, 1);
  assert.deepEqual(deletedKvKeys, ["portfolio/project-one/unreferenced.webp::chunk:0000"]);
  assert.deepEqual(markedDeleted, ["portfolio/project-one/unreferenced.webp"]);

  delete env.DB;
  delete env.MEDIA_KV;
});

test("a concurrent save that wins before cleanup claim keeps the newly referenced media", async () => {
  const key = "portfolio/project-one/reused.webp";
  const original = createDefaultPortfolioDocument();
  const claimReached = deferred();
  const releaseClaim = deferred();
  const deletedKvKeys = [];
  const rows = cleanupRows(original, [{ object_key: key, storage_backend: "kv", chunk_count: 1 }]);
  rows.beforeClaim = async () => {
    claimReached.resolve();
    await releaseClaim.promise;
  };
  env.DB = cleanupD1(rows);
  env.MEDIA_KV = { async delete(value) { deletedKvKeys.push(value); } };

  const cleaning = cleanupUnreferencedMedia(original, 1);
  await claimReached.promise;
  const saved = await savePortfolioDraft(withCoverKey(original, key), 1);
  releaseClaim.resolve();

  assert.equal(saved?.revision, 2);
  assert.equal(await cleaning, 0);
  assert.equal(rows.media[0].status, "uploaded");
  assert.deepEqual(deletedKvKeys, []);

  delete env.DB;
  delete env.MEDIA_KV;
});

test("a cleanup claim that wins first blocks a concurrent save from restoring the key", async () => {
  const key = "portfolio/project-one/claimed.webp";
  const original = createDefaultPortfolioDocument();
  const deleteReached = deferred();
  const releaseDelete = deferred();
  const rows = cleanupRows(original, [{ object_key: key, storage_backend: "kv", chunk_count: 1 }]);
  env.DB = cleanupD1(rows);
  env.MEDIA_KV = {
    async delete() {
      deleteReached.resolve();
      await releaseDelete.promise;
    },
  };

  const cleaning = cleanupUnreferencedMedia(original, 1);
  await deleteReached.promise;
  assert.equal(rows.media[0].status, "deleting");
  const saved = await savePortfolioDraft(withCoverKey(original, key), 1);
  assert.equal(saved, null);
  assert.equal(rows.portfolio.revision, 1);
  releaseDelete.resolve();

  assert.equal(await cleaning, 1);
  assert.equal(rows.media[0].status, "deleted");

  delete env.DB;
  delete env.MEDIA_KV;
});

test("draft saving also rejects a key whose media row is already deleted", async () => {
  const key = "portfolio/project-one/deleted.webp";
  const original = createDefaultPortfolioDocument();
  const rows = cleanupRows(original, [{ object_key: key, storage_backend: "kv", chunk_count: 1 }]);
  rows.media[0].status = "deleted";
  env.DB = cleanupD1(rows);

  assert.equal(await savePortfolioDraft(withCoverKey(original, key), 1), null);
  assert.equal(rows.portfolio.revision, 1);

  delete env.DB;
});

test("a failed physical delete remains deleting and retries idempotently", async () => {
  const key = "portfolio/project-one/delete-retry.webp";
  const original = createDefaultPortfolioDocument();
  const rows = cleanupRows(original, [{ object_key: key, storage_backend: "kv", chunk_count: 1 }]);
  let attempts = 0;
  env.DB = cleanupD1(rows);
  env.MEDIA_KV = {
    async delete() {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary storage failure");
    },
  };

  await assert.rejects(cleanupUnreferencedMedia(original, 1), /媒体自动清理暂时失败，稍后将重试/u);
  assert.equal(rows.media[0].status, "deleting");
  assert.equal(await cleanupUnreferencedMedia(original, 1), 1);
  assert.equal(attempts, 2);
  assert.equal(rows.media[0].status, "deleted");

  delete env.DB;
  delete env.MEDIA_KV;
});

test("a failed deleted-status write is retried after an idempotent physical delete", async () => {
  const key = "portfolio/project-one/status-retry.webp";
  const original = createDefaultPortfolioDocument();
  const rows = cleanupRows(original, [{ object_key: key, storage_backend: "kv", chunk_count: 1 }]);
  rows.failDeletedWriteOnce = true;
  let deleteAttempts = 0;
  env.DB = cleanupD1(rows);
  env.MEDIA_KV = { async delete() { deleteAttempts += 1; } };

  await assert.rejects(cleanupUnreferencedMedia(original, 1), /媒体自动清理暂时失败，稍后将重试/u);
  assert.equal(rows.media[0].status, "deleting");
  assert.equal(await cleanupUnreferencedMedia(original, 1), 1);
  assert.equal(deleteAttempts, 2);
  assert.equal(rows.media[0].status, "deleted");

  delete env.DB;
  delete env.MEDIA_KV;
});

test("automatic cleanup never deletes or retires an unreferenced legacy R2 object", async () => {
  const key = "portfolio/project-one/legacy-source.mp4";
  const original = createDefaultPortfolioDocument();
  const rows = cleanupRows(original, [{ object_key: key, storage_backend: "r2", chunk_count: 1 }]);
  let r2Deletes = 0;
  env.DB = cleanupD1(rows);
  env.BUCKET = { async delete() { r2Deletes += 1; } };

  assert.equal(await cleanupUnreferencedMedia(original, 1), 0);
  assert.equal(r2Deletes, 0);
  assert.equal(rows.media[0].status, "uploaded");

  delete env.DB;
  delete env.BUCKET;
});

test("more than one thousand older referenced rows cannot starve a later KV orphan", async () => {
  const original = createDefaultPortfolioDocument();
  const referencedKeys = Array.from({ length: 1001 }, (_, index) => `portfolio/archive/referenced-${String(index).padStart(4, "0")}.webp`);
  const document = {
    ...original,
    archivedMedia: referencedKeys.map((key, index) => ({
      id: `archive-${index}`,
      label: "",
      alt: "",
      kind: "image",
      visualKey: "frame",
      key,
    })),
  };
  const orphanKey = "portfolio/archive/later-orphan.webp";
  const rows = cleanupRows(document, [
    ...referencedKeys.map((object_key) => ({ object_key, storage_backend: "kv", chunk_count: 1 })),
    { object_key: orphanKey, storage_backend: "kv", chunk_count: 1 },
  ]);
  const deletedKvKeys = [];
  env.DB = cleanupD1(rows);
  env.MEDIA_KV = { async delete(key) { deletedKvKeys.push(key); } };

  assert.equal(await cleanupUnreferencedMedia(document, 1), 1);
  assert.deepEqual(deletedKvKeys, [`${orphanKey}::chunk:0000`]);
  assert.equal(rows.media.at(-1).status, "deleted");

  delete env.DB;
  delete env.MEDIA_KV;
});

test("publish freezes a static candidate and never cleans media before production readback", async () => {
  const source = await readFile(new URL("../app/api/admin/portfolio/publish/route.ts", import.meta.url), "utf8");
  assert.match(source, /freezeAndTriggerStaticPublish/u);
  assert.doesNotMatch(source, /cleanupUnreferencedMedia|publishPortfolio/u);
  const cleanup = await readFile(new URL("../app/api/_lib/media-cleanup.ts", import.meta.url), "utf8");
  assert.match(cleanup, /protectMediaKeysForCleanup/u);
});

function cleanupD1(rows) {
  return {
    prepare(sql) {
      let bindings = [];
      return {
        bind(...values) {
          bindings = values;
          return this;
        },
        async first() {
          if (sql.includes("FROM portfolio_documents")) return rows.portfolio;
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async all() {
          if (sql.includes("static_publish_job_media")) {
            return { results: (rows.protectedStaticKeys ?? []).map((object_key) => ({ object_key })) };
          }
          if (sql.includes("FROM portfolio_media")) {
            rows.media.forEach((row) => { row.status ??= "uploaded"; });
            const referenced = sql.includes("json_each(?)") ? new Set(JSON.parse(bindings[0])) : null;
            return {
              results: rows.media
                .filter((row) => row.storage_backend === "kv" && (row.status === "uploaded" || row.status === "deleting"))
                .filter((row) => !referenced?.has(row.object_key))
                .slice(0, 1000)
                .map((row) => ({ ...row })),
            };
          }
          throw new Error(`Unexpected all query: ${sql}`);
        },
        async run() {
          if (sql.includes("UPDATE portfolio_documents SET draft_json")) {
            const [draftJson, nextRevision, updatedAt, documentId, expectedRevision, referencedJson] = bindings;
            const referenced = new Set(JSON.parse(referencedJson));
            const invalidReference = rows.media.some((row) => row.status !== "uploaded" && referenced.has(row.object_key));
            if (documentId !== rows.portfolio.id || rows.portfolio.revision !== expectedRevision || invalidReference) return { meta: { changes: 0 } };
            Object.assign(rows.portfolio, { draft_json: draftJson, revision: nextRevision, updated_at: updatedAt });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'deleting'")) {
            await rows.beforeClaim?.();
            const [objectKey, documentId, expectedRevision] = bindings;
            const media = rows.media.find((row) => row.object_key === objectKey);
            if (!media || media.status !== "uploaded" || documentId !== rows.portfolio.id || rows.portfolio.revision !== expectedRevision) return { meta: { changes: 0 } };
            media.status = "deleting";
            return { meta: { changes: 1 } };
          }
          if (sql.includes("SET status = 'deleted'")) {
            if (rows.failDeletedWriteOnce) {
              rows.failDeletedWriteOnce = false;
              throw new Error("temporary database failure");
            }
            const [objectKey] = bindings;
            const media = rows.media.find((row) => row.object_key === objectKey);
            if (!media || media.status !== "deleting") return { meta: { changes: 0 } };
            media.status = "deleted";
            rows.markedDeleted?.push(objectKey);
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unexpected run query: ${sql}`);
        },
      };
    },
  };
}

function cleanupRows(document, media) {
  return {
    portfolio: {
      id: "default",
      owner_email: "owner@example.com",
      revision: 1,
      draft_json: JSON.stringify(document),
      published_json: JSON.stringify(document),
      updated_at: "2026-08-30T00:00:00.000Z",
      published_at: "2026-08-30T00:00:00.000Z",
    },
    media: media.map((row) => ({ ...row, status: "uploaded" })),
    markedDeleted: [],
  };
}

function withCoverKey(document, key) {
  return {
    ...document,
    projects: document.projects.map((project, index) => index === 0
      ? { ...project, cover: { ...project.cover, key } }
      : project),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
