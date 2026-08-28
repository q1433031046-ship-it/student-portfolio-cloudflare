import { writeAuditLog } from "../../../../_lib/audit";
import { getPortfolioDb } from "../../../../_lib/portfolio-store";
import { requirePortfolioManager } from "../../../../_lib/site-ownership";
import { getBucket } from "../../../../_lib/storage";

const VIDEO_MAX = 90 * 1024 * 1024;
const IMAGE_MAX = 8 * 1024 * 1024;
const FONT_MAX = 10 * 1024 * 1024;
const SLOTS = new Set(["hero", "transition", "cover", "final", "detail", "font", "contact"]);

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string; slot: string }> },
) {
  const { projectId, slot } = await context.params;
  if (!validId(projectId) || !SLOTS.has(slot)) return Response.json({ error: "媒体上传地址无效" }, { status: 404 });

  try {
    const access = await requirePortfolioManager(request);
    if (access instanceof Response) return access;
    const { identity, record } = access;
    if (slot === "hero" && projectId !== "site") {
      return Response.json({ error: "首幅上传地址无效" }, { status: 404 });
    }
    if ((slot === "font" || slot === "contact") && projectId !== "site") {
      return Response.json({ error: "字体上传地址无效" }, { status: 404 });
    }
    if (slot === "transition" && !record.draft.categories.some((category) => category.id === projectId)) {
      return Response.json({ error: "分类不存在，请先保存分类资料" }, { status: 404 });
    }
    if (slot !== "hero" && slot !== "font" && slot !== "contact" && slot !== "transition" && !record.draft.projects.some((project) => project.id === projectId)) {
      return Response.json({ error: "作品不存在，请先保存作品资料" }, { status: 404 });
    }

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    const policy = uploadPolicy(slot, contentType);
    const video = slot === "final";
    const font = slot === "font";
    if (!policy) {
      return Response.json({ error: video ? "请上传 MP4、WebM 或 MOV 视频" : font ? "请上传 WOFF、WOFF2、TTF 或 OTF 字体" : "请上传 JPG、PNG、WebP 或 AVIF 图片" }, { status: 415 });
    }
    const byteSize = Number(request.headers.get("content-length") ?? 0);
    const limit = policy.maxBytes;
    if (!Number.isFinite(byteSize) || byteSize <= 0) return Response.json({ error: "无法确认文件大小" }, { status: 411 });
    if (byteSize > limit) return Response.json({ error: video ? "视频不能超过 90 MiB" : font ? "字体不能超过 10 MiB" : "优化后的图片不能超过 8 MiB" }, { status: 413 });
    if (!request.body) return Response.json({ error: "上传内容为空" }, { status: 400 });

    const url = new URL(request.url);
    const assetId = validId(url.searchParams.get("assetId") ?? "") ? String(url.searchParams.get("assetId")) : crypto.randomUUID();
    const filename = cleanFilename(request.headers.get("x-file-name"), video ? "video" : font ? "font" : "image");
    const objectScope = slot === "transition" ? `categories/${projectId}` : projectId;
    const objectKey = `portfolio/${objectScope}/${slot}-${assetId}-${crypto.randomUUID()}.${extensionFor(contentType)}`;
    const bucket = getBucket();
    await bucket.put(objectKey, request.body, {
      httpMetadata: { contentType, cacheControl: "private, no-store" },
      customMetadata: { projectId, slot, uploadedBy: identity.user },
    });

    try {
      await getPortfolioDb()
        .prepare("INSERT INTO portfolio_media (id, object_key, project_id, slot, filename, content_type, byte_size, uploaded_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?)")
        .bind(crypto.randomUUID(), objectKey, projectId, slot, filename, contentType, byteSize, identity.user, new Date().toISOString())
        .run();
      await writeAuditLog({
        actorEmail: identity.user,
        action: "media.uploaded",
        targetType: slot === "hero" || slot === "font" || slot === "contact" ? "site" : slot === "transition" ? "category" : "project",
        targetId: projectId,
        summary: { slot, byteSize, contentType },
      });
    } catch (error) {
      await bucket.delete(objectKey);
      throw error;
    }

    return Response.json({
      asset: {
        id: assetId,
        label: filename,
        alt: "",
        kind: video ? "video" : font ? "font" : "image",
        key: objectKey,
        src: video ? undefined : `/api/media/${objectKey}`,
        visualKey: video ? "frame" : "frame",
      },
    }, { status: 201 });
  } catch (error) {
    console.error(JSON.stringify({ message: "portfolio media upload failed", error: errorMessage(error), projectId, slot }));
    return Response.json({ error: "媒体上传失败，请稍后重试" }, { status: 500 });
  }
}

export function uploadPolicy(slot: string, contentType: string): { kind: "image" | "video" | "font"; maxBytes: number } | null {
  if (slot === "final") return isVideo(contentType) ? { kind: "video", maxBytes: VIDEO_MAX } : null;
  if (slot === "font") return isFont(contentType) ? { kind: "font", maxBytes: FONT_MAX } : null;
  return isImage(contentType) ? { kind: "image", maxBytes: IMAGE_MAX } : null;
}

function isVideo(value: string) {
  return new Set(["video/mp4", "video/webm", "video/quicktime"]).has(value);
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
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif",
    "font/woff": "woff", "font/woff2": "woff2", "font/ttf": "ttf", "font/otf": "otf",
    "application/font-woff": "woff", "application/x-font-ttf": "ttf", "application/x-font-opentype": "otf",
  };
  return extensions[contentType];
}

function validId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(value);
}

function cleanFilename(value: string | null, fallback: string) {
  if (!value) return fallback;
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { decoded = value; }
  const cleaned = decoded.replace(/[\u0000-\u001f\\/]/gu, "_").trim().slice(0, 120);
  return cleaned || fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
