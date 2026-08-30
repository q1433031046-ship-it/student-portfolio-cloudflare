import { writeAuditLog } from "../../../../_lib/audit";
import { isExactDraftMediaReplacement, type EditableMediaSlot } from "../../../../_lib/media-replacement";
import { getPortfolioDb } from "../../../../_lib/portfolio-store";
import { isRequestBodyError, readJsonBody } from "../../../../_lib/request-body";
import { requirePortfolioUploader, type PortfolioManager } from "../../../../_lib/site-ownership";
import {
  getMediaKv,
  hasMediaKv,
  isKvUploadChunkKey,
  KV_UPLOAD_CHUNK_SIZE,
  kvChunkKey,
  kvUploadChunkKey,
  MEDIA_STORAGE_LIMIT,
  VIDEO_UPLOAD_LIMIT,
} from "../../../../_lib/storage";

const IMAGE_MAX = 8 * 1024 * 1024;
const FONT_MAX = 10 * 1024 * 1024;
const TEMPORARY_CHUNK_TTL_SECONDS = 7 * 24 * 60 * 60;
const FINALIZING_LEASE_MS = 60 * 60 * 1000;
const SLOTS = new Set(["hero", "transition", "cover", "final", "detail", "font", "contact", "end-cover"]);

type UploadSessionStatus = "uploading" | "finalizing" | "completed" | "expiring" | "expired";

type UploadedChunkRecord = {
  key: string;
  byteSize: number;
};

type UploadSessionRow = {
  id: string;
  asset_id: string;
  object_key: string;
  replaced_object_key: string | null;
  project_id: string;
  slot: string;
  filename: string;
  content_type: string;
  byte_size: number;
  chunk_size: number;
  chunk_count: number;
  uploaded_chunks_json: string;
  uploaded_by: string;
  status: UploadSessionStatus;
  expires_at: string;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; slot: string }> },
) {
  const { projectId, slot } = await context.params;
  const url = new URL(request.url);
  const uploadId = url.searchParams.get("uploadId");
  try {
    const access = await loadUploadAccess(request, projectId, slot);
    if (access instanceof Response) return access;
    if (uploadId && url.searchParams.get("complete") === "1") {
      return completeChunkedUpload(access, projectId, slot, uploadId);
    }

    const body = await readJsonBody(request, 16_384);
    if (!isRecord(body)
      || typeof body.filename !== "string"
      || typeof body.contentType !== "string"
      || !Number.isInteger(body.byteSize)) {
      return Response.json({ error: "上传文件信息不完整" }, { status: 400 });
    }
    const contentType = body.contentType.trim().toLowerCase();
    const byteSize = Number(body.byteSize);
    const policy = uploadPolicy(slot, contentType);
    if (!policy) return unsupportedType(slot);
    if (byteSize <= 0 || byteSize > policy.maxBytes) return tooLarge(slot);
    const replacement = resolveReplacementReference(
      access,
      projectId,
      slot,
      body.assetId,
      body.replacingKey,
    );
    if (replacement instanceof Response) return replacement;
    const { assetId, replacingKey: replacedObjectKey } = replacement;
    if (!hasMediaKv()) return mediaKvRequired();
    await cleanupExpiredUploadSessions();

    const filename = cleanFilename(body.filename, slot === "final" ? "video" : slot === "font" ? "font" : "image");
    const objectScope = slot === "transition" ? `categories/${projectId}` : slot === "end-cover" ? `end-covers/${projectId}` : projectId;
    const objectKey = `portfolio/${objectScope}/${slot}-${assetId}-${crypto.randomUUID()}.${extensionFor(contentType)}`;
    const chunkCount = Math.ceil(byteSize / KV_UPLOAD_CHUNK_SIZE);
    const now = Date.now();
    const sessionId = crypto.randomUUID();
    const reserved = await getPortfolioDb()
      .prepare(`INSERT INTO media_upload_sessions (
        id, asset_id, object_key, replaced_object_key, project_id, slot, filename,
        content_type, byte_size, chunk_size, chunk_count, uploaded_chunks_json,
        uploaded_by, status, created_at, expires_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 'uploading', ?, ?
      WHERE (
        COALESCE((SELECT SUM(byte_size) FROM portfolio_media WHERE status = 'uploaded'), 0)
        + COALESCE((SELECT SUM(byte_size) FROM media_upload_sessions
          WHERE status IN ('finalizing', 'expiring')
            OR (status = 'uploading' AND datetime(expires_at) > datetime('now'))), 0)
        + ?
      ) <= ?`)
      .bind(
        sessionId, assetId, objectKey, replacedObjectKey, projectId, slot, filename,
        contentType, byteSize, KV_UPLOAD_CHUNK_SIZE, chunkCount, access.identity.user,
        new Date(now).toISOString(), new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        byteSize, MEDIA_STORAGE_LIMIT,
      )
      .run();
    if (Number(reserved.meta.changes ?? 0) !== 1) throw await currentStorageLimitError();
    return Response.json({
      mode: "chunked",
      uploadId: sessionId,
      assetId,
      chunkSize: KV_UPLOAD_CHUNK_SIZE,
      chunkCount,
    }, { status: 201 });
  } catch (error) {
    if (isRequestBodyError(error)) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof UploadLimitError) return Response.json({ error: error.message }, { status: 413 });
    if (error instanceof UploadStateError) return Response.json({ error: error.message }, { status: error.status });
    console.error(JSON.stringify({ message: "media upload start failed", error: errorMessage(error), projectId, slot }));
    return Response.json({ error: "无法开始媒体上传，请稍后重试" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string; slot: string }> },
) {
  const { projectId, slot } = await context.params;
  const url = new URL(request.url);
  const uploadId = url.searchParams.get("uploadId");
  try {
    const access = await loadUploadAccess(request, projectId, slot);
    if (access instanceof Response) return access;
    if (uploadId) {
      if (!hasMediaKv()) return mediaKvRequired();
      const chunkIndex = Number(url.searchParams.get("chunk"));
      return uploadKvChunk(request, access, projectId, slot, uploadId, chunkIndex);
    }
    if (!hasMediaKv()) return mediaKvRequired();
    return Response.json({ error: "请先创建分片上传任务" }, { status: 409 });
  } catch (error) {
    if (error instanceof UploadLimitError) return Response.json({ error: error.message }, { status: 413 });
    if (error instanceof UploadStateError) return Response.json({ error: error.message }, { status: error.status });
    console.error(JSON.stringify({ message: "portfolio media upload failed", error: errorMessage(error), projectId, slot }));
    return Response.json({ error: "媒体上传失败，请稍后重试" }, { status: 500 });
  }
}

async function uploadKvChunk(
  request: Request,
  access: PortfolioManager,
  projectId: string,
  slot: string,
  uploadId: string,
  chunkIndex: number,
) {
  if (!validId(uploadId) || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return Response.json({ error: "上传分片地址无效" }, { status: 404 });
  }
  const session = await readUploadSession(uploadId);
  if (!session
    || session.project_id !== projectId
    || session.slot !== slot
    || session.uploaded_by !== access.identity.user) {
    return Response.json({ error: "上传任务不存在或已经过期" }, { status: 404 });
  }
  if (session.status !== "uploading") {
    return Response.json({ error: "上传任务已经停止接收分片，请重新开始上传" }, { status: 409 });
  }
  if (Date.parse(session.expires_at) <= Date.now()) {
    return Response.json({ error: "上传任务不存在或已经过期" }, { status: 404 });
  }
  if (chunkIndex >= session.chunk_count || !request.body) {
    return Response.json({ error: "上传分片无效" }, { status: 400 });
  }
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  const expectedSize = chunkIndex === session.chunk_count - 1
    ? session.byte_size - chunkIndex * session.chunk_size
    : session.chunk_size;
  if (!Number.isInteger(declaredSize) || declaredSize !== expectedSize || declaredSize > KV_UPLOAD_CHUNK_SIZE) {
    return Response.json({ error: "上传分片大小不正确" }, { status: 400 });
  }

  const chunkValue = await request.arrayBuffer();
  if (chunkValue.byteLength !== expectedSize) {
    return Response.json({ error: "上传分片大小不正确" }, { status: 400 });
  }
  if (session.content_type === "video/mp4" && chunkIndex === 0 && !looksLikeMp4(chunkValue)) {
    return Response.json({ error: "视频文件不是有效的 MP4，请转换为 H.264 / AAC 的 MP4 后重试" }, { status: 415 });
  }
  const namespace = getMediaKv();
  const temporaryKey = kvUploadChunkKey(uploadId, chunkIndex, crypto.randomUUID());
  await namespace.put(temporaryKey, chunkValue, {
    expirationTtl: TEMPORARY_CHUNK_TTL_SECONDS,
    metadata: { uploadId, chunkIndex, contentType: session.content_type, temporary: true },
  });
  const committed = await commitUploadedChunk(session.id, chunkIndex, temporaryKey, chunkValue.byteLength);
  if (!committed) {
    await namespace.delete(temporaryKey).catch(() => undefined);
    return Response.json({ error: "上传任务已经停止接收分片，请重新开始上传" }, { status: 409 });
  }
  if (committed.previousKey && committed.previousKey !== temporaryKey) {
    await namespace.delete(committed.previousKey).catch((error) => {
      console.error(JSON.stringify({ message: "replaced upload chunk cleanup failed", error: errorMessage(error), uploadId, chunkIndex }));
    });
  }
  return Response.json({ ok: true, uploadedChunks: committed.uploadedChunks, chunkCount: session.chunk_count });
}

async function completeChunkedUpload(
  access: PortfolioManager,
  projectId: string,
  slot: string,
  uploadId: string,
) {
  if (!validId(uploadId)) return Response.json({ error: "上传任务无效" }, { status: 404 });
  let session = await readUploadSession(uploadId);
  if (!session
    || session.project_id !== projectId
    || session.slot !== slot
    || session.uploaded_by !== access.identity.user) {
    return Response.json({ error: "上传任务不存在或已经过期" }, { status: 404 });
  }
  if (session.status === "completed") return completedChunkedUploadResponse(session, 200);
  if (session.status === "expiring" || session.status === "expired") {
    return Response.json({ error: "上传任务不存在或已经过期" }, { status: 404 });
  }
  if (session.status === "uploading") {
    if (Date.parse(session.expires_at) <= Date.now()) {
      return Response.json({ error: "上传任务不存在或已经过期" }, { status: 404 });
    }
    const uploaded = parseUploadedChunkRecords(session.uploaded_chunks_json, session.id);
    if (!uploaded) {
      return Response.json({ error: "上传任务来自旧版本，请重新选择文件上传" }, { status: 409 });
    }
    if (!hasEveryUploadedChunk(session, uploaded)) {
      return Response.json({ error: "文件尚未上传完整，请继续上传缺少的分片" }, { status: 409 });
    }
    const claimed = await getPortfolioDb()
      .prepare(`UPDATE media_upload_sessions SET status = 'finalizing', expires_at = ?
        WHERE id = ? AND status = 'uploading' AND datetime(expires_at) > datetime('now')`)
      .bind(finalizingLeaseExpiry(), session.id)
      .run();
    if (Number(claimed.meta.changes ?? 0) !== 1) {
      session = await readUploadSession(uploadId);
      if (!session) return Response.json({ error: "上传任务不存在或已经过期" }, { status: 404 });
      if (session.status === "completed") return completedChunkedUploadResponse(session, 200);
      if (session.status !== "finalizing") {
        return Response.json({ error: "上传任务状态已经变化，请刷新后重试" }, { status: 409 });
      }
    }
  }
  session = await readUploadSession(uploadId);
  if (!session || session.status !== "finalizing") {
    if (session?.status === "completed") return completedChunkedUploadResponse(session, 200);
    return Response.json({ error: "上传任务状态已经变化，请刷新后重试" }, { status: 409 });
  }
  const renewed = await getPortfolioDb()
    .prepare(`UPDATE media_upload_sessions SET expires_at = ?
      WHERE id = ? AND status = 'finalizing'
        AND NOT EXISTS (
          SELECT 1 FROM portfolio_media
          WHERE object_key = media_upload_sessions.object_key AND status = 'uploaded'
        )`)
    .bind(finalizingLeaseExpiry(), session.id)
    .run();
  if (Number(renewed.meta.changes ?? 0) !== 1) {
    const current = await readUploadSession(uploadId);
    if (current?.status === "completed") return completedChunkedUploadResponse(current, 200);
    return Response.json({ error: "上传任务正在被其他操作处理，请稍后重试" }, { status: 409 });
  }
  session = await readUploadSession(uploadId);
  if (!session || session.status !== "finalizing") {
    if (session?.status === "completed") return completedChunkedUploadResponse(session, 200);
    return Response.json({ error: "上传任务状态已经变化，请刷新后重试" }, { status: 409 });
  }
  const uploaded = parseUploadedChunkRecords(session.uploaded_chunks_json, session.id);
  if (!uploaded || !hasEveryUploadedChunk(session, uploaded)) {
    throw new UploadStateError("上传分片记录不完整，请重新开始上传", 409);
  }
  try {
    await activateKvChunks(session, uploaded);
  } catch (error) {
    const current = await readUploadSession(uploadId);
    if (current?.status === "completed") return completedChunkedUploadResponse(current, 200);
    throw error;
  }

  const now = new Date().toISOString();
  const mediaId = `upload-${session.id}`;
  const db = getPortfolioDb();
  let committed: D1Result[];
  try {
    committed = await db.batch([
      db.prepare(`INSERT INTO portfolio_media (
        id, object_key, replaced_object_key, project_id, slot, filename, content_type,
        byte_size, storage_backend, chunk_size, chunk_count, uploaded_by, status, created_at
      )
      SELECT ?, object_key, replaced_object_key, project_id, slot, filename, content_type,
        byte_size, 'kv', chunk_size, chunk_count, uploaded_by, 'uploaded', ?
      FROM media_upload_sessions WHERE id = ? AND status = 'finalizing'`)
        .bind(mediaId, now, session.id),
      db.prepare("UPDATE media_upload_sessions SET status = 'completed' WHERE id = ? AND status = 'finalizing'")
        .bind(session.id),
    ]);
  } catch (error) {
    const current = await readUploadSession(uploadId);
    if (current?.status === "completed") return completedChunkedUploadResponse(current, 200);
    throw error;
  }
  const completed = await readUploadSession(uploadId);
  if (!completed || completed.status !== "completed") {
    throw new UploadStateError("上传完成状态校验失败，请稍后重试", 409);
  }
  const wonCompletion = Number(committed[1]?.meta.changes ?? 0) === 1;
  if (!wonCompletion) return completedChunkedUploadResponse(completed, 200);
  await safeAudit(access.identity.user, projectId, slot, session.byte_size, session.content_type);
  await cleanupCommittedTemporaryChunks(session, uploaded);
  return completedChunkedUploadResponse(completed, 201);
}

async function commitUploadedChunk(
  uploadId: string,
  chunkIndex: number,
  temporaryKey: string,
  byteSize: number,
): Promise<{ uploadedChunks: number; previousKey: string | null } | null> {
  const db = getPortfolioDb();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await readUploadSession(uploadId);
    if (!current || current.status !== "uploading" || Date.parse(current.expires_at) <= Date.now()) return null;
    const uploaded = parseUploadedChunkRecords(current.uploaded_chunks_json, current.id);
    if (!uploaded) return null;
    const previousKey = uploaded.get(chunkIndex)?.key ?? null;
    uploaded.set(chunkIndex, { key: temporaryKey, byteSize });
    const nextJson = serializeUploadedChunkRecords(uploaded);
    const committed = await db
      .prepare(`UPDATE media_upload_sessions SET uploaded_chunks_json = ?
        WHERE id = ? AND status = 'uploading' AND uploaded_chunks_json = ?
          AND datetime(expires_at) > datetime('now')`)
      .bind(nextJson, uploadId, current.uploaded_chunks_json)
      .run();
    if (Number(committed.meta.changes ?? 0) === 1) {
      return { uploadedChunks: uploaded.size, previousKey };
    }
  }
  return null;
}

async function activateKvChunks(session: UploadSessionRow, uploaded: Map<number, UploadedChunkRecord>) {
  const namespace = getMediaKv();
  const verified: Array<{ index: number; value: ArrayBuffer }> = [];
  for (let index = 0; index < session.chunk_count; index += 1) {
    const record = uploaded.get(index);
    const expectedSize = expectedChunkSize(session, index);
    if (!record || record.byteSize !== expectedSize) {
      throw new UploadStateError(`第 ${index + 1} 个上传分片记录不完整，请稍后重试`, 409);
    }
    let value: ArrayBuffer | null;
    try {
      value = await namespace.get(record.key, { type: "arrayBuffer" });
    } catch (error) {
      console.error(JSON.stringify({ message: "temporary upload chunk read failed", error: errorMessage(error), uploadId: session.id, chunkIndex: index }));
      throw new UploadStateError("上传分片暂时无法读取，请稍后重试完成上传", 503);
    }
    if (!value) throw new UploadStateError(`第 ${index + 1} 个上传分片暂时无法读取，请稍后重试`, 409);
    if (value.byteLength !== expectedSize) {
      throw new UploadStateError(`第 ${index + 1} 个上传分片大小校验失败，请重新创建上传任务`, 409);
    }
    if (session.content_type === "video/mp4" && index === 0 && !looksLikeMp4(value)) {
      throw new UploadStateError("视频文件校验失败，请重新创建上传任务", 409);
    }
    verified.push({ index, value });
  }

  try {
    for (const chunk of verified) {
      await namespace.put(kvChunkKey(session.object_key, chunk.index), chunk.value, {
        metadata: { uploadId: session.id, chunkIndex: chunk.index, contentType: session.content_type },
      });
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "active upload chunk write failed", error: errorMessage(error), uploadId: session.id }));
    throw new UploadStateError("媒体分片暂时无法完成，请稍后重试", 503);
  }
}

async function completedChunkedUploadResponse(session: UploadSessionRow, status: 200 | 201) {
  const media = await getPortfolioDb()
    .prepare(`SELECT object_key, replaced_object_key, project_id, slot, filename, content_type,
      byte_size, storage_backend, chunk_size, chunk_count, uploaded_by, status
      FROM portfolio_media WHERE object_key = ? LIMIT 1`)
    .bind(session.object_key)
    .first<{
      object_key: string;
      replaced_object_key: string | null;
      project_id: string;
      slot: string;
      filename: string;
      content_type: string;
      byte_size: number;
      storage_backend: string;
      chunk_size: number | null;
      chunk_count: number;
      uploaded_by: string;
      status: string;
    }>();
  if (!media
    || media.object_key !== session.object_key
    || media.replaced_object_key !== session.replaced_object_key
    || media.project_id !== session.project_id
    || media.slot !== session.slot
    || media.filename !== session.filename
    || media.content_type !== session.content_type
    || Number(media.byte_size) !== session.byte_size
    || media.storage_backend !== "kv"
    || Number(media.chunk_size) !== session.chunk_size
    || Number(media.chunk_count) !== session.chunk_count
    || media.uploaded_by !== session.uploaded_by
    || media.status !== "uploaded") {
    throw new UploadStateError("上传完成记录不一致，请联系站点管理员", 409);
  }
  return Response.json({ asset: assetPayload(session.asset_id, session.filename, session.slot, session.object_key) }, { status });
}

async function cleanupCommittedTemporaryChunks(
  session: UploadSessionRow,
  uploaded: Map<number, UploadedChunkRecord>,
) {
  const namespace = getMediaKv();
  for (const [index, record] of uploaded) {
    if (!isKvUploadChunkKey(record.key, session.id, index)) continue;
    await namespace.delete(record.key).catch((error) => {
      console.error(JSON.stringify({ message: "temporary upload chunk cleanup failed", error: errorMessage(error), uploadId: session.id, chunkIndex: index }));
    });
  }
}

function expectedChunkSize(session: UploadSessionRow, index: number) {
  return index === session.chunk_count - 1
    ? session.byte_size - index * session.chunk_size
    : session.chunk_size;
}

function finalizingLeaseExpiry() {
  return new Date(Date.now() + FINALIZING_LEASE_MS).toISOString();
}

async function loadUploadAccess(request: Request, projectId: string, slot: string) {
  if (!validId(projectId) || !SLOTS.has(slot)) return Response.json({ error: "媒体上传地址无效" }, { status: 404 });
  const access = await requirePortfolioUploader(request);
  if (access instanceof Response) return access;
  if (slot === "hero" && projectId !== "site") return Response.json({ error: "首幅上传地址无效" }, { status: 404 });
  if ((slot === "font" || slot === "contact") && projectId !== "site") return Response.json({ error: "站点媒体上传地址无效" }, { status: 404 });
  if (slot === "transition" && !access.record.draft.categories.some((category) => category.id === projectId)) {
    return Response.json({ error: "分类不存在，请先保存分类资料" }, { status: 404 });
  }
  if (!["hero", "font", "contact", "transition", "end-cover"].includes(slot)
    && !access.record.draft.projects.some((project) => project.id === projectId)) {
    return Response.json({ error: "作品不存在，请先保存作品资料" }, { status: 404 });
  }
  return access;
}

function resolveReplacementReference(
  access: PortfolioManager,
  projectId: string,
  slot: string,
  assetIdValue: unknown,
  replacingKeyValue: unknown,
): { assetId: string; replacingKey: string | null } | Response {
  const hasReplacement = replacingKeyValue !== undefined && replacingKeyValue !== null;
  if (!hasReplacement) {
    return {
      assetId: typeof assetIdValue === "string" && validId(assetIdValue) ? assetIdValue : crypto.randomUUID(),
      replacingKey: null,
    };
  }
  if (typeof replacingKeyValue !== "string"
    || !validObjectKey(replacingKeyValue)
    || typeof assetIdValue !== "string"
    || !validId(assetIdValue)
    || !isExactDraftMediaReplacement(
      access.record.draft,
      projectId,
      slot as EditableMediaSlot,
      assetIdValue,
      replacingKeyValue,
    )) {
    return Response.json({ error: "替换媒体信息无效，请刷新草稿后重试" }, { status: 400 });
  }
  return { assetId: assetIdValue, replacingKey: replacingKeyValue };
}

async function currentStorageLimitError() {
  const row = await getPortfolioDb()
    .prepare(`SELECT
      (SELECT COALESCE(SUM(byte_size), 0) FROM portfolio_media WHERE status = 'uploaded') AS used_bytes,
      (SELECT COALESCE(SUM(byte_size), 0) FROM media_upload_sessions
        WHERE status IN ('finalizing', 'expiring')
          OR (status = 'uploading' AND datetime(expires_at) > datetime('now'))) AS pending_bytes`)
    .first<{ used_bytes: number; pending_bytes: number }>();
  const remaining = Math.max(
    0,
    MEDIA_STORAGE_LIMIT - Number(row?.used_bytes ?? 0) - Number(row?.pending_bytes ?? 0),
  );
  return new UploadLimitError(`网站空间不足，当前大约还剩 ${formatBytes(remaining)}`);
}

async function cleanupExpiredUploadSessions() {
  if (!hasMediaKv()) return;
  const db = getPortfolioDb();
  const result = await db
    .prepare(`SELECT id, status FROM media_upload_sessions
      WHERE (status = 'uploading' AND datetime(expires_at) <= datetime('now'))
        OR (status = 'finalizing' AND datetime(expires_at) <= datetime('now'))
        OR status = 'expiring'
      LIMIT 10`)
    .all<{ id: string; status: UploadSessionStatus }>();
  const namespace = getMediaKv();
  for (const candidate of result.results ?? []) {
    if (candidate.status === "uploading") {
      const claimed = await db
        .prepare(`UPDATE media_upload_sessions SET status = 'expiring'
          WHERE id = ? AND status = 'uploading' AND datetime(expires_at) <= datetime('now')
            AND NOT EXISTS (
              SELECT 1 FROM portfolio_media
              WHERE object_key = media_upload_sessions.object_key AND status = 'uploaded'
            )`)
        .bind(candidate.id)
        .run();
      if (Number(claimed.meta.changes ?? 0) !== 1) continue;
    } else if (candidate.status === "finalizing") {
      const claimed = await db
        .prepare(`UPDATE media_upload_sessions SET status = 'expiring'
          WHERE id = ? AND status = 'finalizing' AND datetime(expires_at) <= datetime('now')
            AND NOT EXISTS (
              SELECT 1 FROM portfolio_media
              WHERE object_key = media_upload_sessions.object_key AND status = 'uploaded'
            )`)
        .bind(candidate.id)
        .run();
      if (Number(claimed.meta.changes ?? 0) !== 1) continue;
    }
    const session = await readUploadSession(candidate.id);
    if (!session || session.status !== "expiring") continue;
    const activated = await db
      .prepare("SELECT 1 AS present FROM portfolio_media WHERE object_key = ? AND status = 'uploaded' LIMIT 1")
      .bind(session.object_key)
      .first<{ present: number }>();
    if (activated) {
      console.error(JSON.stringify({ message: "refused to clean active upload session", uploadId: session.id }));
      continue;
    }
    const uploaded = parseUploadedChunkRecords(session.uploaded_chunks_json, session.id);
    if (uploaded) {
      for (const [index, record] of uploaded) {
        if (isKvUploadChunkKey(record.key, session.id, index)) await namespace.delete(record.key);
      }
    }
    for (let index = 0; index < session.chunk_count; index += 1) {
      await namespace.delete(kvChunkKey(session.object_key, index));
    }
    await db.prepare("UPDATE media_upload_sessions SET status = 'expired' WHERE id = ? AND status = 'expiring'")
      .bind(session.id)
      .run();
  }
}

function looksLikeMp4(value: ArrayBuffer) {
  const bytes = new Uint8Array(value, 0, Math.min(value.byteLength, 256));
  for (let index = 4; index + 3 < bytes.length; index += 1) {
    if (bytes[index] === 0x66 && bytes[index + 1] === 0x74 && bytes[index + 2] === 0x79 && bytes[index + 3] === 0x70) {
      return true;
    }
  }
  return false;
}

async function readUploadSession(id: string) {
  return getPortfolioDb()
    .prepare(`SELECT id, asset_id, object_key, replaced_object_key, project_id, slot,
      filename, content_type, byte_size, chunk_size, chunk_count,
      uploaded_chunks_json, uploaded_by, status, expires_at
      FROM media_upload_sessions WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<UploadSessionRow>();
}

export function uploadPolicy(slot: string, contentType: string): { kind: "image" | "video" | "font"; maxBytes: number } | null {
  if (slot === "final") return contentType === "video/mp4" ? { kind: "video", maxBytes: VIDEO_UPLOAD_LIMIT } : null;
  if (slot === "font") return isFont(contentType) ? { kind: "font", maxBytes: FONT_MAX } : null;
  return isImage(contentType) ? { kind: "image", maxBytes: IMAGE_MAX } : null;
}

function assetPayload(assetId: string, filename: string, slot: string, objectKey: string) {
  const video = slot === "final";
  const font = slot === "font";
  return {
    id: assetId,
    label: filename,
    alt: "",
    kind: video ? "video" : font ? "font" : "image",
    key: objectKey,
    src: video ? undefined : `/api/media/${objectKey}`,
    visualKey: "frame",
  };
}

function unsupportedType(slot: string) {
  return Response.json({
    error: slot === "final"
      ? "请上传 H.264 编码的 MP4 视频"
      : slot === "font"
        ? "请上传 WOFF、WOFF2、TTF 或 OTF 字体"
        : "请上传 JPG、PNG、WebP 或 AVIF 图片",
  }, { status: 415 });
}

function tooLarge(slot: string) {
  return Response.json({
    error: slot === "final"
      ? "视频不能超过 50 MB"
      : slot === "font"
        ? "字体不能超过 10 MiB"
        : "优化后的图片不能超过 8 MiB",
  }, { status: 413 });
}

function mediaKvRequired() {
  return Response.json({ error: "新媒体上传需要 MEDIA_KV 绑定，请先完成存储升级" }, { status: 503 });
}

function isImage(value: string) {
  return new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]).has(value);
}

function isFont(value: string) {
  return new Set([
    "font/woff", "font/woff2", "font/ttf", "font/otf",
    "application/font-woff", "application/x-font-ttf", "application/x-font-opentype",
  ]).has(value);
}

function extensionFor(contentType: string) {
  const extensions: Record<string, string> = {
    "video/mp4": "mp4",
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif",
    "font/woff": "woff", "font/woff2": "woff2", "font/ttf": "ttf", "font/otf": "otf",
    "application/font-woff": "woff", "application/x-font-ttf": "ttf", "application/x-font-opentype": "otf",
  };
  return extensions[contentType];
}

function validId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/u.test(value);
}

function validObjectKey(value: string) {
  return /^portfolio\/[a-zA-Z0-9/_-]+\.[a-z0-9]+$/u.test(value) && !value.includes("..");
}

function cleanFilename(value: string | null, fallback: string) {
  if (!value) return fallback;
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { decoded = value; }
  const cleaned = decoded.replace(/[\u0000-\u001f\\/]/gu, "_").trim().slice(0, 120);
  return cleaned || fallback;
}

function parseUploadedChunkRecords(value: string, uploadId: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return null;
    const uploaded = new Map<number, UploadedChunkRecord>();
    for (const [rawIndex, rawRecord] of Object.entries(parsed)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(rawIndex) || !isRecord(rawRecord)) return null;
      const index = Number(rawIndex);
      if (!Number.isSafeInteger(index)
        || typeof rawRecord.key !== "string"
        || !isKvUploadChunkKey(rawRecord.key, uploadId, index)
        || !Number.isSafeInteger(rawRecord.byteSize)
        || Number(rawRecord.byteSize) <= 0
        || Number(rawRecord.byteSize) > KV_UPLOAD_CHUNK_SIZE) return null;
      uploaded.set(index, { key: rawRecord.key, byteSize: Number(rawRecord.byteSize) });
    }
    return uploaded;
  } catch {
    return null;
  }
}

function serializeUploadedChunkRecords(uploaded: Map<number, UploadedChunkRecord>) {
  return JSON.stringify(Object.fromEntries([...uploaded.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, record]) => [String(index), record])));
}

function hasEveryUploadedChunk(session: UploadSessionRow, uploaded: Map<number, UploadedChunkRecord>) {
  if (uploaded.size !== session.chunk_count) return false;
  for (let index = 0; index < session.chunk_count; index += 1) {
    const record = uploaded.get(index);
    if (!record || record.byteSize !== expectedChunkSize(session, index)) return false;
  }
  return true;
}

async function safeAudit(actorEmail: string, projectId: string, slot: string, byteSize: number, contentType: string) {
  try {
    await writeAuditLog({
      actorEmail,
      action: "media.uploaded",
      targetType: ["hero", "font", "contact"].includes(slot) ? "site" : slot === "transition" ? "category" : "project",
      targetId: projectId,
      summary: { slot, byteSize, contentType },
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "media upload audit failed", error: errorMessage(error) }));
  }
}

class UploadLimitError extends Error {}

class UploadStateError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function formatBytes(value: number) {
  return `${Math.floor(value / (1024 * 1024))} MB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
