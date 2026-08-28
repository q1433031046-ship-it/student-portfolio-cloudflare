import { mediaAssetsInDocument, type PortfolioDocument } from "../../portfolio/model";
import { getPortfolioDb } from "./portfolio-store";
import { deleteStoredMedia } from "./storage";

export async function cleanupUnreferencedMedia(document: PortfolioDocument) {
  const referenced = new Set(mediaAssetsInDocument(document).flatMap((asset) => asset.key ? [asset.key] : []));
  const rows = await getPortfolioDb()
    .prepare("SELECT object_key, storage_backend, chunk_count FROM portfolio_media WHERE status = 'uploaded' ORDER BY created_at ASC LIMIT 1000")
    .all<{ object_key: string; storage_backend: "r2" | "kv"; chunk_count: number }>();
  const unused = rows.results.filter((row) => !referenced.has(row.object_key));
  if (unused.length === 0) return 0;

  for (const row of unused) {
    await deleteStoredMedia({ objectKey: row.object_key, storageBackend: row.storage_backend, chunkCount: row.chunk_count });
  }
  const placeholders = unused.map(() => "?").join(", ");
  await getPortfolioDb()
    .prepare(`UPDATE portfolio_media SET status = 'deleted' WHERE object_key IN (${placeholders})`)
    .bind(...unused.map((row) => row.object_key))
    .run();
  return unused.length;
}
