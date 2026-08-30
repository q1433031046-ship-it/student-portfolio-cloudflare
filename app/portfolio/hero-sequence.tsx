"use client";

import type { HeroConfig, HeroSlide } from "./model";
import { trimVisibleText } from "../lib/text-visibility";
import { heroLayerStyle } from "./hero-layer-style";
import { hasHeroLayerContent } from "./hero-layer-content";
import { croppedImageStyle, mediaCropAspect } from "./media-crop";
import styles from "../demo/portfolio-demo.module.css";

export function HeroSequence({
  hero,
  entered,
  onEnter,
  onExit,
  onContact,
  contactAvailable,
  yearRange,
  projectCount,
}: {
  hero: HeroConfig;
  entered: boolean;
  onEnter: () => void;
  onExit: () => void;
  onContact: () => void;
  contactAvailable: boolean;
  yearRange: string;
  projectCount: number;
}) {
  const monogram = Array.from(hero.name.trim()).slice(0, 2).join("") || "PF";
  const email = trimVisibleText(hero.email);
  const phone = trimVisibleText(hero.phone);
  const availability = trimVisibleText(hero.availability);
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
          {contactAvailable && <button className={styles.contactAction} type="button" onClick={onContact}>
            <span>联系</span><strong>{email || phone || "查看联系方式"}</strong>
          </button>}
        </nav>
        {availability && <span>{availability}</span>}
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
  const statement = trimVisibleText(hero.statement);
  const role = trimVisibleText(hero.role);
  const targetRole = trimVisibleText(hero.targetRole);
  const email = trimVisibleText(hero.email);
  const phone = trimVisibleText(hero.phone);
  return (
    <div className={styles.heroLayers}>
      {slide.layers.filter((layer) => layer.visible && hasHeroLayerContent(layer.kind, hero)).map((layer) => (
        <section
          key={layer.id}
          className={styles.heroLayer}
          data-kind={layer.kind}
          style={heroLayerStyle(layer)}
        >
          {layer.kind === "identity" && <><p>PORTFOLIO · {yearRange}</p><h1>{hero.name}</h1></>}
          {layer.kind === "statement" && statement && <p>{statement}</p>}
          {layer.kind === "facts" && (
            <dl>
              {role && <div><dt>身份</dt><dd>{role}</dd></div>}
              {targetRole && <div><dt>方向</dt><dd>{targetRole}</dd></div>}
              {email && <div><dt>邮箱</dt><dd><a href={`mailto:${email}`}>{email}</a></dd></div>}
              {phone && <div><dt>电话</dt><dd><a href={`tel:${phoneHref(phone)}`}>{phone}</a></dd></div>}
            </dl>
          )}
        </section>
      ))}
    </div>
  );
}

function phoneHref(phone: string) {
  return phone.replace(/[^\d+]/gu, "");
}
