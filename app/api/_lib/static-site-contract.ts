import { mediaAssetsInDocument, toPublicPortfolioDocument, type MediaAsset, type PortfolioDocument } from "../../portfolio/model";

export const STATIC_PROGRAM_VERSION = "1.3.1-b";
export const STATIC_BUILD_BRANCH = "static-build/v1.3.1-b";
export const MAX_CANDIDATE_BYTES = 1024 * 1024;
export const MAX_STATIC_MEDIA_BYTES = 800 * 1024 * 1024;
export const PROVIDER_REQUEST_KEY_PATTERN = /^sp-[a-f0-9]{24}$/u;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type StaticMediaRecord = {
  id: string;
  objectKey: string;
  publicPath: string;
  contentType: string;
  byteSize: number;
  storageBackend: "kv" | "r2";
  sourceEtag: string;
};

export type FrozenStaticCandidate = {
  candidate: PortfolioDocument;
  canonicalJson: string;
  candidateSha256: string;
  media: StaticMediaRecord[];
  totalMediaBytes: number;
};

export class StaticSiteContractError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortCanonical(value));
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  return digestHex("SHA-256", value);
}

export async function sha1Hex(value: string | Uint8Array): Promise<string> {
  return digestHex("SHA-1", value);
}

async function digestHex(algorithm: "SHA-1" | "SHA-256", value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest(algorithm, Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function freezeStaticCandidate(
  document: PortfolioDocument,
  records: Array<Omit<StaticMediaRecord, "publicPath"> & { status: string }>,
): Promise<FrozenStaticCandidate> {
  const recordByKey = new Map(records.map((record) => [record.objectKey, record]));
  const assets = uniqueReferencedAssets(document);
  const media = assets.map((asset) => {
    const key = asset.key;
    if (!key) throw new StaticSiteContractError("STATIC_MEDIA_KEY_MISSING", "公开媒体缺少存储引用");
    const record = recordByKey.get(key);
    if (!record || record.status !== "uploaded") {
      throw new StaticSiteContractError("STATIC_MEDIA_NOT_READY", "公开媒体尚未完整上传");
    }
    if (!isAllowedContentType(record.contentType, asset.kind)) {
      throw new StaticSiteContractError("STATIC_MEDIA_TYPE_UNSUPPORTED", "公开媒体类型不受支持");
    }
    if (!Number.isSafeInteger(record.byteSize) || record.byteSize < 1) {
      throw new StaticSiteContractError("STATIC_MEDIA_SIZE_INVALID", "公开媒体大小无效");
    }
    return {
      id: record.id,
      objectKey: record.objectKey,
      publicPath: publicMediaPath(record.id, record.contentType),
      contentType: record.contentType,
      byteSize: record.byteSize,
      storageBackend: record.storageBackend,
      sourceEtag: record.sourceEtag,
    } satisfies StaticMediaRecord;
  }).sort((left, right) => left.publicPath.localeCompare(right.publicPath, "en"));
  const totalMediaBytes = media.reduce((sum, item) => sum + item.byteSize, 0);
  if (totalMediaBytes > MAX_STATIC_MEDIA_BYTES) {
    throw new StaticSiteContractError("STATIC_MEDIA_LIMIT_EXCEEDED", "静态媒体总量超过上限");
  }

  const pathByKey = new Map(media.map((item) => [item.objectKey, `/${item.publicPath}`]));
  const candidate = rewritePublicMedia(toPublicPortfolioDocument(document), document, pathByKey);
  const serialized = canonicalJson(candidate);
  if (new TextEncoder().encode(serialized).byteLength > MAX_CANDIDATE_BYTES) {
    throw new StaticSiteContractError("STATIC_CANDIDATE_TOO_LARGE", "公开候选数据超过 1 MiB");
  }
  rejectSensitiveOutput(serialized, records.map((record) => record.objectKey));
  return { candidate, canonicalJson: serialized, candidateSha256: await sha256Hex(serialized), media, totalMediaBytes };
}

export function publicMediaPath(mediaId: string, contentType: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(mediaId)) throw new StaticSiteContractError("STATIC_MEDIA_ID_INVALID", "媒体编号无效");
  return `media/${mediaId}${extensionForContentType(contentType)}`;
}

function uniqueReferencedAssets(document: PortfolioDocument) {
  const byKey = new Map<string, MediaAsset>();
  for (const asset of mediaAssetsInDocument(document)) {
    if (!asset.key || document.archivedMedia?.includes(asset)) continue;
    if (!byKey.has(asset.key)) byKey.set(asset.key, asset);
  }
  return [...byKey.values()];
}

function rewritePublicMedia(document: PortfolioDocument, original: PortfolioDocument, pathByKey: Map<string, string>): PortfolioDocument {
  const copy = structuredClone(document) as PortfolioDocument;
  for (const asset of mediaAssetsInDocument(copy)) {
    const source = findOriginalAssetById(original, asset.id);
    const key = source?.key;
    delete asset.key;
    if (key) {
      const path = pathByKey.get(key);
      if (!path) throw new StaticSiteContractError("STATIC_MEDIA_NOT_FROZEN", "公开媒体没有冻结记录");
      asset.src = path;
      asset.available = true;
    } else {
      delete asset.src;
      delete asset.available;
    }
  }
  delete copy.archivedMedia;
  return copy;
}

function findOriginalAssetById(document: PortfolioDocument, id: string) {
  return mediaAssetsInDocument(document).find((asset) => asset.id === id);
}

function rejectSensitiveOutput(serialized: string, objectKeys: string[]) {
  const forbidden = ["ownerEmail", "owner_email", "accessToken", "tokenHash", "auditLogs", "bootstrap", "leaseId"];
  if (forbidden.some((value) => serialized.includes(value)) || objectKeys.some((value) => value && serialized.includes(value))) {
    throw new StaticSiteContractError("STATIC_CANDIDATE_SENSITIVE_DATA", "公开候选包含内部字段");
  }
}

function isAllowedContentType(contentType: string, kind: MediaAsset["kind"]) {
  if (kind === "video") return contentType === "video/mp4";
  if (kind === "image") return new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]).has(contentType);
  return new Set(["font/woff2", "font/woff", "application/font-woff", "application/x-font-woff"]).has(contentType);
}

function extensionForContentType(contentType: string) {
  const extension = new Map([
    ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"], ["image/gif", ".gif"],
    ["image/avif", ".avif"], ["video/mp4", ".mp4"], ["font/woff2", ".woff2"], ["font/woff", ".woff"],
    ["application/font-woff", ".woff"], ["application/x-font-woff", ".woff"],
  ]).get(contentType);
  if (!extension) throw new StaticSiteContractError("STATIC_MEDIA_TYPE_UNSUPPORTED", "公开媒体类型不受支持");
  return extension;
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => [key, sortCanonical(item)]));
  }
  return value;
}
