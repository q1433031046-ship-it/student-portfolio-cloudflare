export function resolveWatermarkText(configured: string, ownerName: string) {
  return (configured.trim() || ownerName.trim()).slice(0, 80);
}
