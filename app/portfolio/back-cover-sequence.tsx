"use client";

import type { CSSProperties } from "react";
import type { BackCoverConfig, BackCoverSlide, HeroLayer } from "./model";
import { croppedImageStyle, mediaCropAspect } from "./media-crop";
import styles from "../demo/portfolio-demo.module.css";

export function BackCoverSequence({ backCover, entered }: { backCover: BackCoverConfig; entered: boolean }) {
  if (!backCover.enabled || backCover.slides.length === 0) return null;
  return (
    <section className={styles.backCoverSequence} hidden={!entered} aria-label="作品集封底">
      {backCover.slides.map((slide, index) => (
        <section
          className={`${styles.heroSlide} ${styles.backCoverSlide}`}
          data-mode={slide.contentMode}
          data-effect={slide.effect}
          data-animation={slide.animationEnabled ? "on" : "off"}
          data-custom-media={Boolean(slide.media.src)}
          data-back-cover-index={index}
          key={slide.id}
          aria-label={`封底 ${index + 1}`}
          style={slide.media.crop && slide.media.sourceAspectRatio ? { aspectRatio: mediaCropAspect(slide.media), minHeight: "auto" } : undefined}
        >
          <BackCoverArtwork slide={slide} index={index} />
          {slide.contentMode !== "image-only" && <BackCoverLayers slide={slide} />}
          {backCover.slides.length > 1 && <span className={styles.heroSlideIndex}>{String(index + 1).padStart(2, "0")}</span>}
        </section>
      ))}
    </section>
  );
}

function BackCoverArtwork({ slide, index }: { slide: BackCoverSlide; index: number }) {
  return (
    <div className={styles.heroArtwork} aria-hidden="true">
      {slide.media.src
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={slide.media.src} alt="" loading="lazy" decoding="async" style={croppedImageStyle(slide.media, "contain")} />
        : <div className={styles.heroFallback} data-visual={slide.media.visualKey}><span /></div>}
      <span className={styles.heroHalo} />
      <span className={styles.heroScan} />
      <span className={styles.heroCoordinate}>END FRAME<br />{String(index + 1).padStart(2, "0")}</span>
    </div>
  );
}

function BackCoverLayers({ slide }: { slide: BackCoverSlide }) {
  return (
    <div className={`${styles.heroLayers} ${styles.backCoverLayers}`}>
      {slide.layers.filter((layer) => layer.visible).map((layer) => (
        <section
          key={layer.id}
          className={`${styles.heroLayer} ${styles.backCoverLayer}`}
          data-kind={layer.kind}
          style={layerStyle(layer)}
        >
          {layer.kind === "identity" && <><p>{slide.eyebrow}</p><h1>{slide.title}</h1></>}
          {layer.kind === "statement" && <p>{slide.statement}</p>}
          {layer.kind === "facts" && <p>{slide.details}</p>}
        </section>
      ))}
    </div>
  );
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
