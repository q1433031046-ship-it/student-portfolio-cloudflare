import { getPurposeSecret } from "./app-secret";
import { authorizeAdmin, canManagePortfolio } from "./auth";
import { getPortfolioDb } from "./portfolio-store";
import {
  PORTFOLIO_ACCESS_COOKIE,
  accessSessionCookie,
  createAccessSession,
  createAccessToken,
  readCookie,
  verifyAccessSession,
  verifyAccessToken,
} from "./portfolio-access-security";

const SETTINGS_ID = "default";
export const ACCESS_SESSION_SECONDS = 24 * 60 * 60;
const ACCESS_PASS_STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS portfolio_access_pass_state (
  pass_id text PRIMARY KEY NOT NULL,
  session_generation integer DEFAULT 1 NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (pass_id) REFERENCES portfolio_access_passes(id) ON UPDATE no action ON DELETE cascade
)`;

type AccessPolicyRow = { restriction_enabled: number; updated_at: string | null; updated_by: string | null };
type AccessPassRow = {
  id: string;
  label: string;
  enabled: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  created_by: string;
};
type AccessPassStateRow = { session_generation: number };

export type AccessPassStatus = "active" | "paused" | "expired" | "exhausted";
export type AccessPass = {
  id: string;
  label: string;
  enabled: boolean;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  createdBy: string;
  status: AccessPassStatus;
};
export type AdminAccessPass = AccessPass & { accessUrl: string };
export type AccessConfiguration = {
  restrictionEnabled: boolean;
  updatedAt: string | null;
  passes: AdminAccessPass[];
};
export type AccessDecision = {
  allowed: boolean;
  restricted: boolean;
  reason: "open" | "admin" | "session" | "required" | "expired" | "revoked";
  passId?: string;
};
export type AccessPassInspection = {
  validToken: false;
  reason: "二维码无效";
} | {
  validToken: true;
  redeemable: boolean;
  reason: string | null;
  pass: Pick<AccessPass, "id" | "label" | "status" | "expiresAt">;
};

export class AccessPassConflictError extends Error {
  readonly status = 409;

  constructor() {
    super("二维码刚刚被其他操作更新，请刷新后重试");
  }
}

export async function getAccessConfiguration(origin: string): Promise<AccessConfiguration> {
  const [policy, rows] = await Promise.all([
    getAccessPolicy(),
    getPortfolioDb().prepare("SELECT id, label, enabled, max_uses, used_count, expires_at, created_at, updated_at, last_used_at, created_by FROM portfolio_access_passes ORDER BY created_at DESC").all<AccessPassRow>(),
  ]);
  const secret = getAccessSigningKey();
  const passes = await Promise.all((rows.results ?? []).map(async (row) => {
    const pass = mapPass(row);
    const token = await createAccessToken(pass.id, secret);
    return { ...pass, accessUrl: `${origin}/access?key=${encodeURIComponent(token)}` };
  }));
  return { ...policy, passes };
}

export async function getAccessPolicy() {
  const row = await getPortfolioDb()
    .prepare("SELECT restriction_enabled, updated_at, updated_by FROM portfolio_access_settings WHERE id = ? LIMIT 1")
    .bind(SETTINGS_ID)
    .first<AccessPolicyRow>();
  return { restrictionEnabled: row?.restriction_enabled === 1, updatedAt: row?.updated_at ?? null, updatedBy: row?.updated_by ?? null };
}

export async function setAccessRestriction(enabled: boolean, actor: string) {
  if (enabled && !await hasUsableAccessPass()) throw new Error("请先创建至少一张当前可用的二维码");
  const now = new Date().toISOString();
  await getPortfolioDb()
    .prepare("INSERT INTO portfolio_access_settings (id, restriction_enabled, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET restriction_enabled = excluded.restriction_enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
    .bind(SETTINGS_ID, enabled ? 1 : 0, now, actor)
    .run();
}

export async function createAccessPass(input: { label: string; maxUses: number | null; expiresAt: string | null }, actor: string) {
  const id = `qr_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = new Date().toISOString();
  await ensureAccessPassStateTable();
  await getPortfolioDb()
    .prepare("INSERT INTO portfolio_access_passes (id, label, enabled, max_uses, used_count, expires_at, created_at, updated_at, created_by) VALUES (?, ?, 1, ?, 0, ?, ?, ?, ?)")
    .bind(id, input.label, input.maxUses, input.expiresAt, now, now, actor)
    .run();
  await getPortfolioDb()
    .prepare("INSERT OR IGNORE INTO portfolio_access_pass_state (pass_id, session_generation, updated_at) VALUES (?, 1, ?)")
    .bind(id, now)
    .run();
  return id;
}

export async function updateAccessPass(id: string, patch: { label?: string; enabled?: boolean; maxUses?: number | null; expiresAt?: string | null }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await getPass(id);
    if (!current) throw new Error("二维码不存在");
    if (accessPassPatchMatches(current, patch)) return;

    const nextUpdatedAt = nextAccessPassVersion(current.updatedAt);
    await ensureAccessPassState(id, nextUpdatedAt);
    const db = getPortfolioDb();
    const { sql, values } = accessPassPatchUpdate(id, current.updatedAt, nextUpdatedAt, patch);
    const statements = [db.prepare(sql).bind(...values)];
    if (accessPassChangeRevokesSessions(current, patch, new Date())) {
      statements.push(
        db.prepare(`UPDATE portfolio_access_pass_state
          SET session_generation = session_generation + 1, updated_at = ?
          WHERE pass_id = ? AND changes() = 1`)
          .bind(nextUpdatedAt, id),
      );
    }
    const [updated] = await db.batch(statements);
    if (Number(updated?.meta.changes ?? 0) === 1) return;
  }
  throw new AccessPassConflictError();
}

export async function deleteAccessPass(id: string) {
  await ensureAccessPassStateTable();
  const db = getPortfolioDb();
  await db.batch([
    db.prepare("DELETE FROM portfolio_access_pass_state WHERE pass_id = ?").bind(id),
    db.prepare("DELETE FROM portfolio_access_passes WHERE id = ?").bind(id),
  ]);
}

export async function checkPortfolioAccess(request: Request): Promise<AccessDecision> {
  const policy = await getAccessPolicy();
  if (!policy.restrictionEnabled) return { allowed: true, restricted: false, reason: "open" };
  if (await isPortfolioAdmin(request)) return { allowed: true, restricted: true, reason: "admin" };

  const rawCookie = readCookie(request.headers.get("cookie"), PORTFOLIO_ACCESS_COOKIE);
  if (!rawCookie) return { allowed: false, restricted: true, reason: "required" };
  const session = await verifyAccessSession(rawCookie, getAccessSigningKey());
  if (!session) return { allowed: false, restricted: true, reason: "expired" };
  const pass = await getPass(session.passId);
  if (!pass || !isAccessPassSessionValid(pass)) return { allowed: false, restricted: true, reason: "revoked" };
  const sessionGeneration = await getAccessPassSessionGeneration(pass.id);
  if (session.sessionGeneration !== sessionGeneration) return { allowed: false, restricted: true, reason: "revoked" };
  return { allowed: true, restricted: true, reason: "session", passId: pass.id };
}

export async function inspectAccessPassToken(token: string): Promise<AccessPassInspection> {
  const passId = await verifyAccessToken(token, getAccessSigningKey());
  if (!passId) return { validToken: false, reason: "二维码无效" };
  const pass = await getPass(passId);
  if (!pass) return { validToken: false, reason: "二维码无效" };
  return {
    validToken: true,
    redeemable: pass.status === "active",
    reason: pass.status === "active" ? null : unavailableReason(pass),
    pass: { id: pass.id, label: pass.label, status: pass.status, expiresAt: pass.expiresAt },
  };
}

export async function redeemAccessPass(request: Request, token: string, now = new Date()) {
  const policy = await getAccessPolicy();
  if (!policy.restrictionEnabled) {
    return { ok: true as const, cookie: null, pass: null, reused: false as const, unrestricted: true as const };
  }

  const secret = getAccessSigningKey();
  const passId = await verifyAccessToken(token, secret);
  if (!passId) return { ok: false as const, reason: "二维码无效" };

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const existing = readCookie(request.headers.get("cookie"), PORTFOLIO_ACCESS_COOKIE);
  if (existing) {
    const session = await verifyAccessSession(existing, secret, nowSeconds);
    if (session?.passId === passId) {
      const pass = await getPass(passId);
      if (pass && isAccessPassSessionValid(pass, now)) {
        const sessionGeneration = await getAccessPassSessionGeneration(pass.id);
        if (session.sessionGeneration === sessionGeneration) {
          return { ok: true as const, cookie: accessSessionCookie(existing, session.expiresAt), pass, reused: true as const, unrestricted: false as const };
        }
      }
    }
  }

  const nowIso = now.toISOString();
  await ensureAccessPassState(passId, nowIso);
  const db = getPortfolioDb();
  const [consumeResult, policyResult, passResult, stateResult] = await db.batch([
    db.prepare(`UPDATE portfolio_access_passes
      SET used_count = used_count + 1, last_used_at = ?
      WHERE id = ? AND enabled = 1
        AND (expires_at IS NULL OR expires_at > ?)
        AND (max_uses IS NULL OR used_count < max_uses)
        AND EXISTS (
          SELECT 1 FROM portfolio_access_settings
          WHERE id = ? AND restriction_enabled = 1
        )`)
      .bind(nowIso, passId, nowIso, SETTINGS_ID),
    db.prepare("SELECT restriction_enabled, updated_at, updated_by FROM portfolio_access_settings WHERE id = ? LIMIT 1")
      .bind(SETTINGS_ID),
    db.prepare("SELECT id, label, enabled, max_uses, used_count, expires_at, created_at, updated_at, last_used_at, created_by FROM portfolio_access_passes WHERE id = ? LIMIT 1")
      .bind(passId),
    db.prepare("SELECT session_generation FROM portfolio_access_pass_state WHERE pass_id = ? LIMIT 1")
      .bind(passId),
  ]);
  const policyRow = policyResult?.results?.[0] as AccessPolicyRow | undefined;
  const passRow = passResult?.results?.[0] as AccessPassRow | undefined;
  const stateRow = stateResult?.results?.[0] as AccessPassStateRow | undefined;
  const pass = passRow ? mapPass(passRow) : null;
  if (Number(consumeResult?.meta.changes ?? 0) !== 1) {
    if (policyRow?.restriction_enabled !== 1) {
      return { ok: true as const, cookie: null, pass: null, reused: false as const, unrestricted: true as const };
    }
    return { ok: false as const, reason: unavailableReason(pass) };
  }
  if (!pass || !stateRow || !Number.isSafeInteger(Number(stateRow.session_generation)) || Number(stateRow.session_generation) < 1) {
    return { ok: false as const, reason: "二维码暂时不可用" };
  }
  const sessionGeneration = Number(stateRow.session_generation);
  const sessionExpiry = calculateAccessSessionExpiry(nowSeconds, pass.expiresAt);
  const sessionValue = await createAccessSession(pass.id, sessionGeneration, sessionExpiry, secret);
  return { ok: true as const, cookie: accessSessionCookie(sessionValue, sessionExpiry), pass, reused: false as const, unrestricted: false as const };
}

export function calculateAccessSessionExpiry(nowSeconds: number, passExpiresAt: string | null) {
  if (!passExpiresAt) return nowSeconds + ACCESS_SESSION_SECONDS;
  const passExpiry = Math.floor(new Date(passExpiresAt).getTime() / 1000);
  return Number.isSafeInteger(passExpiry)
    ? Math.min(nowSeconds + ACCESS_SESSION_SECONDS, passExpiry)
    : nowSeconds;
}

export function validateAccessPassInput(input: unknown, allowExpired = false) {
  if (!isRecord(input)) throw new Error("二维码设置格式无效");
  return {
    label: validateAccessPassLabel(input.label),
    maxUses: validateAccessPassMaxUses(input.maxUses),
    expiresAt: validateAccessPassExpiry(input.expiresAt, allowExpired),
  };
}

export function validateAccessPassPatch(input: unknown) {
  if (!isRecord(input)) throw new Error("二维码设置格式无效");
  const patch: { label?: string; maxUses?: number | null; expiresAt?: string | null } = {};
  if ("label" in input) patch.label = validateAccessPassLabel(input.label);
  if ("maxUses" in input) patch.maxUses = validateAccessPassMaxUses(input.maxUses);
  if ("expiresAt" in input) patch.expiresAt = validateAccessPassExpiry(input.expiresAt, true);
  return patch;
}

export function accessPassStatus(pass: AccessPass, now = new Date()) {
  return passStatus(pass, now);
}

export function isAccessPassSessionValid(pass: Pick<AccessPass, "enabled" | "expiresAt">, now = new Date()) {
  return pass.enabled && (!pass.expiresAt || new Date(pass.expiresAt).getTime() > now.getTime());
}

async function hasUsableAccessPass() {
  const now = new Date().toISOString();
  const row = await getPortfolioDb()
    .prepare("SELECT id FROM portfolio_access_passes WHERE enabled = 1 AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR used_count < max_uses) LIMIT 1")
    .bind(now)
    .first<{ id: string }>();
  return Boolean(row);
}

async function isPortfolioAdmin(request: Request) {
  const identity = await authorizeAdmin(request);
  if (!identity) return false;
  const row = await getPortfolioDb().prepare("SELECT owner_email FROM portfolio_documents WHERE id = ? LIMIT 1").bind(SETTINGS_ID).first<{ owner_email: string }>();
  return Boolean(row && canManagePortfolio(identity, row.owner_email));
}

async function getPass(id: string) {
  const row = await getPortfolioDb()
    .prepare("SELECT id, label, enabled, max_uses, used_count, expires_at, created_at, updated_at, last_used_at, created_by FROM portfolio_access_passes WHERE id = ? LIMIT 1")
    .bind(id)
    .first<AccessPassRow>();
  return row ? mapPass(row) : null;
}

function mapPass(row: AccessPassRow): AccessPass {
  const pass = {
    id: row.id,
    label: row.label,
    enabled: row.enabled === 1,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    createdBy: row.created_by,
  };
  return { ...pass, status: passStatus(pass) };
}

function passStatus(pass: Pick<AccessPass, "enabled" | "expiresAt" | "maxUses" | "usedCount">, now = new Date()): AccessPassStatus {
  if (!pass.enabled) return "paused";
  if (pass.expiresAt && new Date(pass.expiresAt).getTime() <= now.getTime()) return "expired";
  if (pass.maxUses !== null && pass.usedCount >= pass.maxUses) return "exhausted";
  return "active";
}

function unavailableReason(pass: AccessPass | null) {
  if (!pass) return "二维码无效";
  const status = passStatus(pass);
  if (status === "paused") return "二维码已停用";
  if (status === "expired") return "二维码已过期";
  if (status === "exhausted") return "二维码使用次数已用完";
  return "二维码暂时不可用";
}

async function ensureAccessPassStateTable() {
  await getPortfolioDb().prepare(ACCESS_PASS_STATE_TABLE_SQL).run();
}

async function ensureAccessPassState(passId: string, now = new Date().toISOString()) {
  await ensureAccessPassStateTable();
  await getPortfolioDb()
    .prepare("INSERT OR IGNORE INTO portfolio_access_pass_state (pass_id, session_generation, updated_at) VALUES (?, 1, ?)")
    .bind(passId, now)
    .run();
}

async function getAccessPassSessionGeneration(passId: string) {
  await ensureAccessPassState(passId);
  const row = await getPortfolioDb()
    .prepare("SELECT session_generation FROM portfolio_access_pass_state WHERE pass_id = ? LIMIT 1")
    .bind(passId)
    .first<AccessPassStateRow>();
  if (!row || !Number.isSafeInteger(Number(row.session_generation)) || Number(row.session_generation) < 1) {
    throw new Error("二维码访问会话状态无效");
  }
  return Number(row.session_generation);
}

function accessPassChangeRevokesSessions(
  current: Pick<AccessPass, "enabled" | "expiresAt">,
  patch: { enabled?: boolean; expiresAt?: string | null },
  now: Date,
) {
  if (patch.enabled !== undefined && patch.enabled !== current.enabled) return true;
  if (patch.expiresAt === undefined || patch.expiresAt === current.expiresAt) return false;
  const currentExpiry = current.expiresAt ? new Date(current.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const nextExpiry = patch.expiresAt ? new Date(patch.expiresAt).getTime() : Number.POSITIVE_INFINITY;
  return nextExpiry < currentExpiry || currentExpiry <= now.getTime();
}

function accessPassPatchMatches(
  current: Pick<AccessPass, "label" | "enabled" | "maxUses" | "expiresAt">,
  patch: { label?: string; enabled?: boolean; maxUses?: number | null; expiresAt?: string | null },
) {
  return (patch.label === undefined || patch.label === current.label)
    && (patch.enabled === undefined || patch.enabled === current.enabled)
    && (patch.maxUses === undefined || patch.maxUses === current.maxUses)
    && (patch.expiresAt === undefined || patch.expiresAt === current.expiresAt);
}

function accessPassPatchUpdate(
  id: string,
  expectedUpdatedAt: string,
  nextUpdatedAt: string,
  patch: { label?: string; enabled?: boolean; maxUses?: number | null; expiresAt?: string | null },
) {
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (patch.label !== undefined) {
    assignments.push("label = ?");
    values.push(patch.label);
  }
  if (patch.enabled !== undefined) {
    assignments.push("enabled = ?");
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.maxUses !== undefined) {
    assignments.push("max_uses = ?");
    values.push(patch.maxUses);
  }
  if (patch.expiresAt !== undefined) {
    assignments.push("expires_at = ?");
    values.push(patch.expiresAt);
  }
  assignments.push("updated_at = ?");
  values.push(nextUpdatedAt, id, expectedUpdatedAt);
  return {
    sql: `UPDATE portfolio_access_passes SET ${assignments.join(", ")} WHERE id = ? AND updated_at = ?`,
    values,
  };
}

function nextAccessPassVersion(current: string) {
  const currentTime = Date.parse(current);
  const nextTime = Math.max(Date.now(), Number.isFinite(currentTime) ? currentTime + 1 : 0);
  return new Date(nextTime).toISOString();
}

function validateAccessPassLabel(value: unknown) {
  const label = typeof value === "string" ? value.trim() : "";
  if (label.length < 1 || label.length > 60) throw new Error("二维码名称需为 1–60 个字符");
  return label;
}

function validateAccessPassMaxUses(value: unknown) {
  const maxUses = value === null || value === "" || value === undefined ? null : Number(value);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1_000_000)) {
    throw new Error("访问次数需为 1–1000000，或留空表示不限");
  }
  return maxUses;
}

function validateAccessPassExpiry(value: unknown, allowExpired: boolean) {
  if (value === null || value === "" || value === undefined) return null;
  const timestamp = new Date(String(value));
  if (!Number.isFinite(timestamp.getTime()) || (!allowExpired && timestamp.getTime() <= Date.now())) {
    throw new Error("过期时间必须晚于现在");
  }
  return timestamp.toISOString();
}

function getAccessSigningKey() {
  return getPurposeSecret("access");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
