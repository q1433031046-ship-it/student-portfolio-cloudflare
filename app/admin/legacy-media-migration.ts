export type LegacyMediaMigrationSummary = {
  status: "complete" | "ready" | "blocked";
  required: boolean;
  r2FileCount: number;
  r2Bytes: number;
  verifiedChunks: number;
  verifiedBytes: number;
  totalChunks: number;
  sourceBindingAvailable: boolean;
  targetBindingAvailable: boolean;
  message: string;
};

export async function migrateLegacyMediaUntilComplete(
  initial: LegacyMediaMigrationSummary,
  migrateNext: () => Promise<LegacyMediaMigrationSummary>,
  onProgress: (summary: LegacyMediaMigrationSummary) => void,
) {
  let current = initial;
  const maximumRequests = Math.max(1, current.totalChunks - current.verifiedChunks + 1);
  let requestCount = 0;
  while (current.status === "ready" && requestCount < maximumRequests) {
    const previousProgress = progressKey(current);
    current = await migrateNext();
    requestCount += 1;
    onProgress(current);
    if (current.status === "ready" && progressKey(current) === previousProgress) {
      throw new Error("旧媒体迁移进度没有更新");
    }
  }
  if (current.status === "ready") throw new Error("旧媒体迁移尚未完成");
  return current;
}

function progressKey(summary: LegacyMediaMigrationSummary) {
  return [summary.r2FileCount, summary.r2Bytes, summary.verifiedChunks, summary.verifiedBytes, summary.totalChunks].join(":");
}
