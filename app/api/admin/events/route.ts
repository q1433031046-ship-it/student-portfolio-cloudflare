import { getPortfolioDb } from "../../_lib/portfolio-store";
import { requirePortfolioManager } from "../../_lib/site-ownership";

type EventRow = {
  id: string;
  occurred_at: string;
  event_type: string;
  path: string;
  project_id: string | null;
  media_version: string | null;
  referrer: string | null;
  device_type: string | null;
  browser: string | null;
  operating_system: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  as_organization: string | null;
  network_hash: string | null;
  risk_level: string;
  risk_reason: string | null;
  action: string;
  event_count: number;
  last_seen_at: string | null;
};

export async function GET(request: Request) {
  try {
    const access = await requirePortfolioManager(request);
    if (access instanceof Response) return access;

    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 60), 1), 200);
    const eventType = cleanFilter(url.searchParams.get("type"), 40);
    const projectId = cleanFilter(url.searchParams.get("project"), 80);
    const risk = cleanFilter(url.searchParams.get("risk"), 20);
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (eventType) { clauses.push("event_type = ?"); values.push(eventType); }
    if (projectId) { clauses.push("project_id = ?"); values.push(projectId); }
    if (risk) { clauses.push("risk_level = ?"); values.push(risk); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const query = `SELECT id, occurred_at, event_type, path, project_id, media_version, referrer, device_type, browser, operating_system, country, region, city, asn, as_organization, network_hash, risk_level, risk_reason, action, event_count, last_seen_at FROM portfolio_events ${where} ORDER BY COALESCE(last_seen_at, occurred_at) DESC LIMIT ?`;
    const rows = await getPortfolioDb().prepare(query).bind(...values, limit).all<EventRow>();
    return Response.json({ events: rows.results.map(mapEvent) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ message: "admin event read failed", error: errorMessage(error) }));
    return Response.json({ error: "访问记录暂时无法读取" }, { status: 500 });
  }
}

function mapEvent(row: EventRow) {
  return {
    id: row.id, occurredAt: row.occurred_at, eventType: row.event_type, path: row.path,
    projectId: row.project_id, mediaVersion: row.media_version, referrer: row.referrer,
    deviceType: row.device_type, browser: row.browser, operatingSystem: row.operating_system,
    country: row.country, region: row.region, city: row.city, asn: row.asn,
    asOrganization: row.as_organization, networkHash: row.network_hash,
    riskLevel: row.risk_level, riskReason: row.risk_reason, action: row.action,
    eventCount: row.event_count, lastSeenAt: row.last_seen_at,
  };
}

function cleanFilter(value: string | null, max: number) {
  return value && /^[a-zA-Z0-9_.-]+$/u.test(value) ? value.slice(0, max) : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
