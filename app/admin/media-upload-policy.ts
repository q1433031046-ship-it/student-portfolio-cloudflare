export function replacementKeyForUpload(assetKey: string | undefined, persistedAsset: boolean) {
  return persistedAsset && assetKey ? assetKey : null;
}
