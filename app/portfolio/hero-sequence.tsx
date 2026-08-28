"use client";

import type { CSSProperties } from "react";
import type { HeroConfig, HeroLayer, HeroSlide } from "./model";
import { croppedImageStyle, mediaCropAspect } from "./media-crop";
import styles from "../demo/portfolio-demo.module.css";

export function HeroSequence({
  hero,
  entered,
  onEnter,
  onExit,
  onContact,
  yearRange,
  projectCount,
}: {
  hero: HeroConfig;
  entered: boolean;
  onEnter: () => void;
  onExit: () => void;
  onContact: () => void;
  yearRange: string;
  projectCount: number;
}) {
  const monogram = Array.from(hero.name.trim()).slice(0, 2).join("") || "PF";
  return (
    <>
      <header className={styles.siteHeader}>
        <div className={styles.headerIdentity}>
          <a
            className={styles.monogram}
            href="#top"
            aria-label="返回个人首图"
            onClick={(event) => {
              event.preventDefault();
              onExit();
            }}
          >{monogram}</a>
          <a className={styles.adminEntry} href="/admin" aria-label="进入作品集后台">管理</a>
        </div>
        <nav aria-label="页面导航">
          <a href="#works" onClick={(event) => { if (!entered) { event.preventDefault(); onEnter(); } }}>作品</a>
          <button className={styles.contactAction} type="button" onClick={onContact}>
            <span>联系</span><strong>{hero.email}</strong>
          </button>
        </nav>
        <span>{hero.availability}</span>
      </header>
      <div className={styles.heroSequence} data-entered={entered}>
        {hero.slides.map((slide, index) => (
          <section
            className={styles.heroSlide}
            data-mode={slide.contentMode}
            data-effect={slide.effect}
            data-animation={slide.animationEnabled ? "on" : "off"}
            data-custom-media={Boolean(slide.media.src)}
            data-hero-slide-index={index}
            data-enter-target={index === hero.slides.length - 1 && !entered}
            key={slide.id}
            aria-label={`首图 ${index + 1}`}
            style={slide.media.crop && slide.media.sourceAspectRatio ? { aspectRatio: mediaCropAspect(slide.media), minHeight: "auto" } : undefined}
            onClick={(event) => {
              if (entered || index !== hero.slides.length - 1) return;
              if ((event.target as HTMLElement).closest("a, button")) return;
              onEnter();
            }}
          >
          <HeroArtwork slide={slide} projectCount={projectCount} yearRange={yearRange} />
          {slide.contentMode !== "image-only" && <HeroLayers hero={hero} slide={slide} yearRange={yearRange} />}

          {index === hero.slides.length - 1 && !entered && (
            <button className={styles.heroEnter} type="button" aria-controls="works" aria-expanded={entered} onClick={onEnter}>
              <span>点击展开作品</span><i aria-hidden="true">↓</i>
            </button>
          )}
          {index > 0 && <span className={styles.heroSlideIndex}>{String(index + 1).padStart(2, "0")}</span>}
          </section>
        ))}
      </div>
    </>
  );
}

function HeroArtwork({ slide, projectCount, yearRange }: { slide: HeroSlide; projectCount: number; yearRange: string }) {
  return (
    <div className={styles.heroArtwork} aria-hidden="true">
      {slide.media.src
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={slide.media.src} alt="" decoding="async" fetchPriority="high" style={croppedImageStyle(slide.media, "contain")} />
        : <div className={styles.heroFallback} data-visual={slide.media.visualKey}><span /></div>}
      <span className={styles.heroHalo} />
      <span className={styles.heroScan} />
      <span className={styles.heroCoordinate}>{String(projectCount).padStart(2, "0")} WORKS<br />{yearRange}</span>
    </div>
  );
}

function HeroLayers({ hero, slide, yearRange }: { hero: HeroConfig; slide: HeroSlide; yearRange: string }) {
  return (
    <div className={styles.heroLayers}>
      {slide.layers.filter((layer) => layer.visible).map((layer) => (
        <section
          key={layer.id}
          className={styles.heroLayer}
          data-kind={layer.kind}
          style={layerStyle(layer)}
        >
          {layer.kind === "identity" && <><p>PORTFOLIO · {yearRange}</p><h1>{hero.name}</h1></>}
          {layer.kind === "statement" && <p>{hero.statement}</p>}
          {layer.kind === "facts" && (
            <dl>
              <div><dt>身份</dt><dd>{hero.role}</dd></div>
              <div><dt>方向</dt><dd>{hero.targetRole}</dd></div>
              <div><dt>邮箱</dt><dd><a href={`mailto:${hero.email}`}>{hero.email}</a></dd></div>
              {hero.phone && <div><dt>电话</dt><dd><a href={`tel:${phoneHref(hero.phone)}`}>{hero.phone}</a></dd></div>}
            </dl>
          )}
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

function phoneHref(phone: string) {
  return phone.replace(/[^\d+]/gu, "");
}
