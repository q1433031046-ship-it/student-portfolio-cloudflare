import { writeAuditLog } from "../../../_lib/audit";
import {
  getLegacyMediaMigrationSummary,
  LegacyMediaMigrationError,
  migrateNextLegacyMediaChunk,
} from "../../../_lib/legacy-media";
import { requirePortfolioManager } from "../../../_lib/site-ownership";

export async function POST(request: Request) {
  const access = await requirePortfolioManager(request);
  if (access instanceof Response) return access;
  try {
    const result = await migrateNextLegacyMediaChunk();
    if (result.status === "file-completed" && result.mediaId) {
      await writeAuditLog({
        actorEmail: access.identity.user,
        action: "media.legacy.migrated",
        targetType: "media",
        targetId: result.mediaId,
        summary: {
          byteSize: result.byteSize ?? 0,
          chunkCount: result.chunkCount ?? 0,
          sourceRetained: true,
        },
      });
    }
    return Response.json({ ok: true, result, legacyMigration: await getLegacyMediaMigrationSummary() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof LegacyMediaMigrationError) {
      return Response.json({ error: error.message }, {
        status: error.status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.error(JSON.stringify({ message: "legacy media migration failed", error: errorMessage(error) }));
    return Response.json({ error: "旧媒体迁移暂时失败，请稍后重试" }, { status: 503 });
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
