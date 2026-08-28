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
const MAX_SESSION_SECONDS = 30 * 24 * 60 * 60;

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
  await getPortfolioDb()
    .prepare("INSERT INTO portfolio_access_passes (id, label, enabled, max_uses, used_count, expires_at, created_at, updated_at, created_by) VALUES (?, ?, 1, ?, 0, ?, ?, ?, ?)")
    .bind(id, input.label, input.maxUses, input.expiresAt, now, now, actor)
    .run();
  return id;
}

export async function updateAccessPass(id: string, patch: { label?: string; enabled?: boolean; maxUses?: number | null; expiresAt?: string | null }) {
  const current = await getPass(id);
  if (!current) throw new Error("二维码不存在");
  const next = {
    ...current,
    label: patch.label ?? current.label,
    enabled: patch.enabled ?? current.enabled,
    maxUses: patch.maxUses === undefined ? current.maxUses : patch.maxUses,
    expiresAt: patch.expiresAt === undefined ? current.expiresAt : patch.expiresAt,
  };
  await preventVisitorLockout(id, next);
  const now = new Date().toISOString();
  await getPortfolioDb()
    .prepare("UPDATE portfolio_access_passes SET label = ?, enabled = ?, max_uses = ?, expires_at = ?, updated_at = ? WHERE id = ?")
    .bind(patch.label ?? current.label, patch.enabled === undefined ? current.enabled ? 1 : 0 : patch.enabled ? 1 : 0, patch.maxUses === undefined ? current.maxUses : patch.maxUses, patch.expiresAt === undefined ? current.expiresAt : patch.expiresAt, now, id)
    .run();
}

export async function deleteAccessPass(id: string) {
  const current = await getPass(id);
  if (current) await preventVisitorLockout(id, { ...current, enabled: false });
  await getPortfolioDb().prepare("DELETE FROM portfolio_access_passes WHERE id = ?").bind(id).run();
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
  return { allowed: true, restricted: true, reason: "session", passId: pass.id };
}

export async function redeemAccessPass(request: Request, token: string) {
  const secret = getAccessSigningKey();
  const passId = await verifyAccessToken(token, secret);
  if (!passId) return { ok: false as const, reason: "二维码无效" };

  const existing = readCookie(request.headers.get("cookie"), PORTFOLIO_ACCESS_COOKIE);
  if (existing) {
    const session = await verifyAccessSession(existing, secret);
    if (session?.passId === passId) {
      const pass = await getPass(passId);
      if (pass && isAccessPassSessionValid(pass)) return { ok: true as const, cookie: accessSessionCookie(existing, session.expiresAt), pass };
    }
  }

  const now = new Date().toISOString();
  const result = await getPortfolioDb()
    .prepare("UPDATE portfolio_access_passes SET used_count = used_count + 1, last_used_at = ?, updated_at = ? WHERE id = ? AND enabled = 1 AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR used_count < max_uses)")
    .bind(now, now, passId, now)
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    const pass = await getPass(passId);
    return { ok: false as const, reason: unavailableReason(pass) };
  }

  const pass = await getPass(passId);
  if (!pass) return { ok: false as const, reason: "二维码无效" };
  const absoluteExpiry = pass.expiresAt ? Math.floor(new Date(pass.expiresAt).getTime() / 1000) : Number.POSITIVE_INFINITY;
  const sessionExpiry = Math.min(Math.floor(Date.now() / 1000) + MAX_SESSION_SECONDS, absoluteExpiry);
  const sessionValue = await createAccessSession(pass.id, sessionExpiry, secret);
  return { ok: true as const, cookie: accessSessionCookie(sessionValue, sessionExpiry), pass };
}

export function validateAccessPassInput(input: unknown, allowExpired = false) {
  if (!isRecord(input)) throw new Error("二维码设置格式无效");
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (label.length < 1 || label.length > 60) throw new Error("二维码名称需为 1–60 个字符");
  const maxUses = input.maxUses === null || input.maxUses === "" || input.maxUses === undefined ? null : Number(input.maxUses);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1_000_000)) throw new Error("访问次数需为 1–1000000，或留空表示不限");
  let expiresAt: string | null = null;
  if (input.expiresAt !== null && input.expiresAt !== "" && input.expiresAt !== undefined) {
    const timestamp = new Date(String(input.expiresAt));
    if (!Number.isFinite(timestamp.getTime()) || (!allowExpired && timestamp.getTime() <= Date.now())) throw new Error("过期时间必须晚于现在");
    expiresAt = timestamp.toISOString();
  }
  return { label, maxUses, expiresAt };
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

async function preventVisitorLockout(excludedId: string, next: Pick<AccessPass, "enabled" | "expiresAt" | "maxUses" | "usedCount">) {
  const policy = await getAccessPolicy();
  if (!policy.restrictionEnabled || passStatus(next) === "active") return;
  const now = new Date().toISOString();
  const alternate = await getPortfolioDb()
    .prepare("SELECT id FROM portfolio_access_passes WHERE id != ? AND enabled = 1 AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR used_count < max_uses) LIMIT 1")
    .bind(excludedId, now)
    .first<{ id: string }>();
  if (!alternate) throw new Error("访问限制开启时必须保留至少一张可用二维码");
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

function getAccessSigningKey() {
  return getPurposeSecret("access");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
