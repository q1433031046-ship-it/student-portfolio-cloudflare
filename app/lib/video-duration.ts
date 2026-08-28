export function formatVideoDuration(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? seconds : 0;
  const rounded = Math.min(999 * 60 + 59, Math.max(0, Math.round(safeSeconds)));
  const minutes = Math.min(999, Math.floor(rounded / 60));
  const remainder = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
