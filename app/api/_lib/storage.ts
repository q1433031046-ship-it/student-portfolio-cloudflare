import { env } from "cloudflare:workers";

type StoredObject = {
  body: ReadableStream<Uint8Array>;
  size: number;
  httpEtag: string;
  range?: { offset: number; length: number };
  httpMetadata?: { contentType?: string };
};

export type UploadBucket = {
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  get(key: string, options?: { range?: Headers }): Promise<StoredObject | null>;
  delete(key: string | string[]): Promise<void>;
};

type StorageBindings = {
  BUCKET?: UploadBucket;
  MEDIA_KV?: KVNamespace;
};

export const MEDIA_STORAGE_LIMIT = 800 * 1024 * 1024;
export const MEDIA_STORAGE_WARNING = 700 * 1024 * 1024;
export const KV_UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
export const VIDEO_UPLOAD_LIMIT = 50 * 1024 * 1024;

export function getBucket(): UploadBucket {
  const bucket = (env as unknown as StorageBindings).BUCKET;
  if (!bucket) throw new Error("Object storage is unavailable");
  return bucket;
}

export function mediaStorageBackend(): "kv" | "r2" {
  const bindings = env as unknown as StorageBindings;
  if (bindings.MEDIA_KV) return "kv";
  if (bindings.BUCKET) return "r2";
  throw new Error("媒体存储不可用");
}

export function getMediaKv(): KVNamespace {
  const namespace = (env as unknown as StorageBindings).MEDIA_KV;
  if (!namespace) throw new Error("KV媒体存储不可用");
  return namespace;
}

export function kvChunkKey(objectKey: string, index: number) {
  return `${objectKey}::chunk:${String(index).padStart(4, "0")}`;
}

export async function deleteStoredMedia(input: {
  objectKey: string;
  storageBackend: "r2" | "kv";
  chunkCount: number;
}) {
  if (input.storageBackend === "r2") {
    await getBucket().delete(input.objectKey);
    return;
  }
  const namespace = getMediaKv();
  for (let index = 0; index < input.chunkCount; index += 1) {
    await namespace.delete(kvChunkKey(input.objectKey, index));
  }
}
