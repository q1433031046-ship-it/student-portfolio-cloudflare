import { env } from "cloudflare:workers";
import { RECOMMENDED_INITIAL_ADMIN_CODE } from "../../lib/program-version";
import { getPortfolioDb } from "./portfolio-store";

type SecretBindings = {
  INITIAL_ADMIN_CODE?: string;
  MEDIA_SIGNING_KEY?: string;
  ACCESS_SIGNING_KEY?: string;
  ANALYTICS_HASH_KEY?: string;
};

type Purpose = "media" | "access" | "analytics";

export function getInitialAdminCode() {
  const configured = (env as unknown as SecretBindings).INITIAL_ADMIN_CODE?.trim();
  if (configured && configured.length >= 16 && /[A-Za-z]/u.test(configured) && /\d/u.test(configured)) {
    return configured;
  }
  return RECOMMENDED_INITIAL_ADMIN_CODE;
}

export async function getPurposeSecret(purpose: Purpose) {
  const bindings = env as unknown as SecretBindings;
  const override = purpose === "media"
    ? bindings.MEDIA_SIGNING_KEY
    : purpose === "access"
      ? bindings.ACCESS_SIGNING_KEY
      : bindings.ANALYTICS_HASH_KEY;
  if (override?.trim()) return override.trim();

  const db = getPortfolioDb();
  const existing = await db
    .prepare("SELECT secret_value FROM system_secrets WHERE purpose = ? LIMIT 1")
    .bind(purpose)
    .first<{ secret_value: string }>();
  if (existing?.secret_value) return existing.secret_value;

  const generated = randomToken(32);
  const now = new Date().toISOString();
  await db
    .prepare("INSERT OR IGNORE INTO system_secrets (purpose, secret_value, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(purpose, generated, now, now)
    .run();
  const stored = await db
    .prepare("SELECT secret_value FROM system_secrets WHERE purpose = ? LIMIT 1")
    .bind(purpose)
    .first<{ secret_value: string }>();
  if (!stored?.secret_value) throw new Error(`${purpose} 运行密钥无法创建`);
  return stored.secret_value;
}

function randomToken(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
