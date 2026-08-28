import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure the binding in wrangler.jsonc or let your hosting control plane inject it before using the database."
    );
  }

  return drizzle(db, { schema });
}
