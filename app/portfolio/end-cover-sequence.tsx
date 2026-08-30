"use client";

import type { CSSProperties, ReactNode } from "react";
import type { EndCoverConfig, EndCoverSlide, HeroLayer } from "./model";
import { croppedImageStyle, mediaCropAspect } from "./media-crop";
import styles from "../demo/portfolio-demo.module.css";

export function EndCoverSequence({ config, entered }: { config: EndCoverConfig; entered: boolean }) {
  if (!entered || !config.enabled || config.slides.length === 0) return null;
  return (
    <section className={styles.endCoverSequence} aria-label="作品集封底">
      {config.slides.map((slide, index) => (
        <section
          key={slide.id}
          className={`${styles.heroSlide} ${styles.endCoverSlide}`}
          data-mode={slide.contentMode}
          data-effect={slide.effect}
          data-animation={slide.animationEnabled ? "on" : "off"}
          data-custom-media={Boolean(slide.media.src)}
          data-end-cover-index={index}
          aria-label={`封底 ${index + 1}`}
          style={slide.media.crop && slide.media.sourceAspectRatio ? { aspectRatio: mediaCropAspect(slide.media), minHeight: "auto" } : undefined}
        >
          <div className={styles.heroArtwork} aria-hidden="true">
            {slide.media.src
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={slide.media.src} alt="" loading="lazy" decoding="async" style={croppedImageStyle(slide.media, "contain")} />
              : <div className={styles.heroFallback} data-visual={slide.media.visualKey}><span /></div>}
            <span className={styles.heroHalo} />
            <span className={styles.heroScan} />
          </div>
          {slide.contentMode !== "image-only" && <div className={styles.heroLayers}>
            {slide.layers.filter((layer) => layer.visible).map((layer) => {
              const content = layerContent(slide, layer);
              if (!content) return null;
              return <section key={layer.id} className={styles.heroLayer} data-kind={layer.kind} style={layerStyle(layer)}>{content}</section>;
            })}
          </div>}
          <span className={styles.endCoverIndex}>{String(index + 1).padStart(2, "0")} / END</span>
        </section>
      ))}
    </section>
  );
}

function layerContent(slide: EndCoverSlide, layer: HeroLayer): ReactNode {
  if (layer.kind === "identity") return slide.title.trim() ? <h2>{slide.title}</h2> : null;
  if (layer.kind === "statement") return slide.statement.trim() ? <p>{slide.statement}</p> : null;
  return slide.details.trim() ? <p>{slide.details}</p> : null;
}

function layerStyle(layer: HeroLayer): CSSProperties {
  return {
    "--layer-x": `${layer.x}%`,
    "--layer-y": `${layer.y}%`,
    "--layer-width": `${layer.width}%`,
    "--layer-scale": layer.scale,
    "--layer-z": layer.zIndex,
    "--layer-align": layer.align,
    color: layer.color === "system" ? undefined : layer.color,
    fontFamily: layer.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined,
  } as CSSProperties;
}
