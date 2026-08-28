import { getPortfolioDb } from "./portfolio-store";
import {
  buildEventDedupeKey,
  deriveRequestContext,
  getAnalyticsHashKey,
  sanitizeReferrer,
  type RequestContext,
} from "./request-context";

export const PUBLIC_EVENT_TYPES = new Set(["page_view", "project_open", "play_request", "play_error"]);

export async function recordPortfolioEvent(input: {
  request: Request;
  eventType: string;
  path: string;
  projectId?: string | null;
  mediaVersion?: string | null;
  action?: "allow" | "block";
  sessionId?: string | null;
  context?: RequestContext;
  forcedRisk?: { level: "medium" | "high"; reason: string };
}) {
  const context = input.context ?? await deriveRequestContext(input.request);
  const riskLevel = input.forcedRisk?.level ?? context.riskLevel;
  const riskReason = input.forcedRisk?.reason ?? context.riskReason;
  const action = input.action ?? "allow";
  const hashKey = getAnalyticsHashKey();
  const identifier = input.sessionId ?? context.networkHash;
  const dedupeKey = hashKey && identifier ? await buildEventDedupeKey({
    sessionId: identifier,
    eventType: input.eventType,
    path: input.path,
    projectId: input.projectId,
    mediaVersion: input.mediaVersion,
    action,
  }, hashKey) : null;
  const occurredAt = new Date().toISOString();
  await getPortfolioDb()
    .prepare(`INSERT INTO portfolio_events (
      id, occurred_at, event_type, path, project_id, media_version, referrer,
      device_type, browser, operating_system, country, region, city, asn,
      as_organization, network_hash, risk_level, risk_reason, action,
      dedupe_key, event_count, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      event_count = portfolio_events.event_count + 1,
      last_seen_at = excluded.last_seen_at,
      risk_level = excluded.risk_level,
      risk_reason = excluded.risk_reason,
      action = excluded.action`)
    .bind(
      crypto.randomUUID(), occurredAt, input.eventType, input.path,
      input.projectId ?? null, input.mediaVersion ?? null,
      sanitizeReferrer(input.request.headers.get("referer")), context.deviceType,
      context.browser, context.operatingSystem, context.country, context.region,
      context.city, context.asn, context.asOrganization, context.networkHash,
      riskLevel, riskReason, action, dedupeKey, occurredAt,
    )
    .run();
}

export async function recentPlaybackCount(networkHash: string) {
  const row = await getPortfolioDb()
    .prepare("SELECT COALESCE(SUM(event_count), 0) AS total FROM portfolio_events WHERE network_hash = ? AND event_type = 'play_request' AND datetime(COALESCE(last_seen_at, occurred_at)) >= datetime('now', '-5 minutes')")
    .bind(networkHash)
    .first<{ total: number }>();
  return Number(row?.total ?? 0);
}
