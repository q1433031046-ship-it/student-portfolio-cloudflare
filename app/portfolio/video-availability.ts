import type { MediaAsset } from "./model";

type VideoAvailability = Pick<MediaAsset, "key" | "src" | "label"> & { available?: boolean };

export function hasPlayableVideo(asset: VideoAvailability) {
  return asset.available === true || Boolean(asset.key || asset.src);
}

export function adminDraftVideoSource(asset: VideoAvailability) {
  if (asset.src) return asset.src;
  return asset.key ? `/api/media/${asset.key}` : undefined;
}

export function optionalVideoReset(finalVideo: MediaAsset) {
  return { finalVideo, duration: "00:00" as const };
}
