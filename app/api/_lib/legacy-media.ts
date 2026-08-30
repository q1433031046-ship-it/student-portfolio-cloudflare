import { getPortfolioDb } from "./portfolio-store";
import {
  getBucket,
  getMediaKv,
  hasLegacyBucket,
  hasMediaKv,
  KV_UPLOAD_CHUNK_SIZE,
  kvChunkKey,
  type UploadBucket,
} from "./storage";

export const LEGACY_MEDIA_MIGRATION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS legacy_media_migrations (
  media_id text PRIMARY KEY NOT NULL,
  object_key text NOT NULL,
  byte_size integer NOT NULL,
  chunk_size integer DEFAULT 4194304 NOT NULL,
  chunk_count integer NOT NULL,
  source_etag text NOT NULL,
  verified_chunks_json text DEFAULT '[]' NOT NULL,
  final_verified_chunks_json text DEFAULT '[]' NOT NULL,
  status text DEFAULT 'copying' NOT NULL,
  last_error text,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  completed_at text,
  FOREIGN KEY (media_id) REFERENCES portfolio_media(id) ON UPDATE no action ON DELETE cascade
)`;

const LEGACY_MEDIA_MIGRATION_INDEX_SQL = `CREATE INDEX IF NOT EXISTS legacy_media_migrations_status_idx
  ON legacy_media_migrations (status, updated_at)`;

type LegacyMediaRow = {
  id: string;
  object_key: string;
  byte_size: number;
  storage_backend: "r2" | "kv";
  chunk_size: number | null;
  chunk_count: number;
};

type LegacyMigrationStateRow = {
  media_id: string;
  object_key: string;
  byte_size: number;
  chunk_size: number;
  chunk_count: number;
  source_etag: string;
  verified_chunks_json: string;
  final_verified_chunks_json: string;
  status: "copying" | "final-verifying" | "completed";
};

export type VerifiedLegacyChunk = {
  index: number;
  byteSize: number;
  sha256: string;
};

export type LegacyMediaMigrationStore = {
  nextLegacyMedia(): Promise<LegacyMediaRow | null>;
  getOrCreateState(media: LegacyMediaRow, chunkSize: number, chunkCount: number, sourceEtag: string): Promise<LegacyMigrationStateRow>;
  markChunkVerified(mediaId: string, sourceEtag: string, verified: VerifiedLegacyChunk[]): Promise<void>;
  beginFinalVerification(mediaId: string, sourceEtag: string): Promise<void>;
  markFinalChunkVerified(mediaId: string, sourceEtag: string, verified: VerifiedLegacyChunk[]): Promise<void>;
  recordError(mediaId: string, message: string): Promise<void>;
  switchBackend(mediaId: string, objectKey: string, byteSize: number, chunkSize: number, chunkCount: number, sourceEtag: string): Promise<boolean>;
  markCompleted(mediaId: string): Promise<void>;
};

type LegacyMediaKv = Pick<KVNamespace, "get" | "put">;

export type LegacyMediaMigrationResult = {
  status: "idle" | "copying" | "final-verifying" | "file-completed";
  mediaId?: string;
  objectKey?: string;
  byteSize?: number;
  verifiedChunks?: number;
  finalVerifiedChunks?: number;
  chunkCount?: number;
};

export class LegacyMediaMigrationError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = "LegacyMediaMigrationError";
    this.status = status;
  }
}

export function legacyMediaChunkCount(byteSize: number, chunkSize = KV_UPLOAD_CHUNK_SIZE) {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) throw new LegacyMediaMigrationError("旧媒体记录的文件大小无效");
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > KV_UPLOAD_CHUNK_SIZE) {
    throw new LegacyMediaMigrationError("旧媒体迁移分片大小无效");
  }
  return Math.ceil(byteSize / chunkSize);
}

export function legacyMediaChunkLength(byteSize: number, index: number, chunkSize = KV_UPLOAD_CHUNK_SIZE) {
  const chunkCount = legacyMediaChunkCount(byteSize, chunkSize);
  if (!Number.isSafeInteger(index) || index < 0 || index >= chunkCount) {
    throw new LegacyMediaMigrationError("旧媒体迁移分片序号无效");
  }
  return index === chunkCount - 1 ? byteSize - index * chunkSize : chunkSize;
}

export async function migrateNextLegacyMediaChunk(): Promise<LegacyMediaMigrationResult> {
  const summary = await getLegacyMediaMigrationSummary();
  if (!summary.required) return { status: "idle" };
  if (!hasMediaKv()) {
    throw new LegacyMediaMigrationError("未检测到媒体 KV 绑定 MEDIA_KV，无法迁移旧媒体", 503);
  }
  if (!hasLegacyBucket()) {
    throw new LegacyMediaMigrationError("未检测到旧版 R2 存储绑定 BUCKET，无法迁移旧媒体；请先恢复原绑定后重试", 409);
  }
  return migrateLegacyMediaChunkWith({
    store: createD1MigrationStore(),
    bucket: getBucket(),
    kv: getMediaKv(),
  });
}

export async function migrateLegacyMediaChunkWith(input: {
  store: LegacyMediaMigrationStore;
  bucket: UploadBucket;
  kv: LegacyMediaKv;
  chunkSize?: number;
}): Promise<LegacyMediaMigrationResult> {
  const chunkSize = input.chunkSize ?? KV_UPLOAD_CHUNK_SIZE;
  const media = await input.store.nextLegacyMedia();
  if (!media) return { status: "idle" };

  const chunkCount = legacyMediaChunkCount(Number(media.byte_size), chunkSize);
  const source = await readSourceIdentity(input.bucket, media);
  const state = await input.store.getOrCreateState(media, chunkSize, chunkCount, source.etag);
  assertStateMatchesMedia(state, media, chunkSize, chunkCount, source.etag);
  if (state.status === "completed") {
    throw new LegacyMediaMigrationError("旧媒体迁移状态与存储后端不一致，已停止迁移");
  }

  let copied = parseVerifiedChunks(state.verified_chunks_json, chunkCount);
  let finalVerified = parseVerifiedChunks(state.final_verified_chunks_json, chunkCount);
  assertVerifiedChunkSizes(copied, media.byte_size, chunkSize);
  assertVerifiedChunkSizes(finalVerified, media.byte_size, chunkSize);
  assertFinalLedgerMatchesCopied(finalVerified, copied);
  if (state.status === "copying" && finalVerified.length > 0) {
    throw new LegacyMediaMigrationError("旧媒体最终复验台账与当前阶段不一致，已停止迁移");
  }

  if (state.status === "copying") {
    const missingIndex = firstMissingChunk(copied, chunkCount);
    if (missingIndex !== null) {
      try {
        const entry = await copyAndVerifyChunk(
          input.bucket,
          input.kv,
          media,
          missingIndex,
          chunkSize,
          state.source_etag,
        );
        copied = [...copied, entry].sort((left, right) => left.index - right.index);
        await input.store.markChunkVerified(media.id, state.source_etag, copied);
        if (copied.length < chunkCount) {
          return migrationProgress(media, copied.length, finalVerified.length, chunkCount, "copying");
        }
      } catch (error) {
        await recordMigrationError(input.store, media.id, error);
        throw error;
      }
    }

    assertCompleteLedger(copied, media.byte_size, chunkCount);
    const beforeFinalVerification = await readSourceIdentity(input.bucket, media);
    assertSourceEtag(state.source_etag, beforeFinalVerification.etag);
    await input.store.beginFinalVerification(media.id, state.source_etag);
    finalVerified = [];
    return migrationProgress(media, copied.length, 0, chunkCount, "final-verifying");
  }

  if (state.status !== "final-verifying") {
    throw new LegacyMediaMigrationError("旧媒体迁移阶段无效，已停止迁移");
  }

  assertCompleteLedger(copied, media.byte_size, chunkCount);
  const missingFinalIndex = firstMissingChunk(finalVerified, chunkCount);
  if (missingFinalIndex !== null) {
    try {
      const copiedEntry = copied.find((entry) => entry.index === missingFinalIndex);
      if (!copiedEntry) throw new LegacyMediaMigrationError("旧媒体迁移台账缺少待复验分片");
      const entry = await finalVerifyKvChunk(input.kv, media, copiedEntry);
      finalVerified = [...finalVerified, entry].sort((left, right) => left.index - right.index);
      await input.store.markFinalChunkVerified(media.id, state.source_etag, finalVerified);
      if (finalVerified.length < chunkCount) {
        return migrationProgress(media, copied.length, finalVerified.length, chunkCount, "final-verifying");
      }
    } catch (error) {
      await recordMigrationError(input.store, media.id, error);
      throw error;
    }
  }

  assertCompleteLedger(finalVerified, media.byte_size, chunkCount);
  assertFinalLedgerMatchesCopied(finalVerified, copied);
  const beforeSwitch = await readSourceIdentity(input.bucket, media);
  assertSourceEtag(state.source_etag, beforeSwitch.etag);
  const switched = await input.store.switchBackend(
    media.id,
    media.object_key,
    media.byte_size,
    chunkSize,
    chunkCount,
    state.source_etag,
  );
  if (!switched) throw new LegacyMediaMigrationError("旧媒体状态已变化，未切换存储后端，请刷新后重试");
  await input.store.markCompleted(media.id);
  return migrationProgress(media, chunkCount, chunkCount, chunkCount, "file-completed");
}

export async function ensureLegacyMediaMigrationTable() {
  const db = getPortfolioDb();
  await db.prepare(LEGACY_MEDIA_MIGRATION_TABLE_SQL).run();
  await db.prepare(LEGACY_MEDIA_MIGRATION_INDEX_SQL).run();
  await db.prepare(`UPDATE legacy_media_migrations
    SET status = 'completed', last_error = NULL,
      completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE status = 'final-verifying' AND media_id IN (
      SELECT id FROM portfolio_media WHERE storage_backend = 'kv'
    )`).run();
}

export async function getLegacyMediaMigrationSummary() {
  await ensureLegacyMediaMigrationTable();
  const db = getPortfolioDb();
  const media = await db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status = 'uploaded' AND storage_backend = 'r2' THEN 1 ELSE 0 END), 0) AS r2_file_count,
      COALESCE(SUM(CASE WHEN status = 'uploaded' AND storage_backend = 'r2' THEN byte_size ELSE 0 END), 0) AS r2_bytes,
      COALESCE(SUM(CASE WHEN status = 'uploaded' AND storage_backend = 'r2'
        THEN CAST((byte_size + 4194303) / 4194304 AS INTEGER) ELSE 0 END), 0) AS r2_chunk_count
    FROM portfolio_media`).first<{ r2_file_count: number; r2_bytes: number; r2_chunk_count: number }>();
  const states = await db.prepare(`SELECT migration.verified_chunks_json,
      migration.final_verified_chunks_json, migration.status
    FROM legacy_media_migrations migration
    INNER JOIN portfolio_media media ON media.id = migration.media_id
    WHERE migration.status != 'completed' AND media.status = 'uploaded' AND media.storage_backend = 'r2'`)
    .all<{
      verified_chunks_json: string;
      final_verified_chunks_json: string;
      status: "copying" | "final-verifying";
    }>();
  const copied = (states.results ?? []).flatMap((row) => parseVerifiedChunksLenient(row.verified_chunks_json));
  const finalVerified = (states.results ?? []).flatMap((row) => parseVerifiedChunksLenient(row.final_verified_chunks_json));
  const phaseTransitions = (states.results ?? []).filter((row) => row.status === "final-verifying").length;
  const r2FileCount = Math.max(0, Number(media?.r2_file_count ?? 0));
  const r2Bytes = Math.max(0, Number(media?.r2_bytes ?? 0));
  const sourceBindingAvailable = hasLegacyBucket();
  const targetBindingAvailable = hasMediaKv();
  const status = r2FileCount === 0
    ? "complete"
    : sourceBindingAvailable && targetBindingAvailable
      ? "ready"
      : "blocked";
  return {
    status,
    required: r2FileCount > 0,
    r2FileCount,
    r2Bytes,
    verifiedChunks: copied.length + finalVerified.length + phaseTransitions,
    verifiedBytes: [...copied, ...finalVerified].reduce((sum, chunk) => sum + chunk.byteSize, 0),
    totalChunks: Math.max(0, Number(media?.r2_chunk_count ?? 0) * 2 + r2FileCount),
    sourceBindingAvailable,
    targetBindingAvailable,
    message: status === "complete"
      ? "旧媒体迁移已完成"
      : status === "ready"
        ? "检测到旧版 R2 媒体，可以安全续传到 MEDIA_KV"
        : !sourceBindingAvailable
          ? "检测到旧版 R2 媒体，但缺少原 BUCKET 绑定；请先恢复原绑定"
          : "检测到旧版 R2 媒体，但缺少 MEDIA_KV 绑定",
  } as const;
}

function createD1MigrationStore(): LegacyMediaMigrationStore {
  const db = getPortfolioDb();
  return {
    async nextLegacyMedia() {
      return db.prepare(`SELECT id, object_key, byte_size, storage_backend, chunk_size, chunk_count
        FROM portfolio_media
        WHERE status = 'uploaded' AND storage_backend = 'r2'
        ORDER BY created_at ASC, id ASC LIMIT 1`).first<LegacyMediaRow>();
    },
    async getOrCreateState(media, chunkSize, chunkCount, sourceEtag) {
      const now = new Date().toISOString();
      await db.prepare(`INSERT OR IGNORE INTO legacy_media_migrations (
          media_id, object_key, byte_size, chunk_size, chunk_count, source_etag,
          verified_chunks_json, final_verified_chunks_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', 'copying', ?, ?)`)
        .bind(media.id, media.object_key, media.byte_size, chunkSize, chunkCount, sourceEtag, now, now)
        .run();
      const row = await db.prepare(`SELECT media_id, object_key, byte_size, chunk_size, chunk_count,
          source_etag, verified_chunks_json, final_verified_chunks_json, status
        FROM legacy_media_migrations WHERE media_id = ? LIMIT 1`)
        .bind(media.id)
        .first<LegacyMigrationStateRow>();
      if (!row) throw new LegacyMediaMigrationError("无法建立旧媒体迁移进度记录", 503);
      return row;
    },
    async markChunkVerified(mediaId, sourceEtag, verified) {
      const result = await db.prepare(`UPDATE legacy_media_migrations
        SET verified_chunks_json = ?, status = 'copying', last_error = NULL, updated_at = ?
        WHERE media_id = ? AND source_etag = ? AND status = 'copying'`)
        .bind(JSON.stringify(verified), new Date().toISOString(), mediaId, sourceEtag)
        .run();
      if (Number(result.meta.changes ?? 0) !== 1) {
        throw new LegacyMediaMigrationError("旧媒体复制进度发生变化，已停止本次操作");
      }
    },
    async beginFinalVerification(mediaId, sourceEtag) {
      const result = await db.prepare(`UPDATE legacy_media_migrations
        SET status = 'final-verifying', final_verified_chunks_json = '[]',
          last_error = NULL, updated_at = ?
        WHERE media_id = ? AND source_etag = ? AND status = 'copying'`)
        .bind(new Date().toISOString(), mediaId, sourceEtag)
        .run();
      if (Number(result.meta.changes ?? 0) !== 1) {
        throw new LegacyMediaMigrationError("旧媒体迁移阶段发生变化，已停止本次操作");
      }
    },
    async markFinalChunkVerified(mediaId, sourceEtag, verified) {
      const result = await db.prepare(`UPDATE legacy_media_migrations
        SET final_verified_chunks_json = ?, last_error = NULL, updated_at = ?
        WHERE media_id = ? AND source_etag = ? AND status = 'final-verifying'`)
        .bind(JSON.stringify(verified), new Date().toISOString(), mediaId, sourceEtag)
        .run();
      if (Number(result.meta.changes ?? 0) !== 1) {
        throw new LegacyMediaMigrationError("旧媒体最终复验进度发生变化，已停止本次操作");
      }
    },
    async recordError(mediaId, message) {
      await db.prepare("UPDATE legacy_media_migrations SET last_error = ?, updated_at = ? WHERE media_id = ?")
        .bind(message, new Date().toISOString(), mediaId)
        .run();
    },
    async switchBackend(mediaId, objectKey, byteSize, chunkSize, chunkCount, sourceEtag) {
      const result = await db.prepare(`UPDATE portfolio_media
        SET storage_backend = 'kv', chunk_size = ?, chunk_count = ?
        WHERE id = ? AND object_key = ? AND byte_size = ? AND status = 'uploaded' AND storage_backend = 'r2'
          AND EXISTS (
            SELECT 1 FROM legacy_media_migrations
            WHERE media_id = ? AND source_etag = ? AND status = 'final-verifying'
          )`)
        .bind(chunkSize, chunkCount, mediaId, objectKey, byteSize, mediaId, sourceEtag)
        .run();
      if (Number(result.meta.changes ?? 0) === 1) return true;
      const current = await db.prepare(`SELECT media.storage_backend, media.chunk_size, media.chunk_count,
          migration.source_etag
        FROM portfolio_media media
        LEFT JOIN legacy_media_migrations migration ON migration.media_id = media.id
        WHERE media.id = ? AND media.object_key = ? AND media.byte_size = ? LIMIT 1`)
        .bind(mediaId, objectKey, byteSize)
        .first<{ storage_backend: "r2" | "kv"; chunk_size: number | null; chunk_count: number; source_etag: string | null }>();
      return current?.storage_backend === "kv"
        && Number(current.chunk_size) === chunkSize
        && Number(current.chunk_count) === chunkCount
        && current.source_etag === sourceEtag;
    },
    async markCompleted(mediaId) {
      const now = new Date().toISOString();
      const result = await db.prepare(`UPDATE legacy_media_migrations
        SET status = 'completed', last_error = NULL, completed_at = COALESCE(completed_at, ?), updated_at = ?
        WHERE media_id = ? AND status = 'final-verifying'`)
        .bind(now, now, mediaId)
        .run();
      if (Number(result.meta.changes ?? 0) !== 1) {
        const current = await db.prepare("SELECT status FROM legacy_media_migrations WHERE media_id = ? LIMIT 1")
          .bind(mediaId)
          .first<{ status: string }>();
        if (current?.status !== "completed") {
          throw new LegacyMediaMigrationError("旧媒体完成状态写入失败，请刷新后重试");
        }
      }
    },
  };
}

async function readSourceIdentity(bucket: UploadBucket, media: LegacyMediaRow) {
  const range = new Headers({ Range: "bytes=0-0" });
  const source = await bucket.get(media.object_key, { range });
  if (!source) throw new LegacyMediaMigrationError(`R2 中找不到旧媒体：${media.object_key}`);
  if (Number(source.size) !== media.byte_size) {
    await source.body.cancel().catch(() => undefined);
    throw new LegacyMediaMigrationError(`旧媒体大小与记录不一致：${media.object_key}`);
  }
  if (!source.range || source.range.offset !== 0 || source.range.length !== 1) {
    await source.body.cancel().catch(() => undefined);
    throw new LegacyMediaMigrationError("R2 未返回可靠的分片范围，已停止旧媒体迁移");
  }
  const etag = typeof source.httpEtag === "string" ? source.httpEtag.trim() : "";
  await source.body.cancel().catch(() => undefined);
  if (etag.length === 0 || etag.length > 512) {
    throw new LegacyMediaMigrationError("R2 未返回可靠的对象版本标识，已停止旧媒体迁移");
  }
  return { etag };
}

async function copyAndVerifyChunk(
  bucket: UploadBucket,
  kv: LegacyMediaKv,
  media: LegacyMediaRow,
  index: number,
  chunkSize: number,
  sourceEtag: string,
): Promise<VerifiedLegacyChunk> {
  const expectedLength = legacyMediaChunkLength(media.byte_size, index, chunkSize);
  const start = index * chunkSize;
  const end = start + expectedLength - 1;
  const range = new Headers({ Range: `bytes=${start}-${end}` });
  const source = await bucket.get(media.object_key, { range });
  if (!source) throw new LegacyMediaMigrationError(`R2 中找不到旧媒体：${media.object_key}`);
  assertSourceEtag(sourceEtag, source.httpEtag);
  if (Number(source.size) !== media.byte_size) {
    throw new LegacyMediaMigrationError(`旧媒体大小与记录不一致：${media.object_key}`);
  }
  if (source.range && (source.range.offset !== start || source.range.length !== expectedLength)) {
    throw new LegacyMediaMigrationError(`R2 返回的旧媒体分片范围不正确：第 ${index + 1} 块`);
  }
  const sourceBytes = await new Response(source.body).arrayBuffer();
  if (sourceBytes.byteLength !== expectedLength) {
    throw new LegacyMediaMigrationError(`R2 旧媒体分片字节数不正确：第 ${index + 1} 块`);
  }
  const sourceHash = await sha256(sourceBytes);
  const targetKey = kvChunkKey(media.object_key, index);
  await kv.put(targetKey, sourceBytes, {
    metadata: {
      migratedFrom: "r2",
      sourceObjectKey: media.object_key,
      chunkIndex: index,
      byteSize: sourceBytes.byteLength,
      sha256: sourceHash,
    },
  });
  const targetBytes = await kv.get(targetKey, { type: "arrayBuffer" }) as ArrayBuffer | null;
  if (!targetBytes || targetBytes.byteLength !== sourceBytes.byteLength) {
    throw new LegacyMediaMigrationError(`KV 回读字节数校验失败：第 ${index + 1} 块`);
  }
  const targetHash = await sha256(targetBytes);
  if (!constantTimeHexEqual(sourceHash, targetHash)) {
    throw new LegacyMediaMigrationError(`KV 回读 SHA-256 校验失败：第 ${index + 1} 块`);
  }
  return { index, byteSize: sourceBytes.byteLength, sha256: sourceHash };
}

async function finalVerifyKvChunk(
  kv: LegacyMediaKv,
  media: LegacyMediaRow,
  copied: VerifiedLegacyChunk,
): Promise<VerifiedLegacyChunk> {
  const targetKey = kvChunkKey(media.object_key, copied.index);
  const targetBytes = await kv.get(targetKey, { type: "arrayBuffer" }) as ArrayBuffer | null;
  if (!targetBytes || targetBytes.byteLength !== copied.byteSize) {
    throw new LegacyMediaMigrationError(`KV 最终复验失败：第 ${copied.index + 1} 块缺失或字节数不正确`);
  }
  const targetHash = await sha256(targetBytes);
  if (!constantTimeHexEqual(copied.sha256, targetHash)) {
    throw new LegacyMediaMigrationError(`KV 最终复验失败：第 ${copied.index + 1} 块 SHA-256 不一致`);
  }
  return { ...copied };
}

function assertStateMatchesMedia(
  state: LegacyMigrationStateRow,
  media: LegacyMediaRow,
  chunkSize: number,
  chunkCount: number,
  sourceEtag: string,
) {
  if (state.media_id !== media.id
    || state.object_key !== media.object_key
    || Number(state.byte_size) !== media.byte_size
    || Number(state.chunk_size) !== chunkSize
    || Number(state.chunk_count) !== chunkCount) {
    throw new LegacyMediaMigrationError("旧媒体迁移记录与原文件不一致，请停止迁移并检查数据库");
  }
  assertSourceEtag(state.source_etag, sourceEtag);
}

function parseVerifiedChunks(serialized: string, chunkCount: number): VerifiedLegacyChunk[] {
  const parsed = parseVerifiedChunksLenient(serialized);
  const seen = new Set<number>();
  for (const chunk of parsed) {
    if (chunk.index < 0 || chunk.index >= chunkCount || seen.has(chunk.index)) {
      throw new LegacyMediaMigrationError("旧媒体迁移进度记录无效，请停止迁移并检查数据库");
    }
    seen.add(chunk.index);
  }
  return parsed.sort((left, right) => left.index - right.index);
}

function assertVerifiedChunkSizes(verified: VerifiedLegacyChunk[], byteSize: number, chunkSize: number) {
  for (const chunk of verified) {
    if (chunk.byteSize !== legacyMediaChunkLength(byteSize, chunk.index, chunkSize)) {
      throw new LegacyMediaMigrationError("旧媒体迁移进度的分片字节数与原文件不一致，请停止迁移并检查数据库");
    }
  }
}

function assertCompleteLedger(verified: VerifiedLegacyChunk[], byteSize: number, chunkCount: number) {
  const totalBytes = verified.reduce((sum, chunk) => sum + chunk.byteSize, 0);
  if (verified.length !== chunkCount || totalBytes !== byteSize) {
    throw new LegacyMediaMigrationError("旧媒体尚未完成全部分片校验，不能切换存储后端");
  }
}

function assertFinalLedgerMatchesCopied(finalVerified: VerifiedLegacyChunk[], copied: VerifiedLegacyChunk[]) {
  const copiedByIndex = new Map(copied.map((chunk) => [chunk.index, chunk]));
  for (const finalChunk of finalVerified) {
    const copiedChunk = copiedByIndex.get(finalChunk.index);
    if (!copiedChunk
      || copiedChunk.byteSize !== finalChunk.byteSize
      || !constantTimeHexEqual(copiedChunk.sha256, finalChunk.sha256)) {
      throw new LegacyMediaMigrationError("旧媒体最终复验台账与复制台账不一致，已停止迁移");
    }
  }
}

function assertSourceEtag(expected: string, actual: string) {
  if (typeof actual !== "string" || actual.trim().length === 0 || expected !== actual.trim()) {
    throw new LegacyMediaMigrationError("R2 旧媒体的对象版本标识已变化，已停止迁移；请勿覆盖原对象");
  }
}

function parseVerifiedChunksLenient(serialized: string): VerifiedLegacyChunk[] {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is VerifiedLegacyChunk => isRecord(value)
      && Number.isSafeInteger(value.index)
      && Number(value.index) >= 0
      && Number.isSafeInteger(value.byteSize)
      && Number(value.byteSize) > 0
      && typeof value.sha256 === "string"
      && /^[a-f0-9]{64}$/u.test(value.sha256));
  } catch {
    return [];
  }
}

function firstMissingChunk(verified: VerifiedLegacyChunk[], chunkCount: number) {
  const indices = new Set(verified.map((chunk) => chunk.index));
  for (let index = 0; index < chunkCount; index += 1) {
    if (!indices.has(index)) return index;
  }
  return null;
}

function migrationProgress(
  media: LegacyMediaRow,
  verifiedChunks: number,
  finalVerifiedChunks: number,
  chunkCount: number,
  status: "copying" | "final-verifying" | "file-completed",
): LegacyMediaMigrationResult {
  return {
    status,
    mediaId: media.id,
    objectKey: media.object_key,
    byteSize: media.byte_size,
    verifiedChunks,
    finalVerifiedChunks,
    chunkCount,
  };
}

async function recordMigrationError(store: LegacyMediaMigrationStore, mediaId: string, error: unknown) {
  const message = errorMessage(error);
  await store.recordError(mediaId, message.slice(0, 500)).catch(() => undefined);
}

async function sha256(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeHexEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
