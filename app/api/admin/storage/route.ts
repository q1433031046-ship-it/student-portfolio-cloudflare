import { getPortfolioDb } from "../../_lib/portfolio-store";
import { requirePortfolioManager } from "../../_lib/site-ownership";
import { MEDIA_STORAGE_LIMIT, MEDIA_STORAGE_WARNING, VIDEO_UPLOAD_LIMIT } from "../../_lib/storage";

export async function GET(request: Request) {
  const access = await requirePortfolioManager(request);
  if (access instanceof Response) return access;
  try {
    const row = await getPortfolioDb()
      .prepare(`SELECT
        COALESCE(SUM(CASE WHEN status = 'uploaded' THEN byte_size ELSE 0 END), 0) AS used_bytes,
        COALESCE(SUM(CASE WHEN status = 'uploaded' THEN 1 ELSE 0 END), 0) AS file_count,
        COALESCE(SUM(CASE WHEN status = 'uploaded' AND content_type LIKE 'video/%' THEN 1 ELSE 0 END), 0) AS video_count,
        COALESCE(SUM(CASE WHEN status = 'uploaded' AND content_type NOT LIKE 'video/%' THEN 1 ELSE 0 END), 0) AS other_count
        FROM portfolio_media`)
      .first<{ used_bytes: number; file_count: number; video_count: number; other_count: number }>();
    const usedBytes = Math.max(0, Number(row?.used_bytes ?? 0));
    const remainingBytes = Math.max(0, MEDIA_STORAGE_LIMIT - usedBytes);
    return Response.json({
      usedBytes,
      limitBytes: MEDIA_STORAGE_LIMIT,
      remainingBytes,
      percentage: Math.min(100, Math.round((usedBytes / MEDIA_STORAGE_LIMIT) * 1000) / 10),
      status: usedBytes >= MEDIA_STORAGE_LIMIT ? "full" : usedBytes >= MEDIA_STORAGE_WARNING ? "warning" : "normal",
      fileCount: Number(row?.file_count ?? 0),
      videoCount: Number(row?.video_count ?? 0),
      otherCount: Number(row?.other_count ?? 0),
      fullSizeVideosRemaining: Math.floor(remainingBytes / VIDEO_UPLOAD_LIMIT),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ message: "storage summary failed", error: errorMessage(error) }));
    return Response.json({ error: "网站空间暂时无法读取" }, { status: 503 });
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
