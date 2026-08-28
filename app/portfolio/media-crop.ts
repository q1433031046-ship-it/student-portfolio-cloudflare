import type { CSSProperties } from "react";
import type { MediaAsset, MediaCrop } from "./model";

const MIN_CROP = 5;

export function fullMediaCrop(): MediaCrop {
  return { x: 0, y: 0, width: 100, height: 100 };
}

export function fitCropToAspect(sourceAspectRatio: number, targetAspectRatio: number): MediaCrop {
  const source = validAspect(sourceAspectRatio, 16 / 9);
  const target = validAspect(targetAspectRatio, 16 / 9);
  if (source > target) {
    const width = (target / source) * 100;
    return { x: (100 - width) / 2, y: 0, width, height: 100 };
  }
  const height = (source / target) * 100;
  return { x: 0, y: (100 - height) / 2, width: 100, height };
}

export function normalizeMediaCrop(crop: MediaCrop): MediaCrop {
  const width = clamp(crop.width, MIN_CROP, 100);
  const height = clamp(crop.height, MIN_CROP, 100);
  return {
    x: clamp(crop.x, 0, 100 - width),
    y: clamp(crop.y, 0, 100 - height),
    width,
    height,
  };
}

export function mediaCropAspect(asset: MediaAsset, fallback = 16 / 9) {
  if (!asset.crop || !asset.sourceAspectRatio) return fallback;
  return validAspect(asset.sourceAspectRatio * (asset.crop.width / asset.crop.height), fallback);
}

export function croppedImageStyle(asset: MediaAsset, fallbackFit: "cover" | "contain" = "cover"): CSSProperties {
  const crop = asset.crop;
  if (!crop || !asset.sourceAspectRatio) {
    return {
      objectFit: fallbackFit,
      objectPosition: `${asset.objectPosition?.x ?? 50}% ${asset.objectPosition?.y ?? 50}%`,
    };
  }
  const normalized = normalizeMediaCrop(crop);
  return {
    position: "absolute",
    left: `${(-normalized.x / normalized.width) * 100}%`,
    top: `${(-normalized.y / normalized.height) * 100}%`,
    width: `${(100 / normalized.width) * 100}%`,
    height: `${(100 / normalized.height) * 100}%`,
    maxWidth: "none",
    objectFit: "fill",
    objectPosition: "center",
  };
}

export function validAspect(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.1 && value <= 20 ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(max, value)) * 1000) / 1000;
}
