import { getPortfolioDb } from "../../_lib/portfolio-store";
import { requirePortfolioManager } from "../../_lib/site-ownership";

type AuditRow = {
  id: string;
  occurred_at: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  summary_json: string;
};

export async function GET(request: Request) {
  try {
    const access = await requirePortfolioManager(request);
    if (access instanceof Response) return access;
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 60), 1), 200);
    const rows = await getPortfolioDb()
      .prepare("SELECT id, occurred_at, actor_email, action, target_type, target_id, summary_json FROM portfolio_audit_logs ORDER BY occurred_at DESC LIMIT ?")
      .bind(limit)
      .all<AuditRow>();
    return Response.json({
      logs: rows.results.map((row) => ({
        id: row.id, occurredAt: row.occurred_at, actorEmail: row.actor_email,
        action: row.action, targetType: row.target_type, targetId: row.target_id,
        summary: safeJson(row.summary_json),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ message: "admin audit read failed", error: errorMessage(error) }));
    return Response.json({ error: "管理记录暂时无法读取" }, { status: 500 });
  }
}

function safeJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return {}; }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
