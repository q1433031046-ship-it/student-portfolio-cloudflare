import styles from "../demo/portfolio-demo.module.css";
import type { PortfolioDocument } from "./model";

export function VideoWatermark({ text, moving, appearance }: { text: string; moving: boolean; appearance: PortfolioDocument["settings"]["videoWatermarkStyle"] }) {
  if (!text) return null;
  return (
    <span
      className={styles.videoWatermark}
      data-moving={moving ? "true" : "false"}
      aria-hidden="true"
      style={{
        color: appearance.color,
        fontSize: `${appearance.fontSize}px`,
        fontFamily: appearance.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined,
      }}
    >{text}</span>
  );
}
