"use client";

import { useEffect, useState } from "react";
import type { MediaAsset } from "../portfolio/model";

const previewByAsset = new Map<string, string>();
const previewOrder: string[] = [];
const listeners = new Set<() => void>();
const MAX_LOCAL_PREVIEWS = 32;

function assetKeys(asset: Pick<MediaAsset, "id" | "key">) {
  return [asset.key, asset.id].filter((value): value is string => Boolean(value));
}

function currentPreview(asset: Pick<MediaAsset, "id" | "key" | "src">) {
  for (const key of assetKeys(asset)) {
    const preview = previewByAsset.get(key);
    if (preview) return preview;
  }
  return asset.src;
}

function notify() {
  for (const listener of listeners) listener();
}

function removeUrl(url: string) {
  for (const [key, value] of previewByAsset.entries()) {
    if (value === url) previewByAsset.delete(key);
  }
  const index = previewOrder.indexOf(url);
  if (index >= 0) previewOrder.splice(index, 1);
  URL.revokeObjectURL(url);
}

export function rememberLocalMediaPreview(asset: Pick<MediaAsset, "id" | "key">, file: Blob) {
  const url = URL.createObjectURL(file);
  const replaced = new Set<string>();
  for (const key of assetKeys(asset)) {
    const previous = previewByAsset.get(key);
    if (previous && previous !== url) replaced.add(previous);
    previewByAsset.set(key, url);
  }
  for (const previous of replaced) removeUrl(previous);
  previewOrder.push(url);
  while (previewOrder.length > MAX_LOCAL_PREVIEWS) {
    const oldest = previewOrder[0];
    if (!oldest) break;
    removeUrl(oldest);
  }
  notify();
  return url;
}

export function useMediaPreview(asset: Pick<MediaAsset, "id" | "key" | "src">) {
  const [preview, setPreview] = useState(() => currentPreview(asset));

  useEffect(() => {
    const update = () => setPreview(currentPreview(asset));
    update();
    listeners.add(update);
    return () => listeners.delete(update);
  }, [asset.id, asset.key, asset.src]);

  return preview;
}
