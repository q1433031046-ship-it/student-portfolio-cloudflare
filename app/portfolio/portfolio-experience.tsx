"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CategoryConfig,
  type CoverTextStyle,
  type MediaAsset,
  type PortfolioDocument,
  type Project,
  type ProjectBlock,
} from "./model";
import styles from "../demo/portfolio-demo.module.css";
import { createClientId } from "../lib/client-id";
import { HeroSequence } from "./hero-sequence";
import { CategoryTransition } from "./category-transition";
import { ProjectCover } from "./project-cover";
import { VideoWatermark } from "./video-watermark";
import { resolveWatermarkText } from "./watermark";
import { croppedImageStyle } from "./media-crop";
import { createQrMatrix } from "../lib/qr-code";

type PlaybackState = {
  project: Project;
  asset: MediaAsset;
  status: "ready" | "loading" | "error";
  error?: string;
  expiresAt?: string;
  recoveryCount: number;
  restoreTime?: number;
  shouldResume?: boolean;
} | null;

export type PortfolioExperienceProps = {
  initialPortfolio: PortfolioDocument;
  mode: "review" | "live";
};

function ContactQr({ value }: { value: string }) {
  const modules = createQrMatrix(value);
  return (
    <svg className={styles.contactQr} viewBox="0 0 65 65" role="img" aria-label="联系方式二维码" shapeRendering="crispEdges">
      <rect width="65" height="65" fill="white" />
      {modules.flatMap((row, y) => row.map((filled, x) => filled ? <rect key={`${x}-${y}`} x={x + 4} y={y + 4} width="1" height="1" fill="#111" /> : null))}
    </svg>
  );
}

function ContactDialog({ hero, contact, onClose }: { hero: PortfolioDocument["hero"]; contact: PortfolioDocument["settings"]["contact"]; onClose: () => void }) {
  const qrValue = `mailto:${hero.email}`;
  return (
    <div className={styles.contactDialog} role="dialog" aria-modal="true" aria-labelledby="contact-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={styles.contactPanel} data-layout={contact.layout}>
        <div className={styles.contactVisual}>
          {contact.image.src
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={contact.image.src} alt={contact.image.alt} style={croppedImageStyle(contact.image)} />
            : <ContactQr value={qrValue} />}
        </div>
        <div className={styles.contactTextLayer} style={contactTextStyle(contact.eyebrowStyle, "var(--accent)")}><p>{contact.eyebrow}</p></div>
        <div className={styles.contactTextLayer} data-kind="title" style={contactTextStyle(contact.titleStyle, "var(--ink)")}><h2 id="contact-title">{contact.title}</h2></div>
        <div className={styles.contactTextLayer} data-kind="details" style={contactTextStyle(contact.detailsStyle, "var(--ink)")}><a href={`mailto:${hero.email}`}>{hero.email}</a>{hero.phone && <a href={`tel:${hero.phone.replace(/[^\d+]/gu, "")}`}>{hero.phone}</a>}</div>
        {contact.note && <div className={styles.contactTextLayer} data-kind="note" style={contactTextStyle(contact.noteStyle, "var(--muted)")}><small>{contact.note}</small></div>}
        <button type="button" className={styles.contactClose} onClick={onClose} aria-label="关闭联系方式">×</button>
      </section>
    </div>
  );
}

function contactTextStyle(style: CoverTextStyle, systemColor: string): React.CSSProperties {
  return {
    "--contact-x": `${style.x}%`,
    "--contact-y": `${style.y}%`,
    "--contact-width": `${style.width}%`,
    "--contact-scale": style.scale,
    textAlign: style.align,
    color: style.color === "system" ? systemColor : style.color,
    fontFamily: style.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined,
  } as React.CSSProperties;
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6.8 8.4 5.2L9 17.2V6.8Z" fill="currentColor" />
    </svg>
  );
}

const visualLetters: Record<MediaAsset["visualKey"], string> = {
  portrait: "LIGHT / 02",
  city: "AFTER / 01",
  frame: "FRAME / 08",
  character: "CAST / 04",
  storyboard: "BOARD / 12",
};

function MediaFrame({
  media,
  className = "",
  priority = false,
  aspectRatio,
}: {
  media: MediaAsset;
  className?: string;
  priority?: boolean;
  aspectRatio?: number;
}) {
  if (media.src) {
    return (
      <figure className={`${styles.mediaFrame} ${className}`} style={aspectRatio ? { aspectRatio } : undefined}>
        {/* Media is resized and compressed before private object storage upload. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.src}
          alt={media.alt}
          style={croppedImageStyle(media)}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
        />
      </figure>
    );
  }

  return (
    <figure
      className={`${styles.mediaFrame} ${className}`}
      data-visual={media.visualKey}
      role="img"
      aria-label={media.alt}
    >
      <span className={styles.mediaAtmosphere} aria-hidden="true" />
      <span className={styles.mediaPlane} aria-hidden="true" />
      <span className={styles.mediaPulse} aria-hidden="true" />
      <span className={styles.mediaCode} aria-hidden="true">{visualLetters[media.visualKey]}</span>
    </figure>
  );
}

function ProjectContentBlock({ block }: { block: ProjectBlock }) {
  switch (block.type) {
    case "text":
      return (
        <section className={styles.textBlock} aria-labelledby={`${block.id}-title`}>
          <p>{block.eyebrow}</p>
          <h4 id={`${block.id}-title`}>{block.title}</h4>
          <div><p>{block.body}</p></div>
        </section>
      );
    case "media-text":
      return (
        <section
          className={`${styles.mediaTextBlock} ${block.side === "right" ? styles.mediaRight : ""}`}
          aria-labelledby={`${block.id}-title`}
        >
          <MediaFrame media={block.media} className={styles.detailMedia} aspectRatio={4 / 3} />
          <div className={styles.blockCopy}>
            <p>{block.eyebrow}</p>
            <h4 id={`${block.id}-title`}>{block.title}</h4>
            <p>{block.body}</p>
          </div>
        </section>
      );
    case "gallery":
      return (
        <section className={styles.galleryBlock} aria-labelledby={`${block.id}-title`}>
          <header>
            <p>{block.eyebrow}</p>
            <h4 id={`${block.id}-title`}>{block.title}</h4>
          </header>
          <div className={styles.galleryGrid} data-count={block.items.length} data-orientation={block.orientation}>
            {block.items.map((item) => <MediaFrame key={item.id} media={item} aspectRatio={block.orientation === "landscape" ? 4 / 3 : 3 / 4} />)}
          </div>
        </section>
      );
    case "full-media":
      return (
        <section className={styles.fullMediaBlock}>
          <MediaFrame media={block.media} aspectRatio={16 / 9} />
          <p>{block.caption}</p>
        </section>
      );
  }
}

function ProjectDetails({ project }: { project: Project }) {
  return (
    <div className={styles.projectDetails}>
      <section className={styles.projectIntro} aria-label={`${project.title}项目介绍`}>
        <div className={styles.introLead}>
          <p>PROJECT DETAILS</p>
          <h3>创作过程与项目资产</h3>
        </div>
      </section>
      {project.detailBlocks.map((block) => <ProjectContentBlock key={block.id} block={block} />)}
    </div>
  );
}

function ProjectCard({
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

  return (
    <article className={styles.project} data-open={isOpen} style={{ "--project-accent": category.accent } as React.CSSProperties}>
      <div className={styles.projectRail}>
        <span>{String(project.order).padStart(2, "0")}</span>
        <span>{category.label}</span>
        <span>{project.year} · {project.duration}</span>
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

function PlaybackModal({
  playback,
  watermarkText,
  watermarkAppearance,
  onClose,
  onMediaError,
  onRetry,
}: {
  playback: Exclude<PlaybackState, null>;
  watermarkText: string;
  watermarkAppearance: PortfolioDocument["settings"]["videoWatermarkStyle"];
  onClose: () => void;
  onMediaError: (snapshot: { currentTime: number; shouldResume: boolean }) => void;
  onRetry: () => void;
}) {
  const { project, asset, status, error, restoreTime, shouldResume } = playback;
  const closeRef = useRef<HTMLButtonElement>(null);
  const [watermarkStarted, setWatermarkStarted] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className={styles.modal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="playback-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not([disabled]), video[controls], [href], [tabindex]:not([tabindex='-1'])",
        ));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className={styles.modalPanel}>
        <div className={styles.playerSurface}>
          {status === "ready" && asset.src ? (
            <video
              src={asset.src}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onPlay={() => { setWatermarkStarted(true); setVideoPlaying(true); }}
              onPause={() => setVideoPlaying(false)}
              onEnded={() => setVideoPlaying(false)}
              onLoadedMetadata={(event) => {
                if (typeof restoreTime === "number" && Number.isFinite(restoreTime)) {
                  event.currentTarget.currentTime = Math.min(restoreTime, event.currentTarget.duration || restoreTime);
                }
                if (shouldResume) void event.currentTarget.play().catch(() => undefined);
              }}
              onError={(event) => onMediaError({
                currentTime: event.currentTarget.currentTime,
                shouldResume: !event.currentTarget.paused,
              })}
            />
          ) : (
            <MediaFrame media={asset} className={styles.playerPlaceholder} />
          )}
          {watermarkStarted && <VideoWatermark text={watermarkText} moving={videoPlaying} appearance={watermarkAppearance} />}
          {(status !== "ready" || !asset.src) && (
            <div className={styles.playerReady}>
              <span><PlayIcon /></span>
              <p>{status === "loading" ? "正在建立安全播放连接…" : error ?? "视频上传后在这里直接播放"}</p>
              {status === "error" && <button type="button" onClick={onRetry}>重新连接</button>}
            </div>
          )}
        </div>
        <h2 className={styles.srOnly} id="playback-title">{project.title}</h2>
        <button ref={closeRef} className={styles.modalClose} type="button" onClick={onClose} aria-label="关闭播放器">
          <span aria-hidden="true">←</span>
        </button>
      </div>
    </div>
  );
}

export function PortfolioExperience({ initialPortfolio: portfolio, mode }: PortfolioExperienceProps) {
  const theme = portfolio.settings.activeTheme;
  const [entered, setEntered] = useState(false);
  const expansionMode = portfolio.settings.expansionMode;
  const [openProjects, setOpenProjects] = useState<string[]>([]);
  const [playback, setPlayback] = useState<PlaybackState>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const playbackRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const playbackRequestIdRef = useRef(0);
  const playbackTriggerRef = useRef<HTMLButtonElement | null>(null);
  const playbackTriggerKeyRef = useRef<string | null>(null);
  const restorePlaybackFocusRef = useRef(false);

  useEffect(() => {
    document.title = portfolio.settings.siteTitle;
  }, [portfolio.settings.siteTitle]);

  function closePlayback() {
    playbackRequestRef.current?.controller.abort();
    playbackRequestRef.current = null;
    playbackRequestIdRef.current += 1;
    restorePlaybackFocusRef.current = true;
    setPlayback(null);
  }

  const projectCounts = useMemo(() => Object.fromEntries(
    portfolio.categories.map((category) => [
      category.id,
      portfolio.projects.filter((project) => project.categoryId === category.id).length,
    ]),
  ), [portfolio.categories, portfolio.projects]);
  const yearRange = useMemo(() => {
    const years = portfolio.projects.map((project) => project.year).sort();
    if (years.length === 0) return String(new Date().getFullYear());
    return years[0] === years[years.length - 1] ? years[0] : `${years[0]}—${years[years.length - 1]}`;
  }, [portfolio.projects]);

  useEffect(() => {
    if (mode !== "live") return;
    const sessionId = getPortfolioSessionId();
    if (!sessionStorage.getItem("portfolio-page-view-reported")) {
      sessionStorage.setItem("portfolio-page-view-reported", "1");
      reportEvent("page_view", undefined, undefined, sessionId);
    }
  }, [mode]);

  useEffect(() => {
    if (!playback) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePlayback();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [playback]);

  useEffect(() => {
    if (playback || !restorePlaybackFocusRef.current) return;
    restorePlaybackFocusRef.current = false;
    const timer = window.setTimeout(() => {
      const storedTrigger = playbackTriggerRef.current;
      const trigger = storedTrigger?.isConnected
        ? storedTrigger
        : Array.from(document.querySelectorAll<HTMLButtonElement>("[data-playback-trigger]"))
          .find((button) => button.dataset.playbackTrigger === playbackTriggerKeyRef.current);
      trigger?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [playback]);

  useEffect(() => () => playbackRequestRef.current?.controller.abort(), []);

  function toggleProject(projectId: string) {
    setOpenProjects((current) => {
      if (current.includes(projectId)) return current.filter((id) => id !== projectId);
      if (mode === "live") reportEvent("project_open", projectId, undefined, getPortfolioSessionId());
      return expansionMode === "single" ? [projectId] : [...current, projectId];
    });
  }

  async function startPlayback(
    project: Project,
    trigger?: HTMLButtonElement,
    recovery?: { currentTime: number; shouldResume: boolean; count: number },
  ) {
    if (trigger) {
      playbackTriggerRef.current = trigger;
      playbackTriggerKeyRef.current = `${project.id}:final`;
    }
    const asset = project.finalVideo;
    if (mode === "review" || asset.src) {
      setPlayback({ project, asset, status: "ready", recoveryCount: 0 });
      return;
    }

    playbackRequestRef.current?.controller.abort();
    const request = { id: ++playbackRequestIdRef.current, controller: new AbortController() };
    playbackRequestRef.current = request;
    setPlayback({
      project,
      asset,
      status: "loading",
      recoveryCount: recovery?.count ?? 0,
      restoreTime: recovery?.currentTime,
      shouldResume: recovery?.shouldResume,
    });
    try {
      const response = await fetch("/api/playback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, version: "final", sessionId: getPortfolioSessionId() }),
        signal: request.controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || typeof body.url !== "string" || !body.url.startsWith("/api/media/")) {
        const message = isRecord(body) && typeof body.error === "string" ? body.error : "暂时无法播放这个版本";
        throw new Error(message);
      }
      if (playbackRequestRef.current?.id !== request.id) return;
      setPlayback({
        project,
        asset: { ...asset, src: body.url },
        status: "ready",
        expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
        recoveryCount: recovery?.count ?? 0,
        restoreTime: recovery?.currentTime,
        shouldResume: recovery?.shouldResume,
      });
    } catch (error) {
      if (request.controller.signal.aborted || playbackRequestRef.current?.id !== request.id) return;
      const message = error instanceof Error ? error.message : "暂时无法播放这个版本";
      setPlayback({ project, asset, status: "error", error: message, recoveryCount: recovery?.count ?? 0 });
      reportEvent("play_error", project.id, "final", getPortfolioSessionId());
    }
  }

  function recoverPlayback(snapshot: { currentTime: number; shouldResume: boolean }) {
    if (!playback || playback.status !== "ready") return;
    if (playback.recoveryCount >= 1) {
      setPlayback({ ...playback, asset: { ...playback.asset, src: undefined }, status: "error", error: "播放连接已中断，请重新连接" });
      reportEvent("play_error", playback.project.id, "final", getPortfolioSessionId());
      return;
    }
    void startPlayback(playback.project, undefined, { ...snapshot, count: playback.recoveryCount + 1 });
  }

  const customFontUrl = portfolio.settings.customFont.src?.startsWith("/api/media/")
    ? portfolio.settings.customFont.src
    : undefined;

  return (
    <main className={styles.demo} data-theme={theme} id="top">
      {customFontUrl && <style>{`@font-face{font-family:PortfolioCustom;src:url("${customFontUrl}");font-display:swap;}`}</style>}
      <HeroSequence
        hero={portfolio.hero}
        entered={entered}
        yearRange={yearRange}
        projectCount={portfolio.projects.length}
        onEnter={() => setEntered(true)}
        onExit={() => {
          setEntered(false);
          setOpenProjects([]);
          window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
        }}
        onContact={() => setContactOpen(true)}
      />

      <section className={styles.workSection} id="works" aria-labelledby="work-heading" hidden={!entered}>
        <header className={styles.workHeading}>
          <p>SELECTED WORK · {yearRange}</p>
          <h2 id="work-heading">{portfolio.settings.workHeading.lead}<br /><span>{portfolio.settings.workHeading.accent}</span></h2>
        </header>

        <div className={styles.categoryModules}>
          {portfolio.categories.map((category) => {
            const projects = portfolio.projects.filter((project) => project.categoryId === category.id);
            return (
              <section className={styles.categoryModule} id={`category-${category.id}`} key={category.id} aria-labelledby={`category-${category.id}-title`}>
                <CategoryTransition categories={portfolio.categories} current={category} projectCounts={projectCounts} />
                <h2 className={styles.srOnly} id={`category-${category.id}-title`}>{category.label}</h2>
                <div className={styles.projectList}>
                  {projects.length > 0 ? projects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      category={category}
                      isOpen={openProjects.includes(project.id)}
                      onToggle={() => toggleProject(project.id)}
                      onPlay={(trigger) => void startPlayback(project, trigger)}
                    />
                  )) : (
                    <div className={styles.emptyState}>
                      <span>EMPTY MODULE</span>
                      <h3>这个模块正等待第一件作品。</h3>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <footer className={styles.footer} hidden={!entered}>
        <div>
          <span>PORTFOLIO / {yearRange}</span>
          <strong>{portfolio.hero.name}</strong>
        </div>
        <p>{portfolio.hero.role}<br />{portfolio.hero.targetRole}</p>
        <a href={`mailto:${portfolio.hero.email}`}>{portfolio.hero.email}</a>
      </footer>

      {playback && (
        <PlaybackModal
          playback={playback}
          watermarkText={resolveWatermarkText(portfolio.settings.videoWatermarkText, portfolio.hero.name)}
          watermarkAppearance={portfolio.settings.videoWatermarkStyle}
          onClose={closePlayback}
          onMediaError={recoverPlayback}
          onRetry={() => void startPlayback(playback.project)}
        />
      )}
      {contactOpen && <ContactDialog hero={portfolio.hero} contact={portfolio.settings.contact} onClose={() => setContactOpen(false)} />}
    </main>
  );
}

function getPortfolioSessionId() {
  const key = "portfolio-session-id";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = createClientId();
  sessionStorage.setItem(key, created);
  return created;
}

function reportEvent(eventType: "page_view" | "project_open" | "play_error", projectId?: string, mediaVersion?: "final", sessionId?: string) {
  if (typeof window === "undefined") return;
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType, path: window.location.pathname, projectId, mediaVersion, sessionId: sessionId ?? getPortfolioSessionId() }),
    keepalive: true,
  }).catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
