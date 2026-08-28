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

export function getBucket(): UploadBucket {
  const bucket = (env as unknown as { BUCKET?: UploadBucket }).BUCKET;
  if (!bucket) throw new Error("Object storage is unavailable");
  return bucket;
}
