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
        raise RuntimeError(f"missing replacement in {path}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    content = read(path)
    count = content.count(old)
    if count < minimum:
        raise RuntimeError(f"expected at least {minimum} replacements in {path}, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    content = read(path)
    updated, count = re.subn(pattern, replacement, content, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one regex replacement in {path}, found {count}: {pattern[:120]!r}")
    write(path, updated)


def append_once(path: str, marker: str, addition: str) -> None:
    content = read(path)
    if marker in content:
        return
    write(path, content.rstrip() + "\n\n" + addition.strip() + "\n")


# 1. Display fields may be empty. Security and structural fields remain strict.
model = "app/portfolio/model.ts"
replacements = {
    'siteTitle: typeof candidate.settings.siteTitle === "string" ? candidate.settings.siteTitle : "学生作品展示",':
        'siteTitle: typeof candidate.settings.siteTitle === "string" && candidate.settings.siteTitle.trim() ? candidate.settings.siteTitle : "学生作品展示",',
    'validateText(workHeading.lead, "settings.workHeading.lead", 1, 100, errors);':
        'validateText(workHeading.lead, "settings.workHeading.lead", 0, 100, errors);',
    'validateText(workHeading.accent, "settings.workHeading.accent", 1, 100, errors);':
        'validateText(workHeading.accent, "settings.workHeading.accent", 0, 100, errors);',
    'validateText(contact.title, "settings.contact.title", 1, 100, errors);':
        'validateText(contact.title, "settings.contact.title", 0, 100, errors);',
    'validateText(hero.name, "hero.name", 1, 60, errors);':
        'validateText(hero.name, "hero.name", 0, 60, errors);',
    'validateText(hero.role, "hero.role", 1, 80, errors);':
        'validateText(hero.role, "hero.role", 0, 80, errors);',
    'validateText(hero.targetRole, "hero.targetRole", 1, 120, errors);':
        'validateText(hero.targetRole, "hero.targetRole", 0, 120, errors);',
    'validateText(hero.email, "hero.email", 3, 160, errors);':
        'validateText(hero.email, "hero.email", 0, 160, errors);',
    'if (typeof hero.email !== "string" || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/u.test(hero.email)) errors.push("hero.email 格式无效");':
        'if (typeof hero.email !== "string" || (hero.email.length > 0 && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/u.test(hero.email))) errors.push("hero.email 格式无效");',
    'validateText(hero.statement, "hero.statement", 1, 260, errors);':
        'validateText(hero.statement, "hero.statement", 0, 260, errors);',
    'validateText(category.label, `categories[${index}].label`, 1, 40, errors);':
        'validateText(category.label, `categories[${index}].label`, 0, 40, errors);',
    'validateText(project.title, `projects[${index}].title`, 1, 100, errors);':
        'validateText(project.title, `projects[${index}].title`, 0, 100, errors);',
    'if (typeof project.year !== "string" || !/^20\\d{2}$/.test(project.year)) errors.push(`projects[${index}].year 无效`);':
        'if (typeof project.year !== "string" || (project.year.length > 0 && !/^20\\d{2}$/.test(project.year))) errors.push(`projects[${index}].year 无效`);',
    'validateText(project.synopsis, `projects[${index}].synopsis`, 1, 1200, errors);':
        'validateText(project.synopsis, `projects[${index}].synopsis`, 0, 1200, errors);',
    'validateText(block.title, `${path}.title`, 1, 120, errors);':
        'validateText(block.title, `${path}.title`, 0, 120, errors);',
    'validateText(block.body, `${path}.body`, 1, 4000, errors);':
        'validateText(block.body, `${path}.body`, 0, 4000, errors);',
}
for old, new in replacements.items():
    replace_all(model, old, new)

# 2. Frontend project cover: empty values render nothing, line breaks are preserved by shared CSS.
write("app/portfolio/project-cover.tsx", '''import type { CSSProperties } from "react";
import { createDefaultCoverPresentation, type CategoryConfig, type CoverTextStyle, type Project } from "./model";
import { croppedImageStyle, mediaCropAspect } from "./media-crop";
import styles from "../demo/portfolio-demo.module.css";

export function ProjectCover({
  project,
  category,
  isOpen,
  onToggle,
  onPlay,
}: {
  project: Project;
  category: CategoryConfig;
  isOpen: boolean;
  onToggle: () => void;
  onPlay: (trigger: HTMLButtonElement) => void;
}) {
  const detailId = `${project.id}-details`;
  const presentation = project.coverPresentation;
  const defaults = createDefaultCoverPresentation();
  const titleStyle = presentation.titleStyle ?? defaults.titleStyle;
  const synopsisStyle = presentation.synopsisStyle ?? defaults.synopsisStyle;
  const factsStyle = presentation.factsStyle ?? defaults.factsStyle;
  const title = project.title.trim();
  const categoryLabel = category.label.trim();
  const synopsis = project.synopsis.trim();
  const challenge = project.challenge.trim();
  const solution = project.solution.trim();
  const duration = project.duration !== "00:00" ? project.duration : "";
  const yearDuration = [project.year.trim(), duration].filter(Boolean).join(" · ");
  const accessibleTitle = title || "未命名作品";
  const showTitle = presentation.showTitle && Boolean(title || categoryLabel);
  const showSynopsis = presentation.showSynopsis && Boolean(synopsis);
  const showFacts = presentation.showFacts && Boolean(yearDuration || challenge || solution);

  return (
    <div className={styles.projectCover} data-cover-overlay={presentation.overlayMode} style={{ aspectRatio: mediaCropAspect(project.cover, 16 / 9) }}>
      <ProjectArtwork project={project} />
      <button
        className={styles.coverToggle}
        type="button"
        aria-label={`${isOpen ? "收起" : "展开"}《${accessibleTitle}》项目详情`}
        aria-expanded={isOpen}
        aria-controls={detailId}
        onClick={onToggle}
      />
      <div className={styles.projectCoverInfo}>
        {showTitle && <div className={styles.projectTitleGroup} style={coverTextStyle(titleStyle)}>
          {categoryLabel && <span>{categoryLabel}</span>}
          {title && <h2>{title}</h2>}
        </div>}
        {showSynopsis && <div className={styles.projectSynopsis} style={coverTextStyle(synopsisStyle)}>
          <span>项目介绍</span>
          <p>{synopsis}</p>
        </div>}
        {showFacts && <dl className={styles.projectFacts} style={coverTextStyle(factsStyle)}>
          {yearDuration && <div><dt>年份 / 时长</dt><dd>{yearDuration}</dd></div>}
          {challenge && <div><dt>项目难点</dt><dd>{challenge}</dd></div>}
          {solution && <div><dt>解决思路</dt><dd>{solution}</dd></div>}
        </dl>}
        <button
          className={styles.projectPlay}
          type="button"
          data-playback-trigger={`${project.id}:final`}
          aria-label={`播放《${accessibleTitle}》视频`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onPlay(event.currentTarget); }}
        >
          <span aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5V7Z" fill="currentColor" /></svg>
          </span>
          <strong>播放视频</strong>
          <i aria-hidden="true">↗</i>
        </button>
      </div>
    </div>
  );
}

function ProjectArtwork({ project }: { project: Project }) {
  if (project.cover.src) {
    return (
      <figure className={styles.projectArtwork}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={project.cover.src} alt={project.cover.alt} style={croppedImageStyle(project.cover)} />
      </figure>
    );
  }
  return <figure className={styles.projectArtwork} data-visual={project.cover.visualKey}><span /></figure>;
}

function coverTextStyle(style: CoverTextStyle): CSSProperties {
  return {
    "--cover-x": `${style.x}%`,
    "--cover-y": `${style.y}%`,
    "--cover-width": `${style.width}%`,
    "--cover-scale": style.scale,
    textAlign: style.align,
    color: style.color === "system" ? undefined : style.color,
    fontFamily: style.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined,
  } as CSSProperties;
}
''')

# 3. Frontend hero: hide empty layers and empty contact/status controls.
write("app/portfolio/hero-sequence.tsx", '''"use client";

import type { CSSProperties, ReactNode } from "react";
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
  const contactValue = hero.email.trim() || hero.phone.trim();
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
          {contactValue && <button className={styles.contactAction} type="button" onClick={onContact}>
            <span>联系</span><strong>{contactValue}</strong>
          </button>}
        </nav>
        {hero.availability.trim() && <span>{hero.availability}</span>}
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
      <span className={styles.heroCoordinate}>{String(projectCount).padStart(2, "0")} WORKS{yearRange ? <><br />{yearRange}</> : null}</span>
    </div>
  );
}

function HeroLayers({ hero, slide, yearRange }: { hero: HeroConfig; slide: HeroSlide; yearRange: string }) {
  return (
    <div className={styles.heroLayers}>
      {slide.layers.filter((layer) => layer.visible).map((layer) => {
        const content = heroLayerContent(hero, layer, yearRange);
        if (!content) return null;
        return (
          <section
            key={layer.id}
            className={styles.heroLayer}
            data-kind={layer.kind}
            style={layerStyle(layer)}
          >{content}</section>
        );
      })}
    </div>
  );
}

function heroLayerContent(hero: HeroConfig, layer: HeroLayer, yearRange: string): ReactNode {
  if (layer.kind === "identity") {
    if (!hero.name.trim()) return null;
    return <><p>PORTFOLIO{yearRange ? ` · ${yearRange}` : ""}</p><h1>{hero.name}</h1></>;
  }
  if (layer.kind === "statement") return hero.statement.trim() ? <p>{hero.statement}</p> : null;
  const facts = [
    hero.role.trim() ? <div key="role"><dt>身份</dt><dd>{hero.role}</dd></div> : null,
    hero.targetRole.trim() ? <div key="target"><dt>方向</dt><dd>{hero.targetRole}</dd></div> : null,
    hero.email.trim() ? <div key="email"><dt>邮箱</dt><dd><a href={`mailto:${hero.email}`}>{hero.email}</a></dd></div> : null,
    hero.phone.trim() ? <div key="phone"><dt>电话</dt><dd><a href={`tel:${phoneHref(hero.phone)}`}>{hero.phone}</a></dd></div> : null,
  ].filter(Boolean);
  return facts.length ? <dl>{facts}</dl> : null;
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
  return phone.replace(/[^\\d+]/gu, "");
}
''')

# 4. Portfolio output: empty display content is omitted and manual newlines remain meaningful.
portfolio = "app/portfolio/portfolio-experience.tsx"
regex_once(portfolio, r'function ContactDialog\(.*?\n}\n\nfunction contactTextStyle', '''function ContactDialog({ hero, contact, onClose }: { hero: PortfolioDocument["hero"]; contact: PortfolioDocument["settings"]["contact"]; onClose: () => void }) {
  const email = hero.email.trim();
  const phone = hero.phone.trim();
  const hasImage = Boolean(contact.image.src);
  return (
    <div className={styles.contactDialog} role="dialog" aria-modal="true" aria-labelledby="contact-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={styles.contactPanel} data-layout={contact.layout}>
        {(hasImage || email) && <div className={styles.contactVisual}>
          {hasImage
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={contact.image.src} alt={contact.image.alt} style={croppedImageStyle(contact.image)} />
            : <ContactQr value={`mailto:${email}`} />}
        </div>}
        {contact.eyebrow.trim() && <div className={styles.contactTextLayer} style={contactTextStyle(contact.eyebrowStyle, "var(--accent)")}><p>{contact.eyebrow}</p></div>}
        {contact.title.trim() && <div className={styles.contactTextLayer} data-kind="title" style={contactTextStyle(contact.titleStyle, "var(--ink)")}><h2 id="contact-title">{contact.title}</h2></div>}
        {(email || phone) && <div className={styles.contactTextLayer} data-kind="details" style={contactTextStyle(contact.detailsStyle, "var(--ink)")}>
          {email && <a href={`mailto:${email}`}>{email}</a>}
          {phone && <a href={`tel:${phone.replace(/[^\\d+]/gu, "")}`}>{phone}</a>}
        </div>}
        {contact.note.trim() && <div className={styles.contactTextLayer} data-kind="note" style={contactTextStyle(contact.noteStyle, "var(--muted)")}><small>{contact.note}</small></div>}
        <button type="button" className={styles.contactClose} onClick={onClose} aria-label="关闭联系方式">×</button>
      </section>
    </div>
  );
}

function contactTextStyle''')

regex_once(portfolio, r'function ProjectContentBlock\(.*?\n}\n\nfunction ProjectDetails', '''function ProjectContentBlock({ block }: { block: ProjectBlock }) {
  switch (block.type) {
    case "text": {
      const hasCopy = Boolean(block.eyebrow.trim() || block.title.trim() || block.body.trim());
      if (!hasCopy) return null;
      return (
        <section className={styles.textBlock} aria-labelledby={`${block.id}-title`}>
          {block.eyebrow.trim() && <p>{block.eyebrow}</p>}
          {block.title.trim() && <h4 id={`${block.id}-title`}>{block.title}</h4>}
          {block.body.trim() && <div><p>{block.body}</p></div>}
        </section>
      );
    }
    case "media-text": {
      const hasMedia = Boolean(block.media.src);
      const hasCopy = Boolean(block.eyebrow.trim() || block.title.trim() || block.body.trim());
      if (!hasMedia && !hasCopy) return null;
      return (
        <section
          className={`${styles.mediaTextBlock} ${block.side === "right" ? styles.mediaRight : ""}`}
          aria-labelledby={`${block.id}-title`}
        >
          {hasMedia && <MediaFrame media={block.media} className={styles.detailMedia} aspectRatio={4 / 3} />}
          {hasCopy && <div className={styles.blockCopy}>
            {block.eyebrow.trim() && <p>{block.eyebrow}</p>}
            {block.title.trim() && <h4 id={`${block.id}-title`}>{block.title}</h4>}
            {block.body.trim() && <p>{block.body}</p>}
          </div>}
        </section>
      );
    }
    case "gallery": {
      const items = block.items.filter((item) => Boolean(item.src));
      if (!items.length) return null;
      return (
        <section className={styles.galleryBlock} aria-labelledby={`${block.id}-title`}>
          {(block.eyebrow.trim() || block.title.trim()) && <header>
            {block.eyebrow.trim() && <p>{block.eyebrow}</p>}
            {block.title.trim() && <h4 id={`${block.id}-title`}>{block.title}</h4>}
          </header>}
          <div className={styles.galleryGrid} data-count={items.length} data-orientation={block.orientation}>
            {items.map((item) => <MediaFrame key={item.id} media={item} aspectRatio={block.orientation === "landscape" ? 4 / 3 : 3 / 4} />)}
          </div>
        </section>
      );
    }
    case "full-media":
      if (!block.media.src) return null;
      return (
        <section className={styles.fullMediaBlock}>
          <MediaFrame media={block.media} aspectRatio={16 / 9} />
          {block.caption.trim() && <p>{block.caption}</p>}
        </section>
      );
  }
}

function ProjectDetails''')

regex_once(portfolio, r'function ProjectCard\(.*?\n}\n\nfunction PlaybackModal', '''function ProjectCard({
  project,
  category,
  isOpen,
  onToggle,
  onPlay,
}: {
  project: Project;
  category: CategoryConfig;
  isOpen: boolean;
  onToggle: () => void;
  onPlay: (trigger: HTMLButtonElement) => void;
}) {
  const detailId = `${project.id}-details`;
  const railMeta = [project.year.trim(), project.duration !== "00:00" ? project.duration : ""].filter(Boolean).join(" · ");

  return (
    <article className={styles.project} data-open={isOpen} style={{ "--project-accent": category.accent } as React.CSSProperties}>
      <div className={styles.projectRail}>
        <span>{String(project.order).padStart(2, "0")}</span>
        <span>{category.label}</span>
        <span>{railMeta}</span>
      </div>

      <ProjectCover project={project} category={category} isOpen={isOpen} onToggle={onToggle} onPlay={onPlay} />

      <div className={styles.detailReveal} data-open={isOpen} id={detailId} aria-hidden={!isOpen}>
        <div className={styles.detailRevealInner}>
          <ProjectDetails project={project} />
        </div>
      </div>
    </article>
  );
}

function PlaybackModal''')

replace_once(portfolio,
'''  useEffect(() => {
    document.title = portfolio.settings.siteTitle;
  }, [portfolio.settings.siteTitle]);''',
'''  useEffect(() => {
    document.title = portfolio.settings.siteTitle.trim() || "学生作品展示";
  }, [portfolio.settings.siteTitle]);''')
replace_once(portfolio,
'''  const yearRange = useMemo(() => {
    const years = portfolio.projects.map((project) => project.year).sort();
    if (years.length === 0) return String(new Date().getFullYear());
    return years[0] === years[years.length - 1] ? years[0] : `${years[0]}—${years[years.length - 1]}`;
  }, [portfolio.projects]);''',
'''  const yearRange = useMemo(() => {
    const years = portfolio.projects.map((project) => project.year.trim()).filter(Boolean).sort();
    if (years.length === 0) return "";
    return years[0] === years[years.length - 1] ? years[0] : `${years[0]}—${years[years.length - 1]}`;
  }, [portfolio.projects]);''')
replace_once(portfolio,
'''  const customFontUrl = portfolio.settings.customFont.src?.startsWith("/api/media/")
    ? portfolio.settings.customFont.src
    : undefined;

  return (''',
'''  const customFontUrl = portfolio.settings.customFont.src?.startsWith("/api/media/")
    ? portfolio.settings.customFont.src
    : undefined;
  const workHeadingLead = portfolio.settings.workHeading.lead.trim();
  const workHeadingAccent = portfolio.settings.workHeading.accent.trim();

  return (''')
replace_once(portfolio,
'''        <header className={styles.workHeading}>
          <p>SELECTED WORK · {yearRange}</p>
          <h2 id="work-heading">{portfolio.settings.workHeading.lead}<br /><span>{portfolio.settings.workHeading.accent}</span></h2>
        </header>''',
'''        {(workHeadingLead || workHeadingAccent || yearRange) && <header className={styles.workHeading}>
          {yearRange && <p>SELECTED WORK · {yearRange}</p>}
          {(workHeadingLead || workHeadingAccent) && <h2 id="work-heading">
            {workHeadingLead}
            {workHeadingLead && workHeadingAccent && <br />}
            {workHeadingAccent && <span>{workHeadingAccent}</span>}
          </h2>}
        </header>}''')
replace_once(portfolio,
'''      <footer className={styles.footer} hidden={!entered}>
        <div>
          <span>PORTFOLIO / {yearRange}</span>
          <strong>{portfolio.hero.name}</strong>
        </div>
        <p>{portfolio.hero.role}<br />{portfolio.hero.targetRole}</p>
        <a href={`mailto:${portfolio.hero.email}`}>{portfolio.hero.email}</a>
      </footer>''',
'''      <footer className={styles.footer} hidden={!entered}>
        <div>
          {yearRange && <span>PORTFOLIO / {yearRange}</span>}
          {portfolio.hero.name.trim() && <strong>{portfolio.hero.name}</strong>}
        </div>
        {(portfolio.hero.role.trim() || portfolio.hero.targetRole.trim()) && <p>
          {portfolio.hero.role}
          {portfolio.hero.role.trim() && portfolio.hero.targetRole.trim() && <br />}
          {portfolio.hero.targetRole}
        </p>}
        {portfolio.hero.email.trim() && <a href={`mailto:${portfolio.hero.email}`}>{portfolio.hero.email}</a>}
      </footer>''')

# 5. Admin local preview cache and multiline editing.
admin = "app/admin/admin-client.tsx"
replace_once(admin,
'import { AccessManager, type AccessPayload } from "./access-manager";',
'import { AccessManager, type AccessPayload } from "./access-manager";\nimport { rememberLocalMediaPreview, useMediaPreview } from "./media-preview-cache";')
replace_once(admin,
'type OperationError = { title: string; reason: string; solution: string };',
'type OperationError = { title: string; reason: string; solution: string; rawReason?: string; actionLabel?: string };')
replace_once(admin, '<strong>{portfolio.hero.name}</strong>', '<strong>{portfolio.hero.name || "未命名作品集"}</strong>')
replace_once(admin,
'''              <strong>{project.title}</strong>
              <small>{portfolio.categories.find((category) => category.id === project.categoryId)?.label}</small>''',
'''              <strong>{project.title || "未命名作品"}</strong>
              <small>{portfolio.categories.find((category) => category.id === project.categoryId)?.label || "未命名分类"}</small>''')
replace_once(admin, '<ProjectForm\n              project={selectedProject}', '<ProjectForm\n              key={selectedProject.id}\n              project={selectedProject}')
replace_once(admin, '<article className={styles.blockCard}>', '<article className={styles.blockCard} data-block-index={index}>')
replace_once(admin,
'''function CoverLayoutPreview({ project, categoryLabel, update, updateStyle }: { project: Project; categoryLabel: string; update: (updater: (project: Project) => Project) => void; updateStyle: (key: "titleStyle" | "synopsisStyle" | "factsStyle", patch: Partial<CoverTextStyle>) => void }) {
  const defaults = createDefaultCoverPresentation();''',
'''function CoverLayoutPreview({ project, categoryLabel, update, updateStyle }: { project: Project; categoryLabel: string; update: (updater: (project: Project) => Project) => void; updateStyle: (key: "titleStyle" | "synopsisStyle" | "factsStyle", patch: Partial<CoverTextStyle>) => void }) {
  const defaults = createDefaultCoverPresentation();
  const previewSrc = useMediaPreview(project.cover);''')
replace_once(admin,
'''      {project.cover.src
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={project.cover.src} alt="" style={croppedImageStyle(project.cover)} />''',
'''      {previewSrc
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={previewSrc} alt="" style={croppedImageStyle(project.cover)} />''')
replace_once(admin,
'''function ContactLayoutPreview({ portfolio, updateContact, updateHero, updateStyle }: { portfolio: PortfolioDocument; updateContact: (patch: Partial<PortfolioDocument["settings"]["contact"]>) => void; updateHero: (field: "email" | "phone", value: string) => void; updateStyle: (key: "eyebrowStyle" | "titleStyle" | "detailsStyle" | "noteStyle", patch: Partial<CoverTextStyle>) => void }) {
  const contact = portfolio.settings.contact;''',
'''function ContactLayoutPreview({ portfolio, updateContact, updateHero, updateStyle }: { portfolio: PortfolioDocument; updateContact: (patch: Partial<PortfolioDocument["settings"]["contact"]>) => void; updateHero: (field: "email" | "phone", value: string) => void; updateStyle: (key: "eyebrowStyle" | "titleStyle" | "detailsStyle" | "noteStyle", patch: Partial<CoverTextStyle>) => void }) {
  const contact = portfolio.settings.contact;
  const previewSrc = useMediaPreview(contact.image);''')
replace_once(admin,
'''        {contact.image.src
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={contact.image.src} alt="" style={croppedImageStyle(contact.image)} />''',
'''        {previewSrc
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={previewSrc} alt="" style={croppedImageStyle(contact.image)} />''')
replace_once(admin,
'''  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | undefined>(asset.src);''',
'''  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const previewSrc = useMediaPreview(asset);''')
replace_once(admin,
'      if (asset.kind === "image") setPreviewSrc(URL.createObjectURL(uploadFile));',
'      if (asset.kind === "image") rememberLocalMediaPreview(result.asset, uploadFile);')
replace_all(admin,
'''    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (editing && event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (editing) event.stopPropagation(); },''',
'''    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (editing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.currentTarget.blur();
      }
      if (editing) event.stopPropagation();
    },''')
replace_once(admin,
'''        <button type="button" autoFocus onClick={onClose}>返回继续处理</button>''',
'''        {error.rawReason && <span hidden data-error-path>{error.rawReason}</span>}
        <button type="button" autoFocus onClick={onClose}>{error.actionLabel || "返回继续处理"}</button>''')
replace_once(admin,
'''function createProject(categoryId: string, order: number): Project {
  return { id: `project-${createClientId()}`, order, categoryId, title: "未命名作品", year: String(new Date().getFullYear()), duration: "00:00", synopsis: "填写作品简介。", challenge: "", solution: "", cover: emptyMedia("image"), finalVideo: emptyMedia("video"), coverPresentation: createDefaultCoverPresentation(), detailBlocks: [] };
}''',
'''function createProject(categoryId: string, order: number): Project {
  return { id: `project-${createClientId()}`, order, categoryId, title: "", year: "", duration: "00:00", synopsis: "", challenge: "", solution: "", cover: emptyMedia("image"), finalVideo: emptyMedia("video"), coverPresentation: createDefaultCoverPresentation(), detailBlocks: [] };
}''')
replace_once(admin,
'''function createBlock(type: ProjectBlock["type"]): ProjectBlock {
  const id = `block-${createClientId()}`;
  if (type === "text") return { id, type, eyebrow: "PROCESS", title: "新内容", body: "填写内容。" };
  if (type === "media-text") return { id, type, eyebrow: "PROCESS", title: "图文内容", body: "填写内容。", side: "left", media: emptyMedia("image") };
  if (type === "gallery") return { id, type, eyebrow: "GALLERY", title: "图片组", orientation: "portrait", items: [emptyMedia("image")] };
  return { id, type, caption: "图片说明", media: emptyMedia("image") };
}''',
'''function createBlock(type: ProjectBlock["type"]): ProjectBlock {
  const id = `block-${createClientId()}`;
  if (type === "text") return { id, type, eyebrow: "", title: "", body: "" };
  if (type === "media-text") return { id, type, eyebrow: "", title: "", body: "", side: "left", media: emptyMedia("image") };
  if (type === "gallery") return { id, type, eyebrow: "", title: "", orientation: "portrait", items: [emptyMedia("image")] };
  return { id, type, caption: "", media: emptyMedia("image") };
}''')
regex_once(admin, r'function failureGuidance\(message: string\): OperationError \{.*?\n}\nasync function prepareUploadFile', '''function failureGuidance(message: string): OperationError {
  const validation = humanizeValidationFailure(message);
  if (validation) return {
    title: "这项内容需要调整",
    reason: validation,
    solution: "点击“定位并修改”，系统会进入对应作品、内容块和输入框。",
    rawReason: message,
    actionLabel: "定位并修改",
  };
  if (/超过|过大|50 MB|10 MiB|8 MiB|空间不足/u.test(message)) return { title: "文件没有上传", reason: message, solution: "压缩文件、删除不再使用的媒体，或重新选择更小的文件后再上传。" };
  if (/登录|身份|权限/u.test(message)) return { title: "当前操作没有完成", reason: message, solution: "重新输入管理员密码后再试。" };
  if (/草稿已|冲突|修订/u.test(message)) return { title: "版本已经变化", reason: message, solution: "刷新后台读取最新草稿，再重新应用并保存本次修改。" };
  if (/格式|JPG|MP4|WOFF|字体|视频|图片/u.test(message)) return { title: "文件格式不符合要求", reason: message, solution: "按上传框标注的格式重新导出文件，然后再次拖入。" };
  return { title: "操作没有完成", reason: message, solution: "检查当前提示后重试；如果仍失败，保留提示截图再处理。" };
}

function humanizeValidationFailure(message: string) {
  const project = message.match(/projects\\[(\\d+)\\]/u);
  const block = message.match(/detailBlocks\\[(\\d+)\\]/u);
  const field = message.match(/\\.(siteTitle|name|role|targetRole|email|phone|statement|availability|label|title|year|synopsis|challenge|solution|eyebrow|body|caption)(?:\\s|$)/u)?.[1];
  if (!/无效|必须|超过|长度/u.test(message) || (!project && !field)) return null;
  const labels: Record<string, string> = {
    siteTitle: "网站名称", name: "姓名", role: "职业标题", targetRole: "求职方向", email: "联系邮箱",
    phone: "电话号码", statement: "个人定位", availability: "状态短句", label: "分类名称", title: block ? "内容块标题" : "作品名称",
    year: "年份", synopsis: "作品简介", challenge: "项目难点", solution: "解决思路", eyebrow: "眉题", body: "正文", caption: "图注",
  };
  const limits: Record<string, number> = { siteTitle: 80, name: 60, role: 80, targetRole: 120, email: 160, phone: 30, statement: 260, availability: 100, label: 40, title: block ? 120 : 100, year: 4, synopsis: 1200, challenge: 1200, solution: 1200, eyebrow: 80, body: 4000, caption: 500 };
  const location = [
    project ? `第 ${Number(project[1]) + 1} 个作品` : "",
    block ? `第 ${Number(block[1]) + 1} 个内容块` : "",
    field ? labels[field] || field : "对应字段",
  ].filter(Boolean).join(" → ");
  const limit = field ? limits[field] : undefined;
  const issue = message.includes("长度无效") && limit ? `内容为空或超过 ${limit} 个字符` : message.replace(/^.*?\\s(?=[^\\s]+$)/u, "");
  return `${location}：${issue}`;
}

async function prepareUploadFile''')

# 6. Hero editor also resolves local media previews and keeps Enter for a real newline.
hero_editor = "app/admin/hero-layout-editor.tsx"
replace_once(hero_editor,
'import styles from "./admin.module.css";',
'import styles from "./admin.module.css";\nimport { useMediaPreview } from "./media-preview-cache";')
replace_once(hero_editor,
'''}) {
  const [selectedId, setSelectedId] = useState(slide.layers[0]?.id ?? "");''',
'''}) {
  const previewSrc = useMediaPreview(slide.media);
  const [selectedId, setSelectedId] = useState(slide.layers[0]?.id ?? "");''')
replace_once(hero_editor,
'''        {slide.media.src
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={slide.media.src} alt="" style={croppedImageStyle(slide.media, "contain")} />''',
'''        {previewSrc
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={previewSrc} alt="" style={croppedImageStyle(slide.media, "contain")} />''')
replace_once(hero_editor,
'''      if (editing && event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      if (editing) event.stopPropagation();''',
'''      if (editing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.currentTarget.blur();
      }
      if (editing) event.stopPropagation();''')

# 7. Validation locator understands project blocks and waits for React navigation.
enhancements = "app/admin/admin-interaction-enhancements.tsx"
regex_once(enhancements, r'const fieldLabels: Array<\[RegExp, string\]> = \[.*?\n\];', '''const fieldLabels: Array<[RegExp, string]> = [
  [/detailBlocks\\[\\d+\\]\\.body/u, "正文"],
  [/detailBlocks\\[\\d+\\]\\.caption/u, "图注"],
  [/detailBlocks\\[\\d+\\]\\.eyebrow/u, "眉题"],
  [/detailBlocks\\[\\d+\\]\\.title/u, "标题"],
  [/projects\\[\\d+\\]\\.title/u, "作品名称"],
  [/hero\\.name/u, "姓名"],
  [/hero\\.role/u, "职业标题"],
  [/hero\\.targetRole/u, "求职方向"],
  [/hero\\.email/u, "联系邮箱"],
  [/hero\\.phone/u, "电话号码"],
  [/hero\\.statement/u, "个人定位"],
  [/settings\\.siteTitle/u, "浏览器标签与站点名称"],
  [/settings\\.contact\\.title/u, "主标题"],
  [/settings\\.contact\\.note/u, "说明"],
  [/\\.year/u, "年份"],
  [/\\.synopsis/u, "作品简介"],
  [/\\.challenge/u, "项目难点"],
  [/\\.solution/u, "解决思路"],
];''')
replace_once(enhancements,
'''      const target = locateValidationProblem(reason);
      if (target) {
        lastProblemTarget = target;
        revealTarget(target);
      }''',
'''      locateValidationProblem(reason, (target) => {
        lastProblemTarget = target;
        revealTarget(target);
      });''')
replace_once(enhancements,
'''      if (!button || button.textContent?.trim() !== "返回继续处理" || !lastProblemTarget) return;''',
'''      if (!button || !["返回继续处理", "定位并修改"].includes(button.textContent?.trim() ?? "") || !lastProblemTarget) return;''')
regex_once(enhancements, r'function locateValidationProblem\(reason: string\): Element \| null \{.*?\n}\n\nfunction validationView', '''function locateValidationProblem(reason: string, onLocated: (target: Element) => void) {
  const view = validationView(reason);
  if (view) {
    const navButton = Array.from(document.querySelectorAll("aside nav button"))
      .find((button) => button.textContent?.includes(view));
    clickElement(navButton);
  }

  const projectIndexMatch = reason.match(/projects\\[(\\d+)\\]/u);
  const blockIndexMatch = reason.match(/detailBlocks\\[(\\d+)\\]/u);
  let fieldLabel = "";
  for (const [pattern, label] of fieldLabels) {
    if (pattern.test(reason)) {
      fieldLabel = label;
      break;
    }
  }

  const locateField = () => {
    if (projectIndexMatch) {
      const index = Number(projectIndexMatch[1]);
      const projectButtons = Array.from(document.querySelectorAll("button"))
        .filter((button) => /^\\d{2}/u.test(button.textContent?.trim() ?? "") && button.querySelector("strong"));
      clickElement(projectButtons[index]);
    }

    window.setTimeout(() => {
      let scope: ParentNode = document;
      if (blockIndexMatch) {
        const prefix = `${String(Number(blockIndexMatch[1]) + 1).padStart(2, "0")} ·`;
        const block = Array.from(document.querySelectorAll("article[data-block-index]"))
          .find((article) => article.querySelector(":scope > header > span")?.textContent?.trim().startsWith(prefix));
        if (block) scope = block;
      }
      const target = fieldLabel
        ? Array.from(scope.querySelectorAll("label")).find((label) => fieldText(label).includes(fieldLabel))
        : scope instanceof Element ? scope : document.querySelector("section");
      if (target) onLocated(target);
    }, projectIndexMatch ? 100 : 30);
  };

  window.setTimeout(locateField, view ? 60 : 0);
}

function validationView''')

# 8. Shared CSS for authored line breaks.
append_once("app/admin/admin.module.css", "/* authored multiline text */", '''/* authored multiline text */
.coverPreviewTitle strong,
.coverPreviewSynopsis p,
.coverPreviewFacts,
.contactTextLayer,
.layoutLayer,
.wideField textarea,
.blockCard textarea {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
''')
append_once("app/demo/portfolio-demo.module.css", "/* authored multiline output */", '''/* authored multiline output */
.heroLayer h1,
.heroLayer p,
.heroLayer dd,
.projectTitleGroup h2,
.projectSynopsis p,
.projectFacts dd,
.blockCopy h4,
.blockCopy p,
.textBlock h4,
.textBlock div p,
.galleryBlock h4,
.fullMediaBlock > p,
.contactTextLayer h2,
.contactTextLayer small,
.footer strong,
.footer p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
''')

print("phase one stability patch applied")
