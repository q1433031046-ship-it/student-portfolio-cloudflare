import { writeAuditLog } from "../../../../_lib/audit";
import { getPortfolioDb } from "../../../../_lib/portfolio-store";
import { isRequestBodyError, readJsonBody } from "../../../../_lib/request-body";
import { requirePortfolioManager, type PortfolioManager } from "../../../../_lib/site-ownership";
import {
  getBucket,
  getMediaKv,
  KV_UPLOAD_CHUNK_SIZE,
  kvChunkKey,
  MEDIA_STORAGE_LIMIT,
  mediaStorageBackend,
  VIDEO_UPLOAD_LIMIT,
} from "../../../../_lib/storage";

const IMAGE_MAX = 8 * 1024 * 1024;
const FONT_MAX = 10 * 1024 * 1024;
const SLOTS = new Set(["hero", "transition", "cover", "final", "detail", "font", "contact"]);

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
    const assetId = typeof body.assetId === "string" && validId(body.assetId) ? body.assetId : crypto.randomUUID();
    const replacedObjectKey = typeof body.replacingKey === "string" && validObjectKey(body.replacingKey)
      ? body.replacingKey
      : null;
    await cleanupExpiredUploadSessions();
    await assertStorageCapacity(byteSize, replacedObjectKey);

    const backend = mediaStorageBackend();
    if (backend === "r2") return Response.json({ mode: "single", assetId });

    const filename = cleanFilename(body.filename, slot === "final" ? "video" : slot === "font" ? "font" : "image");
    const objectScope = slot === "transition" ? `categories/${projectId}` : projectId;
    const objectKey = `portfolio/${objectScope}/${slot}-${assetId}-${crypto.randomUUID()}.${extensionFor(contentType)}`;
    const chunkCount = Math.ceil(byteSize / KV_UPLOAD_CHUNK_SIZE);
    const now = Date.now();
    const sessionId = crypto.randomUUID();
    await getPortfolioDb()
      .prepare(`INSERT INTO media_upload_sessions (
        id, asset_id, object_key, replaced_object_key, project_id, slot, filename,
        content_type, byte_size, chunk_size, chunk_count, uploaded_chunks_json,
        uploaded_by, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, 'uploading', ?, ?)`)
      .bind(
        sessionId, assetId, objectKey, replacedObjectKey, projectId, slot, filename,
        contentType, byteSize, KV_UPLOAD_CHUNK_SIZE, chunkCount, access.identity.user,
        new Date(now).toISOString(), new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      )
      .run();
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
      const chunkIndex = Number(url.searchParams.get("chunk"));
      return uploadKvChunk(request, access, projectId, slot, uploadId, chunkIndex);
    }
    if (mediaStorageBackend() !== "r2") {
      return Response.json({ error: "请先创建分片上传任务" }, { status: 409 });
    }
    return uploadSingleObject(request, access, projectId, slot);
  } catch (error) {
    if (error instanceof UploadLimitError) return Response.json({ error: error.message }, { status: 413 });
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
    || session.uploaded_by !== access.identity.user
    || Date.parse(session.expires_at) <= Date.now()) {
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

  const chunkValue = chunkIndex === 0 ? await request.arrayBuffer() : request.body;
  if (session.content_type === "video/mp4" && chunkIndex === 0 && !looksLikeMp4(chunkValue as ArrayBuffer)) {
    return Response.json({ error: "视频文件不是有效的 MP4，请转换为 H.264 / AAC 的 MP4 后重试" }, { status: 415 });
  }
  await getMediaKv().put(kvChunkKey(session.object_key, chunkIndex), chunkValue, {
    metadata: { uploadId, chunkIndex, contentType: session.content_type },
  });
  const uploaded = parseUploadedChunks(session.uploaded_chunks_json);
  uploaded.add(chunkIndex);
  await getPortfolioDb()
    .prepare("UPDATE media_upload_sessions SET uploaded_chunks_json = ? WHERE id = ? AND status = 'uploading'")
    .bind(JSON.stringify([...uploaded].sort((a, b) => a - b)), session.id)
    .run();
  return Response.json({ ok: true, uploadedChunks: uploaded.size, chunkCount: session.chunk_count });
}

async function completeChunkedUpload(
  access: PortfolioManager,
  projectId: string,
  slot: string,
  uploadId: string,
) {
  if (!validId(uploadId)) return Response.json({ error: "上传任务无效" }, { status: 404 });
  const session = await readUploadSession(uploadId);
  if (!session
    || session.project_id !== projectId
    || session.slot !== slot
    || session.uploaded_by !== access.identity.user
    || Date.parse(session.expires_at) <= Date.now()) {
    return Response.json({ error: "上传任务不存在或已经过期" }, { status: 404 });
  }
  const uploaded = parseUploadedChunks(session.uploaded_chunks_json);
  if (uploaded.size !== session.chunk_count || [...Array(session.chunk_count).keys()].some((index) => !uploaded.has(index))) {
    return Response.json({ error: "文件尚未上传完整，请继续上传缺少的分片" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const mediaId = crypto.randomUUID();
  const db = getPortfolioDb();
  await db.batch([
    db.prepare(`INSERT INTO portfolio_media (
      id, object_key, replaced_object_key, project_id, slot, filename, content_type,
      byte_size, storage_backend, chunk_size, chunk_count, uploaded_by, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'kv', ?, ?, ?, 'uploaded', ?)`)
      .bind(
        mediaId, session.object_key, session.replaced_object_key, projectId, slot,
        session.filename, session.content_type, session.byte_size, session.chunk_size,
        session.chunk_count, access.identity.user, now,
      ),
    db.prepare("UPDATE media_upload_sessions SET status = 'completed' WHERE id = ? AND status = 'uploading'")
      .bind(session.id),
  ]);
  await safeAudit(access.identity.user, projectId, slot, session.byte_size, session.content_type);
  return Response.json({ asset: assetPayload(session.asset_id, session.filename, slot, session.object_key) }, { status: 201 });
}

async function uploadSingleObject(request: Request, access: PortfolioManager, projectId: string, slot: string) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const policy = uploadPolicy(slot, contentType);
  if (!policy) return unsupportedType(slot);
  const byteSize = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(byteSize) || byteSize <= 0) return Response.json({ error: "无法确认文件大小" }, { status: 411 });
  if (byteSize > policy.maxBytes) return tooLarge(slot);
  if (!request.body) return Response.json({ error: "上传内容为空" }, { status: 400 });
  const url = new URL(request.url);
  const assetId = validId(url.searchParams.get("assetId") ?? "") ? String(url.searchParams.get("assetId")) : crypto.randomUUID();
  const replacingKey = validObjectKey(url.searchParams.get("replacingKey") ?? "") ? String(url.searchParams.get("replacingKey")) : null;
  await assertStorageCapacity(byteSize, replacingKey);
  const filename = cleanFilename(request.headers.get("x-file-name"), slot === "final" ? "video" : slot === "font" ? "font" : "image");
  const objectScope = slot === "transition" ? `categories/${projectId}` : projectId;
  const objectKey = `portfolio/${objectScope}/${slot}-${assetId}-${crypto.randomUUID()}.${extensionFor(contentType)}`;
  const bucket = getBucket();
  await bucket.put(objectKey, request.body, {
    httpMetadata: { contentType, cacheControl: "private, no-store" },
    customMetadata: { projectId, slot, uploadedBy: access.identity.user },
  });
  try {
    await getPortfolioDb()
      .prepare(`INSERT INTO portfolio_media (
        id, object_key, replaced_object_key, project_id, slot, filename, content_type,
        byte_size, storage_backend, chunk_size, chunk_count, uploaded_by, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'r2', NULL, 1, ?, 'uploaded', ?)`)
      .bind(crypto.randomUUID(), objectKey, replacingKey, projectId, slot, filename, contentType, byteSize, access.identity.user, new Date().toISOString())
      .run();
    await safeAudit(access.identity.user, projectId, slot, byteSize, contentType);
  } catch (error) {
    await bucket.delete(objectKey);
    throw error;
  }
  return Response.json({ asset: assetPayload(assetId, filename, slot, objectKey) }, { status: 201 });
}

async function loadUploadAccess(request: Request, projectId: string, slot: string) {
  if (!validId(projectId) || !SLOTS.has(slot)) return Response.json({ error: "媒体上传地址无效" }, { status: 404 });
  const access = await requirePortfolioManager(request);
  if (access instanceof Response) return access;
  if (slot === "hero" && projectId !== "site") return Response.json({ error: "首幅上传地址无效" }, { status: 404 });
  if ((slot === "font" || slot === "contact") && projectId !== "site") return Response.json({ error: "站点媒体上传地址无效" }, { status: 404 });
  if (slot === "transition" && !access.record.draft.categories.some((category) => category.id === projectId)) {
    return Response.json({ error: "分类不存在，请先保存分类资料" }, { status: 404 });
  }
  if (!["hero", "font", "contact", "transition"].includes(slot)
    && !access.record.draft.projects.some((project) => project.id === projectId)) {
    return Response.json({ error: "作品不存在，请先保存作品资料" }, { status: 404 });
  }
  return access;
}

async function assertStorageCapacity(incomingBytes: number, replacingKey: string | null) {
  const row = await getPortfolioDb()
    .prepare(`SELECT
      COALESCE(SUM(CASE WHEN status = 'uploaded' THEN byte_size ELSE 0 END), 0) AS used_bytes,
      COALESCE(SUM(CASE WHEN object_key = ? AND status = 'uploaded' THEN byte_size ELSE 0 END), 0) AS replacing_bytes
      FROM portfolio_media`)
    .bind(replacingKey)
    .first<{ used_bytes: number; replacing_bytes: number }>();
  const pending = await getPortfolioDb()
    .prepare("SELECT COALESCE(SUM(byte_size), 0) AS pending_bytes FROM media_upload_sessions WHERE status = 'uploading' AND datetime(expires_at) > datetime('now')")
    .first<{ pending_bytes: number }>();
  const projected = Number(row?.used_bytes ?? 0) - Number(row?.replacing_bytes ?? 0) + Number(pending?.pending_bytes ?? 0) + incomingBytes;
  if (projected > MEDIA_STORAGE_LIMIT) {
    const remaining = Math.max(0, MEDIA_STORAGE_LIMIT - Number(row?.used_bytes ?? 0));
    throw new UploadLimitError(`网站空间不足，当前大约还剩 ${formatBytes(remaining)}`);
  }
}

async function cleanupExpiredUploadSessions() {
  if (mediaStorageBackend() !== "kv") return;
  const db = getPortfolioDb();
  const result = await db
    .prepare(`SELECT id, object_key, chunk_count FROM media_upload_sessions
      WHERE status = 'uploading' AND datetime(expires_at) <= datetime('now') LIMIT 10`)
    .all<{ id: string; object_key: string; chunk_count: number }>();
  const namespace = getMediaKv();
  for (const session of result.results ?? []) {
    for (let index = 0; index < Number(session.chunk_count); index += 1) {
      await namespace.delete(kvChunkKey(session.object_key, index));
    }
    await db.prepare("UPDATE media_upload_sessions SET status = 'expired' WHERE id = ? AND status = 'uploading'")
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
      uploaded_chunks_json, uploaded_by, expires_at
      FROM media_upload_sessions WHERE id = ? AND status = 'uploading' LIMIT 1`)
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

function parseUploadedChunks(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is number => Number.isInteger(item) && item >= 0) : []);
  } catch {
    return new Set<number>();
  }
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

function formatBytes(value: number) {
  return `${Math.floor(value / (1024 * 1024))} MB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
