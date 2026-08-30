import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const {
  legacyMediaChunkCount,
  legacyMediaChunkLength,
  migrateLegacyMediaChunkWith,
} = await import("../app/api/_lib/legacy-media.ts");

const MiB = 1024 * 1024;

test("plans legacy 50–90 MiB objects as resumable 4 MiB chunks", () => {
  assert.equal(legacyMediaChunkCount(50 * MiB), 13);
  assert.equal(legacyMediaChunkCount(90 * MiB), 23);
  assert.equal(legacyMediaChunkLength(90 * MiB, 22), 2 * MiB);
});

test("copies one chunk at a time, verifies KV readback, and switches with CAS only after completion", async () => {
  const sourceBytes = new TextEncoder().encode("ABCDEFGHIJ");
  const target = new Map();
  const state = createMigrationState({
    id: "legacy-media-1",
    object_key: "portfolio/project-one/legacy.mp4",
    byte_size: sourceBytes.byteLength,
  });
  let deletes = 0;
  const source = createBucketSource(sourceBytes, state.media.object_key, "legacy-etag");
  const bucket = { ...source.bucket, async delete() { deletes += 1; } };
  const kv = {
    async put(key, value) {
      const bytes = value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer();
      target.set(key, bytes.slice(0));
    },
    async get(key) { return target.get(key) ?? null; },
  };

  const first = await migrateLegacyMediaChunkWith({ store: state.store, bucket, kv, chunkSize: 4 });
  assert.equal(first.status, "copying");
  assert.equal(first.verifiedChunks, 1);
  assert.equal(state.media.storage_backend, "r2");

  const second = await migrateLegacyMediaChunkWith({ store: state.store, bucket, kv, chunkSize: 4 });
  assert.equal(second.status, "copying");
  assert.equal(state.media.storage_backend, "r2");

  const third = await migrateLegacyMediaChunkWith({ store: state.store, bucket, kv, chunkSize: 4 });
  assert.equal(third.status, "final-verifying");
  assert.equal(third.finalVerifiedChunks, 0);
  assert.equal(state.media.storage_backend, "r2");

  const fourth = await migrateLegacyMediaChunkWith({ store: state.store, bucket, kv, chunkSize: 4 });
  assert.equal(fourth.status, "final-verifying");
  assert.equal(fourth.finalVerifiedChunks, 1);
  assert.equal(state.media.storage_backend, "r2");

  const fifth = await migrateLegacyMediaChunkWith({ store: state.store, bucket, kv, chunkSize: 4 });
  assert.equal(fifth.status, "final-verifying");
  assert.equal(fifth.finalVerifiedChunks, 2);
  assert.equal(state.media.storage_backend, "r2");

  const sixth = await migrateLegacyMediaChunkWith({ store: state.store, bucket, kv, chunkSize: 4 });
  assert.equal(sixth.status, "file-completed");
  assert.equal(sixth.finalVerifiedChunks, 3);
  assert.equal(state.media.storage_backend, "kv");
  assert.equal(state.media.chunk_size, 4);
  assert.equal(state.media.chunk_count, 3);
  assert.equal(state.casCalls, 1);
  assert.equal(state.sourceEtag, "legacy-etag");
  assert.equal(state.finalVerified.length, 3);
  assert.equal(deletes, 0);
  assert.deepEqual([...target.keys()], [
    `${state.media.object_key}::chunk:0000`,
    `${state.media.object_key}::chunk:0001`,
    `${state.media.object_key}::chunk:0002`,
  ]);
});

test("does not record or switch a chunk when KV readback differs from R2", async () => {
  const sourceBytes = new TextEncoder().encode("ABCD");
  const state = createMigrationState({
    id: "legacy-media-2",
    object_key: "portfolio/project-two/legacy.mp4",
    byte_size: sourceBytes.byteLength,
  });
  const source = createBucketSource(sourceBytes, state.media.object_key, "legacy-etag");
  const bucket = { ...source.bucket, async delete() { throw new Error("迁移不应删除 R2"); } };
  const kv = {
    async put() {},
    async get() { return new TextEncoder().encode("WXYZ").buffer; },
  };

  await assert.rejects(
    migrateLegacyMediaChunkWith({ store: state.store, bucket, kv, chunkSize: 4 }),
    /校验失败/u,
  );
  assert.equal(state.verified.length, 0);
  assert.equal(state.media.storage_backend, "r2");
  assert.equal(state.casCalls, 0);
});

test("rejects a complete-looking ledger with incorrect per-chunk byte sizes before CAS", async () => {
  const state = createMigrationState({
    id: "legacy-media-3",
    object_key: "portfolio/project-three/legacy.mp4",
    byte_size: 8,
  });
  state.verified = [
    { index: 0, byteSize: 3, sha256: "a".repeat(64) },
    { index: 1, byteSize: 5, sha256: "b".repeat(64) },
  ];
  const source = createBucketSource(new TextEncoder().encode("ABCDEFGH"), state.media.object_key, "legacy-etag");
  const bucket = { ...source.bucket, async delete() { throw new Error("迁移不应删除 R2"); } };
  const kv = {
    async put() { throw new Error("完整台账不应重写目标分片"); },
    async get() { throw new Error("完整台账不应回读目标分片"); },
  };

  await assert.rejects(
    migrateLegacyMediaChunkWith({ store: state.store, bucket, kv, chunkSize: 4 }),
    /分片字节数与原文件不一致/u,
  );
  assert.equal(state.media.storage_backend, "r2");
  assert.equal(state.casCalls, 0);
});

test("fails closed when the same-size R2 source changes ETag between resumptions", async () => {
  const sourceBytes = new TextEncoder().encode("ABCDEFGH");
  const target = new Map();
  const state = createMigrationState({
    id: "legacy-media-4",
    object_key: "portfolio/project-four/legacy.mp4",
    byte_size: sourceBytes.byteLength,
  });
  const source = createBucketSource(sourceBytes, state.media.object_key, "source-v1");
  const kv = memoryKv(target);

  const first = await migrateLegacyMediaChunkWith({ store: state.store, bucket: source.bucket, kv, chunkSize: 4 });
  assert.equal(first.status, "copying");
  assert.equal(state.sourceEtag, "source-v1");

  source.etag = "source-v2";
  await assert.rejects(
    migrateLegacyMediaChunkWith({ store: state.store, bucket: source.bucket, kv, chunkSize: 4 }),
    /版本标识已变化/u,
  );
  assert.equal(state.verified.length, 1);
  assert.equal(state.media.storage_backend, "r2");
  assert.equal(state.casCalls, 0);
});

test("final verification fails closed when a copied KV chunk is missing or changed", async (t) => {
  for (const scenario of ["missing", "changed"]) {
    await t.test(scenario, async () => {
      const sourceBytes = new TextEncoder().encode("ABCD");
      const target = new Map();
      const state = createMigrationState({
        id: `legacy-media-final-${scenario}`,
        object_key: `portfolio/final-${scenario}/legacy.mp4`,
        byte_size: sourceBytes.byteLength,
      });
      const source = createBucketSource(sourceBytes, state.media.object_key, "stable-source");
      const kv = memoryKv(target);

      const copied = await migrateLegacyMediaChunkWith({ store: state.store, bucket: source.bucket, kv, chunkSize: 4 });
      assert.equal(copied.status, "final-verifying");
      const key = `${state.media.object_key}::chunk:0000`;
      if (scenario === "missing") target.delete(key);
      else target.set(key, new TextEncoder().encode("WXYZ").buffer);

      await assert.rejects(
        migrateLegacyMediaChunkWith({ store: state.store, bucket: source.bucket, kv, chunkSize: 4 }),
        /最终复验失败/u,
      );
      assert.equal(state.finalVerified.length, 0);
      assert.equal(state.media.storage_backend, "r2");
      assert.equal(state.casCalls, 0);
    });
  }
});

function createMigrationState(media) {
  const state = {
    media: { ...media, storage_backend: "r2", chunk_size: null, chunk_count: 1 },
    verified: [],
    finalVerified: [],
    sourceEtag: null,
    status: "copying",
    completed: false,
    casCalls: 0,
  };
  state.store = {
    async nextLegacyMedia() {
      return state.media.storage_backend === "r2" ? state.media : null;
    },
    async getOrCreateState(row, chunkSize, chunkCount, sourceEtag) {
      state.sourceEtag ??= sourceEtag;
      return {
        media_id: row.id,
        object_key: row.object_key,
        byte_size: row.byte_size,
        chunk_size: chunkSize,
        chunk_count: chunkCount,
        verified_chunks_json: JSON.stringify(state.verified),
        source_etag: state.sourceEtag,
        final_verified_chunks_json: JSON.stringify(state.finalVerified),
        status: state.completed ? "completed" : state.status,
      };
    },
    async markChunkVerified(_mediaId, sourceEtag, verified) {
      assert.equal(sourceEtag, state.sourceEtag);
      state.verified = structuredClone(verified);
    },
    async beginFinalVerification(_mediaId, sourceEtag) {
      assert.equal(sourceEtag, state.sourceEtag);
      state.status = "final-verifying";
      state.finalVerified = [];
    },
    async markFinalChunkVerified(_mediaId, sourceEtag, verified) {
      assert.equal(sourceEtag, state.sourceEtag);
      state.finalVerified = structuredClone(verified);
    },
    async recordError() {},
    async switchBackend(_mediaId, _objectKey, _byteSize, chunkSize, chunkCount, sourceEtag) {
      assert.equal(sourceEtag, state.sourceEtag);
      state.casCalls += 1;
      if (state.media.storage_backend !== "r2") return false;
      state.media.storage_backend = "kv";
      state.media.chunk_size = chunkSize;
      state.media.chunk_count = chunkCount;
      return true;
    },
    async markCompleted() { state.completed = true; state.status = "completed"; },
  };
  return state;
}

function createBucketSource(bytes, objectKey, initialEtag) {
  const source = {
    etag: initialEtag,
    bucket: {
      async get(key, options) {
        assert.equal(key, objectKey);
        const match = /bytes=(\d+)-(\d+)/u.exec(options.range.get("range"));
        const start = Number(match[1]);
        const end = Number(match[2]);
        const part = bytes.slice(start, end + 1);
        return {
          body: new Response(part).body,
          size: bytes.byteLength,
          httpEtag: source.etag,
          range: { offset: start, length: part.byteLength },
        };
      },
      async delete() { throw new Error("迁移不应删除 R2"); },
    },
  };
  return source;
}

function memoryKv(target) {
  return {
    async put(key, value) {
      const bytes = value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer();
      target.set(key, bytes.slice(0));
    },
    async get(key) { return target.get(key) ?? null; },
  };
}
