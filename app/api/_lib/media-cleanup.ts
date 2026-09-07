import { mediaAssetsInDocument, type PortfolioDocument } from "../../portfolio/model";
import { getPortfolioDb } from "./portfolio-store";
import { deleteStoredMedia } from "./storage";
import { protectMediaKeysForCleanup } from "./static-site-store";

const DOCUMENT_ID = "default";

type CleanupMediaRow = {
  object_key: string;
  storage_backend: "kv";
  chunk_count: number;
  status: "uploaded" | "deleting";
};

export async function cleanupUnreferencedMedia(document: PortfolioDocument, expectedRevision: number) {
  try {
    return await cleanupUnreferencedKvMedia(document, expectedRevision);
  } catch {
    throw new Error("媒体自动清理暂时失败，稍后将重试");
  }
}

async function cleanupUnreferencedKvMedia(document: PortfolioDocument, expectedRevision: number) {
  const referencedKeys = Array.from(new Set(mediaAssetsInDocument(document).flatMap((asset) => asset.key ? [asset.key] : [])));
  const referenced = new Set(referencedKeys);
  const protectedStaticKeys = await protectMediaKeysForCleanup();
  const database = getPortfolioDb();
  const rows = await database
    .prepare(`SELECT media.object_key, media.storage_backend, media.chunk_count, media.status
      FROM portfolio_media AS media
      WHERE media.storage_backend = 'kv' AND media.status IN ('uploaded', 'deleting')
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) AS referenced
          WHERE referenced.value = media.object_key
        )
      ORDER BY media.created_at ASC LIMIT 1000`)
    .bind(JSON.stringify(referencedKeys))
    .all<CleanupMediaRow>();
  const unused = rows.results.filter((row) => !referenced.has(row.object_key) && !protectedStaticKeys.has(row.object_key));
  let removed = 0;

  for (const row of unused) {
    if (row.status === "uploaded") {
      const claim = await database
        .prepare(`UPDATE portfolio_media SET status = 'deleting'
          WHERE object_key = ? AND storage_backend = 'kv' AND status = 'uploaded'
            AND EXISTS (
              SELECT 1 FROM portfolio_documents
              WHERE id = ? AND revision = ?
            )`)
        .bind(row.object_key, DOCUMENT_ID, expectedRevision)
        .run();
      if (Number(claim.meta.changes ?? 0) !== 1) continue;
    }

    await deleteStoredMedia({ objectKey: row.object_key, chunkCount: row.chunk_count });
    const retired = await database
      .prepare("UPDATE portfolio_media SET status = 'deleted' WHERE object_key = ? AND storage_backend = 'kv' AND status = 'deleting'")
      .bind(row.object_key)
      .run();
    if (Number(retired.meta.changes ?? 0) === 1) removed += 1;
  }

  return removed;
}
