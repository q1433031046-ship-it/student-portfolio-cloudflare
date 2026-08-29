from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    if old not in content:
        raise RuntimeError(f"missing replacement in {path}: {old[:180]!r}")
    write(path, content.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    content = read(path)
    count = content.count(old)
    if count < minimum:
        raise RuntimeError(f"expected at least {minimum} replacements in {path}, found {count}: {old[:180]!r}")
    write(path, content.replace(old, new))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    content = read(path)
    updated, count = re.subn(pattern, lambda _match: replacement, content, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one regex replacement in {path}, found {count}: {pattern[:180]!r}")
    write(path, updated)


def append_once(path: str, marker: str, addition: str) -> None:
    content = read(path)
    if marker in content:
        return
    write(path, content.rstrip() + "\n\n" + addition.strip() + "\n")


model = "app/portfolio/model.ts"
replace_once(
    model,
    '''export type CoverTextStyle = {
  x: number;
  y: number;
  width: number;
  scale: number;
  align: TextAlign;
  color: "system" | `#${string}`;
  fontFamily: "system" | "custom";
};''',
    '''export type CoverTextStyle = {
  x: number;
  y: number;
  width: number;
  scale: number;
  align: TextAlign;
  color: "system" | `#${string}`;
  fontFamily: "system" | "custom";
};

export type BlockTextPresentation = {
  align: TextAlign;
  width: number;
  scale: number;
  color: "system" | `#${string}`;
  fontFamily: "system" | "custom";
};''',
)
replace_once(
    model,
    '''export type HeroSlide = {
  id: string;
  media: MediaAsset;
  contentMode: HeroContentMode;
  effect: HeroEffect;
  animationEnabled: boolean;
  layers: HeroLayer[];
};''',
    '''export type HeroSlide = {
  id: string;
  media: MediaAsset;
  contentMode: HeroContentMode;
  effect: HeroEffect;
  animationEnabled: boolean;
  layers: HeroLayer[];
};

export type EndCoverSlide = {
  id: string;
  media: MediaAsset;
  contentMode: HeroContentMode;
  effect: HeroEffect;
  animationEnabled: boolean;
  title: string;
  statement: string;
  details: string;
  layers: HeroLayer[];
};

export type EndCoverConfig = {
  enabled: boolean;
  slides: EndCoverSlide[];
};''',
)
replace_once(
    model,
    '''export type ProjectBlock =
  | { id: string; type: "text"; eyebrow: string; title: string; body: string }
  | { id: string; type: "media-text"; media: MediaAsset; side: "left" | "right"; eyebrow: string; title: string; body: string }
  | { id: string; type: "gallery"; eyebrow: string; title: string; orientation: GalleryOrientation; items: MediaAsset[] }
  | { id: string; type: "full-media"; media: MediaAsset; caption: string };''',
    '''export type ProjectBlock =
  | { id: string; type: "text"; eyebrow: string; title: string; body: string; presentation: BlockTextPresentation }
  | { id: string; type: "media-text"; media: MediaAsset; side: "left" | "right"; eyebrow: string; title: string; body: string; presentation: BlockTextPresentation }
  | { id: string; type: "gallery"; eyebrow: string; title: string; orientation: GalleryOrientation; items: MediaAsset[]; presentation: BlockTextPresentation }
  | { id: string; type: "full-media"; media: MediaAsset; caption: string; presentation: BlockTextPresentation };''',
)
replace_once(model, "  schemaVersion: 4;", "  schemaVersion: 5;")
replace_once(
    model,
    '''  hero: HeroConfig;
  themes: ThemeConfig[];''',
    '''  hero: HeroConfig;
  endCovers: EndCoverConfig;
  themes: ThemeConfig[];''',
)

replace_once(
    model,
    '''export function createDefaultMediaPosition(): MediaPosition {
  return { x: 50, y: 50 };
}''',
    '''export function createDefaultBlockTextPresentation(): BlockTextPresentation {
  return { align: "left", width: 100, scale: 1, color: "system", fontFamily: "system" };
}

export function createDefaultEndCoverSlide(id = "end-cover-1"): EndCoverSlide {
  return {
    id,
    media: { id: `${id}-media`, label: "", alt: "封底图片", kind: "image", visualKey: "frame" },
    contentMode: "image-only",
    effect: "halo",
    animationEnabled: false,
    title: "",
    statement: "",
    details: "",
    layers: createDefaultHeroLayers().map((layer) => ({ ...layer })),
  };
}

export function createDefaultEndCoverConfig(): EndCoverConfig {
  return { enabled: false, slides: [] };
}

export function createDefaultMediaPosition(): MediaPosition {
  return { x: 50, y: 50 };
}''',
)

replace_once(
    model,
    '''  let candidate = normalizePortfolioInput(input);
  if (candidate.schemaVersion === 4) candidate = normalizeSchemaFourPresentation(candidate);
  if (candidate.schemaVersion !== 4) errors.push("schemaVersion 必须为 4");''',
    '''  let candidate = normalizePortfolioInput(input);
  if (candidate.schemaVersion === 4 || candidate.schemaVersion === 5) candidate = normalizeSchemaFourPresentation(candidate);
  if (candidate.schemaVersion === 4 || candidate.schemaVersion === 5) candidate = normalizeSchemaFiveDocument(candidate);
  if (candidate.schemaVersion !== 5) errors.push("schemaVersion 必须为 5");''',
)
replace_once(
    model,
    '''  const hero = expectRecord(candidate.hero, "hero", errors);
  const themes = expectArray(candidate.themes, "themes", errors, 1, 8);''',
    '''  const hero = expectRecord(candidate.hero, "hero", errors);
  const endCovers = expectRecord(candidate.endCovers, "endCovers", errors);
  const themes = expectArray(candidate.themes, "themes", errors, 1, 8);''',
)
replace_once(
    model,
    '''  if (hero) validateHero(hero, errors);

  const themeIds = new Set<string>();''',
    '''  if (hero) validateHero(hero, errors);
  if (endCovers) validateEndCoverConfig(endCovers, errors);

  const themeIds = new Set<string>();''',
)

replace_once(
    model,
    '''  return { ...candidate, hero, categories, projects, settings, themes };
}

export function mediaAssetsInDocument''',
    '''  return { ...candidate, hero, categories, projects, settings, themes };
}

function normalizeSchemaFiveDocument(candidate: Record<string, unknown>): Record<string, unknown> {
  const projects = Array.isArray(candidate.projects)
    ? candidate.projects.map((project) => {
        if (!isRecord(project)) return project;
        const detailBlocks = Array.isArray(project.detailBlocks)
          ? project.detailBlocks.map((block) => isRecord(block)
            ? { ...block, presentation: normalizeBlockTextPresentation(block.presentation) }
            : block)
          : project.detailBlocks;
        return { ...project, detailBlocks };
      })
    : candidate.projects;
  return {
    ...candidate,
    schemaVersion: 5,
    projects,
    endCovers: normalizeEndCoverConfig(candidate.endCovers),
  };
}

function normalizeBlockTextPresentation(value: unknown): BlockTextPresentation {
  const fallback = createDefaultBlockTextPresentation();
  if (!isRecord(value)) return fallback;
  return {
    align: isStringIn(value.align, new Set<TextAlign>(["left", "center", "right"])) ? value.align : fallback.align,
    width: typeof value.width === "number" ? value.width : fallback.width,
    scale: typeof value.scale === "number" ? value.scale : fallback.scale,
    color: value.color === "system" || isColor(value.color) ? value.color as BlockTextPresentation["color"] : fallback.color,
    fontFamily: value.fontFamily === "custom" || value.fontFamily === "system" ? value.fontFamily : fallback.fontFamily,
  };
}

function normalizeEndCoverConfig(value: unknown): EndCoverConfig {
  if (!isRecord(value)) return createDefaultEndCoverConfig();
  const slides = Array.isArray(value.slides)
    ? value.slides.map((slide, index) => {
        const fallback = createDefaultEndCoverSlide(`end-cover-${index + 1}`);
        if (!isRecord(slide)) return fallback;
        const layers = Array.isArray(slide.layers)
          ? slide.layers.map((layer, layerIndex) => {
              const layerFallback = fallback.layers[layerIndex] ?? fallback.layers[0];
              if (!isRecord(layer)) return { ...layerFallback };
              return {
                ...layerFallback,
                ...layer,
                color: layer.color === "system" || isColor(layer.color) ? layer.color : layerFallback.color,
                fontFamily: layer.fontFamily === "custom" || layer.fontFamily === "system" ? layer.fontFamily : layerFallback.fontFamily,
              } as HeroLayer;
            })
          : fallback.layers;
        return {
          id: typeof slide.id === "string" ? slide.id : fallback.id,
          media: normalizeAsset(slide.media) as MediaAsset,
          contentMode: isStringIn(slide.contentMode, HERO_CONTENT_MODES) ? slide.contentMode : fallback.contentMode,
          effect: isStringIn(slide.effect, HERO_EFFECTS) ? slide.effect : fallback.effect,
          animationEnabled: typeof slide.animationEnabled === "boolean" ? slide.animationEnabled : fallback.animationEnabled,
          title: typeof slide.title === "string" ? slide.title : "",
          statement: typeof slide.statement === "string" ? slide.statement : "",
          details: typeof slide.details === "string" ? slide.details : "",
          layers,
        };
      })
    : [];
  return { enabled: typeof value.enabled === "boolean" ? value.enabled : slides.length > 0, slides };
}

export function mediaAssetsInDocument''',
)

replace_once(
    model,
    '''    ...document.hero.slides.map((slide) => slide.media),
    ...document.categories.map((category) => category.transition.media),''',
    '''    ...document.hero.slides.map((slide) => slide.media),
    ...document.endCovers.slides.map((slide) => slide.media),
    ...document.categories.map((category) => category.transition.media),''',
)
replace_once(
    model,
    '''    settings: {
      ...document.settings,
      customFont: publicAsset(document.settings.customFont),
      contact: { ...document.settings.contact, image: publicAsset(document.settings.contact.image) },
    },
    themes:''',
    '''    settings: {
      ...document.settings,
      customFont: publicAsset(document.settings.customFont),
      contact: { ...document.settings.contact, image: publicAsset(document.settings.contact.image) },
    },
    endCovers: {
      ...document.endCovers,
      slides: document.endCovers.slides.map((slide) => ({
        ...slide,
        media: publicAsset(slide.media),
        layers: slide.layers.map((layer) => ({ ...layer })),
      })),
    },
    themes:''',
)
replace_once(
    model,
    '): { project: Project | null; asset: MediaAsset; role: "font" | "contact" | "hero" | "transition" | "cover" | "final" | "detail" } | null {',
    '): { project: Project | null; asset: MediaAsset; role: "font" | "contact" | "hero" | "end-cover" | "transition" | "cover" | "final" | "detail" } | null {',
)
replace_once(
    model,
    '''  const heroAsset = document.hero.slides.find((slide) => slide.media.key === key)?.media;
  if (heroAsset) return { project: null, asset: heroAsset, role: "hero" };
  const transitionAsset''',
    '''  const heroAsset = document.hero.slides.find((slide) => slide.media.key === key)?.media;
  if (heroAsset) return { project: null, asset: heroAsset, role: "hero" };
  const endCoverAsset = document.endCovers.slides.find((slide) => slide.media.key === key)?.media;
  if (endCoverAsset) return { project: null, asset: endCoverAsset, role: "end-cover" };
  const transitionAsset''',
)

replace_once(
    model,
    '''function validateTheme(value: unknown, index: number, ids: Set<string>, errors: string[]) {''',
    '''function validateEndCoverConfig(value: Record<string, unknown>, errors: string[]) {
  if (typeof value.enabled !== "boolean") errors.push("endCovers.enabled 必须为布尔值");
  const slides = expectArray(value.slides, "endCovers.slides", errors, 0, 12);
  const ids = new Set<string>();
  const mediaIds = new Set<string>();
  slides?.forEach((item, index) => {
    const path = `endCovers.slides[${index}]`;
    const slide = expectRecord(item, path, errors);
    if (!slide) return;
    validateId(slide.id, `${path}.id`, ids, errors);
    validateMedia(slide.media, `${path}.media`, "image", mediaIds, errors);
    if (!isStringIn(slide.contentMode, HERO_CONTENT_MODES)) errors.push(`${path}.contentMode 无效`);
    if (!isStringIn(slide.effect, HERO_EFFECTS)) errors.push(`${path}.effect 无效`);
    if (typeof slide.animationEnabled !== "boolean") errors.push(`${path}.animationEnabled 必须为布尔值`);
    validateText(slide.title, `${path}.title`, 0, 160, errors);
    validateText(slide.statement, `${path}.statement`, 0, 1000, errors);
    validateText(slide.details, `${path}.details`, 0, 1600, errors);
    const layers = expectArray(slide.layers, `${path}.layers`, errors, 3, 3);
    const layerIds = new Set<string>();
    layers?.forEach((layer, layerIndex) => validateHeroLayer(layer, `${path}.layers[${layerIndex}]`, layerIds, errors));
  });
}

function validateTheme(value: unknown, index: number, ids: Set<string>, errors: string[]) {''',
)
replace_once(
    model,
    '''  if (typeof block.type !== "string" || !BLOCK_TYPES.has(block.type)) {
    errors.push(`${path}.type 无效`);
    return;
  }
  if (block.type === "text") {''',
    '''  if (typeof block.type !== "string" || !BLOCK_TYPES.has(block.type)) {
    errors.push(`${path}.type 无效`);
    return;
  }
  validateBlockTextPresentation(block.presentation, `${path}.presentation`, errors);
  if (block.type === "text") {''',
)
replace_once(
    model,
    '''function validateMedia(value: unknown, path: string, kind: "image" | "video" | "font", ids: Set<string>, errors: string[]) {''',
    '''function validateBlockTextPresentation(value: unknown, path: string, errors: string[]) {
  const presentation = expectRecord(value, path, errors);
  if (!presentation) return;
  if (!isStringIn(presentation.align, new Set<TextAlign>(["left", "center", "right"]))) errors.push(`${path}.align 无效`);
  validateNumber(presentation.width, `${path}.width`, 30, 100, errors);
  validateNumber(presentation.scale, `${path}.scale`, 0.6, 2.5, errors);
  if (presentation.color !== "system" && !isColor(presentation.color)) errors.push(`${path}.color 无效`);
  if (presentation.fontFamily !== "system" && presentation.fontFamily !== "custom") errors.push(`${path}.fontFamily 无效`);
}

function validateMedia(value: unknown, path: string, kind: "image" | "video" | "font", ids: Set<string>, errors: string[]) {''',
)

# Default document now emits schema five and presentation defaults.
default_document = "app/portfolio/default-document.ts"
replace_once(
    default_document,
    'import { createDefaultContactConfig, createDefaultCoverPresentation, type MediaAsset, type PortfolioDocument, type ProjectBlock } from "./model";',
    'import { createDefaultBlockTextPresentation, createDefaultContactConfig, createDefaultCoverPresentation, createDefaultEndCoverConfig, type MediaAsset, type PortfolioDocument, type ProjectBlock } from "./model";',
)
regex_once(
    default_document,
    r'function block\(value: \(typeof portfolioDemo\.projects\)\[number\]\["detailBlocks"\]\[number\]\): ProjectBlock \{.*?\n}',
    '''function block(value: (typeof portfolioDemo.projects)[number]["detailBlocks"][number]): ProjectBlock {
  const presentation = createDefaultBlockTextPresentation();
  if (value.type === "media-text") return { ...value, media: media(value.media, "image"), presentation };
  if (value.type === "gallery") return { ...value, orientation: "portrait", items: value.items.slice(0, 4).map((item) => media(item, "image")), presentation };
  if (value.type === "full-media") return { ...value, media: media(value.media, "image"), presentation };
  return { ...value, presentation };
}''',
)
replace_once(default_document, "    schemaVersion: 4,", "    schemaVersion: 5,")
replace_once(
    default_document,
    '''    themes: portfolioDemo.themes.map((theme) => ({ ...theme })),''',
    '''    endCovers: createDefaultEndCoverConfig(),
    themes: portfolioDemo.themes.map((theme) => ({ ...theme })),''',
)

# Public end-cover renderer.
write("app/portfolio/end-cover-sequence.tsx", '''"use client";

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
''')

portfolio = "app/portfolio/portfolio-experience.tsx"
replace_once(
    portfolio,
    'import { HeroSequence } from "./hero-sequence";',
    'import { HeroSequence } from "./hero-sequence";\nimport { EndCoverSequence } from "./end-cover-sequence";',
)
replace_once(
    portfolio,
    '''      <footer className={styles.footer} hidden={!entered}>''',
    '''      <EndCoverSequence config={portfolio.endCovers} entered={entered} />

      <footer className={styles.footer} hidden={!entered}>''',
)
replace_once(
    portfolio,
    '''function ProjectContentBlock({ block }: { block: ProjectBlock }) {
  switch (block.type) {''',
    '''function ProjectContentBlock({ block }: { block: ProjectBlock }) {
  const presentation = blockPresentationStyle(block.presentation);
  switch (block.type) {''',
)
replace_once(
    portfolio,
    '<section className={styles.textBlock} aria-labelledby={`${block.id}-title`}>',
    '<section className={styles.textBlock} aria-labelledby={`${block.id}-title`} style={presentation}>',
)
replace_once(
    portfolio,
    '''          {hasCopy && <div className={styles.blockCopy}>''',
    '''          {hasCopy && <div className={styles.blockCopy} style={presentation}>''',
)
replace_once(
    portfolio,
    '''          {(block.eyebrow.trim() || block.title.trim()) && <header>''',
    '''          {(block.eyebrow.trim() || block.title.trim()) && <header style={presentation}>''',
)
replace_once(
    portfolio,
    '''          {block.caption.trim() && <p>{block.caption}</p>}''',
    '''          {block.caption.trim() && <p style={presentation}>{block.caption}</p>}''',
)
replace_once(
    portfolio,
    '''function ProjectDetails({ project }: { project: Project }) {''',
    '''function blockPresentationStyle(presentation: ProjectBlock["presentation"]): React.CSSProperties {
  return {
    maxWidth: `${presentation.width}%`,
    marginLeft: presentation.align === "left" ? undefined : "auto",
    marginRight: presentation.align === "right" ? undefined : "auto",
    textAlign: presentation.align,
    fontSize: `${presentation.scale}em`,
    color: presentation.color === "system" ? undefined : presentation.color,
    fontFamily: presentation.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined,
  };
}

function ProjectDetails({ project }: { project: Project }) {''',
)

# End-cover styling and block presentation behavior.
portfolio_css = "app/demo/portfolio-demo.module.css"
append_once(
    portfolio_css,
    '/* end-cover sequence and authored block presentation */',
    '''/* end-cover sequence and authored block presentation */
.endCoverSequence { border-top: 1px solid var(--line); }
.endCoverSlide { min-height: min(100svh, 960px); }
.endCoverSlide .heroLayer[data-kind="identity"] h2 {
  margin: 0;
  font-size: clamp(64px, 10cqw, 170px);
  font-weight: 520;
  line-height: .82;
  letter-spacing: -.085em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.endCoverSlide .heroLayer[data-kind="facts"] > p {
  margin: 0;
  padding-top: 14px;
  border-top: 1px solid var(--line-strong);
  color: var(--muted);
  font-size: clamp(10px, 1cqw, 16px);
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.endCoverIndex { position: absolute; z-index: 8; right: 28px; bottom: 24px; color: var(--muted); font-size: 9px; letter-spacing: .16em; }
.textBlock,
.blockCopy,
.galleryBlock > header,
.fullMediaBlock > p { transition: max-width 180ms ease, font-size 180ms ease; }
''',
)

# Upload endpoint accepts independent end-cover images.
upload = "app/api/admin/media/[projectId]/[slot]/route.ts"
replace_once(
    upload,
    'const SLOTS = new Set(["hero", "transition", "cover", "final", "detail", "font", "contact"]);',
    'const SLOTS = new Set(["hero", "transition", "cover", "final", "detail", "font", "contact", "end-cover"]);',
)
replace_all(
    upload,
    'const objectScope = slot === "transition" ? `categories/${projectId}` : projectId;',
    'const objectScope = slot === "transition" ? `categories/${projectId}` : slot === "end-cover" ? `end-covers/${projectId}` : projectId;',
    minimum=2,
)
replace_once(
    upload,
    '''  if (slot === "transition" && !access.record.draft.categories.some((category) => category.id === projectId)) {
    return Response.json({ error: "分类不存在，请先保存分类资料" }, { status: 404 });
  }
  if (!["hero", "font", "contact", "transition"].includes(slot)
    && !access.record.draft.projects.some((project) => project.id === projectId)) {''',
    '''  if (slot === "transition" && !access.record.draft.categories.some((category) => category.id === projectId)) {
    return Response.json({ error: "分类不存在，请先保存分类资料" }, { status: 404 });
  }
  if (slot === "end-cover" && !access.record.draft.endCovers.slides.some((slide) => slide.id === projectId)) {
    return Response.json({ error: "封底不存在，请先保存封底资料" }, { status: 404 });
  }
  if (!["hero", "font", "contact", "transition", "end-cover"].includes(slot)
    && !access.record.draft.projects.some((project) => project.id === projectId)) {''',
)

print("schema five, block presentation, and end-cover core applied")
