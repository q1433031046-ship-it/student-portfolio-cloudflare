import { env } from "cloudflare:workers";
import { mediaAssetsInDocument, validatePortfolioDocument, type PortfolioDocument } from "../../portfolio/model";

const DOCUMENT_ID = "default";

type PortfolioRow = {
  id: string;
  owner_email: string;
  revision: number;
  draft_json: string;
  published_json: string | null;
  updated_at: string;
  published_at: string | null;
};

export type PortfolioRecord = {
  id: string;
  ownerEmail: string;
  revision: number;
  draft: PortfolioDocument;
  published: PortfolioDocument | null;
  updatedAt: string;
  publishedAt: string | null;
};

export class PortfolioPublishError extends Error {
  readonly code = "PORTFOLIO_MEDIA_NOT_READY";
  readonly status = 409;
  constructor() { super("草稿引用的媒体尚未上传完成或不存在，已停止动态发布"); }
}

export function getPortfolioDb(): D1Database {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new Error("作品集数据库不可用");
  return db;
}

export async function getPortfolioRecord(): Promise<PortfolioRecord | null> {
  const row = await getPortfolioDb()
    .prepare("SELECT id, owner_email, revision, draft_json, published_json, updated_at, published_at FROM portfolio_documents WHERE id = ? LIMIT 1")
    .bind(DOCUMENT_ID)
    .first<PortfolioRow>();
  return row ? parseRow(row) : null;
}

export async function savePortfolioDraft(document: PortfolioDocument, expectedRevision: number): Promise<PortfolioRecord | null> {
  const nextRevision = expectedRevision + 1;
  const updatedAt = new Date().toISOString();
  const referencedMediaKeys = referencedMediaKeysInDocument(document);
  const result = await getPortfolioDb()
    .prepare(`UPDATE portfolio_documents SET draft_json = ?, revision = ?, updated_at = ?
      WHERE id = ? AND revision = ?
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) AS referenced
          LEFT JOIN portfolio_media AS media ON media.object_key = referenced.value
          WHERE media.id IS NULL OR media.status != 'uploaded'
        )`)
    .bind(JSON.stringify(document), nextRevision, updatedAt, DOCUMENT_ID, expectedRevision, JSON.stringify(referencedMediaKeys))
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) return null;
  return getPortfolioRecord();
}

export async function publishPortfolio(expectedRevision: number): Promise<PortfolioRecord | null> {
  const nextRevision = expectedRevision + 1;
  const now = new Date().toISOString();
  // Read the exact revision whose draft is about to be published, then repeat
  // the media identity/readiness check inside the CAS UPDATE. If the draft
  // changes between these statements, the revision predicate makes the
  // update fail instead of publishing a stale document.
  const current = await getPortfolioRecord();
  if (!current || current.revision !== expectedRevision) return null;
  const referencedMediaKeys = referencedMediaKeysInDocument(current.draft);
  const result = await getPortfolioDb()
    .prepare(`UPDATE portfolio_documents SET published_json = draft_json, revision = ?, updated_at = ?, published_at = ?
      WHERE id = ? AND revision = ?
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) AS referenced
          LEFT JOIN portfolio_media AS media ON media.object_key = referenced.value
          WHERE media.id IS NULL OR media.status != 'uploaded'
        )`)
    .bind(nextRevision, now, now, DOCUMENT_ID, expectedRevision, JSON.stringify(referencedMediaKeys))
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    const latest = await getPortfolioRecord();
    if (latest?.revision === expectedRevision) throw new PortfolioPublishError();
    return null;
  }
  return getPortfolioRecord();
}

export function referencedMediaKeysInDocument(document: PortfolioDocument) {
  return Array.from(new Set(mediaAssetsInDocument(document).flatMap((asset) => asset.key ? [asset.key] : [])));
}

export async function getPublishedPortfolio(): Promise<{ document: PortfolioDocument | null; revision: number; publishedAt: string | null }> {
  const record = await getPortfolioRecord();
  if (!record?.published) return { document: null, revision: record?.revision ?? 0, publishedAt: null };
  return { document: record.published, revision: record.revision, publishedAt: record.publishedAt };
}

function parseRow(row: PortfolioRow): PortfolioRecord {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    revision: row.revision,
    draft: parseDocument(row.draft_json, "草稿"),
    published: row.published_json ? parseDocument(row.published_json, "发布快照") : null,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

function parseDocument(serialized: string, label: string): PortfolioDocument {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error(`${label}数据无法解析`);
  }
  const result = validatePortfolioDocument(value);
  if (!result.ok) throw new Error(`${label}数据不符合当前结构：${result.errors[0]}`);
  return result.value;
}
