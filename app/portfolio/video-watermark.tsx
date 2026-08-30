import styles from "../demo/portfolio-demo.module.css";
import type { PortfolioDocument } from "./model";
import type { CSSProperties } from "react";

export function VideoWatermark({ text, moving, appearance }: { text: string; moving: boolean; appearance: PortfolioDocument["settings"]["videoWatermarkStyle"] }) {
  if (!text) return null;
  return (
    <span
      className={styles.videoWatermark}
      data-moving={moving ? "true" : "false"}
      aria-hidden="true"
      style={{
        "--watermark-color": appearance.color,
        "--watermark-size": `${appearance.fontSize}px`,
        fontFamily: appearance.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined,
      } as CSSProperties}
    >{text}</span>
  );
}
