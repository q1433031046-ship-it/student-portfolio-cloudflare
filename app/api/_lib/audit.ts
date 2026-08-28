import { getPortfolioDb } from "./portfolio-store";

export async function writeAuditLog(input: {
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  summary?: Record<string, string | number | boolean | null>;
}) {
  try {
    await getPortfolioDb()
      .prepare("INSERT INTO portfolio_audit_logs (id, occurred_at, actor_email, action, target_type, target_id, summary_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        new Date().toISOString(),
        input.actorEmail,
        input.action,
        input.targetType,
        input.targetId,
        JSON.stringify(input.summary ?? {}),
      )
      .run();
  } catch (error) {
    console.error(JSON.stringify({ message: "portfolio audit write failed", error: errorMessage(error), action: input.action }));
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
