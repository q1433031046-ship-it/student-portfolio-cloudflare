import { mediaAssetsInDocument, type PortfolioDocument } from "../../portfolio/model";
import { getPortfolioDb } from "./portfolio-store";
import { getBucket } from "./storage";

export async function cleanupUnreferencedMedia(document: PortfolioDocument) {
  const referenced = new Set(mediaAssetsInDocument(document).flatMap((asset) => asset.key ? [asset.key] : []));
  const rows = await getPortfolioDb()
    .prepare("SELECT object_key FROM portfolio_media WHERE status = 'uploaded' ORDER BY created_at ASC LIMIT 1000")
    .all<{ object_key: string }>();
  const unused = rows.results.map((row) => row.object_key).filter((key) => !referenced.has(key));
  if (unused.length === 0) return 0;

  await getBucket().delete(unused);
  const placeholders = unused.map(() => "?").join(", ");
  await getPortfolioDb()
    .prepare(`UPDATE portfolio_media SET status = 'deleted' WHERE object_key IN (${placeholders})`)
    .bind(...unused)
    .run();
  return unused.length;
}
