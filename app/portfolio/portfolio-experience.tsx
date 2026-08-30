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
import { trimVisibleText } from "../lib/text-visibility";
import { toUserFacingChineseError, userFacingError, userFacingResponseError } from "../lib/user-facing-error";
import { HeroSequence } from "./hero-sequence";
import { EndCoverSequence } from "./end-cover-sequence";
import { CategoryTransition } from "./category-transition";
import { ProjectCover } from "./project-cover";
import { VideoWatermark } from "./video-watermark";
import { resolveWatermarkText } from "./watermark";
import { croppedImageStyle } from "./media-crop";
import { createQrMatrix } from "../lib/qr-code";
import { adminDraftVideoSource, hasPlayableVideo } from "./video-availability";
import { hasContactContent } from "./contact-availability";
import { useScrollLock } from "../lib/use-scroll-lock";
import type { PortfolioPreviewTarget } from "./preview-target";

type PlaybackState = {
  project: Project;
  asset: MediaAsset;
  status: "ready" | "loading" | "error";
  error?: string;
  expiresAt?: string;
  recoveryCount: number;
  restoreTime?: number;
  shouldResume?: boolean;
  autoplayRejected: boolean;
} | null;

export type PortfolioExperienceProps = {
  initialPortfolio: PortfolioDocument;
  mode: "review" | "live";
  embedded?: boolean;
  initialPreviewTarget?: PortfolioPreviewTarget;
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

function ContactDialog({ hero, contact, onClose, returnFocus }: { hero: PortfolioDocument["hero"]; contact: PortfolioDocument["settings"]["contact"]; onClose: () => void; returnFocus: HTMLButtonElement | null }) {
  const email = trimVisibleText(hero.email);
  const phone = trimVisibleText(hero.phone);
  const eyebrow = trimVisibleText(contact.eyebrow);
  const title = trimVisibleText(contact.title);
  const note = trimVisibleText(contact.note);
  const qrValue = email ? `mailto:${email}` : phone ? `tel:${phone.replace(/[^\d+]/gu, "")}` : "";
  const closeRef = useRef<HTMLButtonElement>(null);
  useScrollLock(true);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.setTimeout(() => returnFocus?.focus({ preventScroll: true }), 0);
    };
  }, [onClose, returnFocus]);
  return (
    <div
      className={styles.contactDialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "contact-title" : undefined}
      aria-label={title ? undefined : "联系方式"}
      onKeyDown={trapDialogFocus}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className={styles.contactPanel} data-layout={contact.layout}>
        <div className={styles.contactVisual}>
          {contact.image.src
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={contact.image.src} alt={contact.image.alt} style={croppedImageStyle(contact.image)} />
            : qrValue ? <ContactQr value={qrValue} /> : <span>CONTACT</span>}
        </div>
        {eyebrow && <div className={styles.contactTextLayer} style={contactTextStyle(contact.eyebrowStyle, "var(--accent)")}><p>{eyebrow}</p></div>}
        {title && <div className={styles.contactTextLayer} data-kind="title" style={contactTextStyle(contact.titleStyle, "var(--ink)")}><h2 id="contact-title">{title}</h2></div>}
        {(email || phone) && <div className={styles.contactTextLayer} data-kind="details" style={contactTextStyle(contact.detailsStyle, "var(--ink)")}>{email && <a href={`mailto:${email}`}>{email}</a>}{phone && <a href={`tel:${phone.replace(/[^\d+]/gu, "")}`}>{phone}</a>}</div>}
        {note && <div className={styles.contactTextLayer} data-kind="note" style={contactTextStyle(contact.noteStyle, "var(--muted)")}><small>{note}</small></div>}
        <button ref={closeRef} type="button" className={styles.contactClose} onClick={onClose} aria-label="关闭联系方式">×</button>
      </section>
    </div>
  );
}

function trapDialogFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), video[controls], [href], [tabindex]:not([tabindex='-1'])",
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
  desktopAspectRatio,
  mobileAspectRatio,
}: {
  media: MediaAsset;
  className?: string;
  priority?: boolean;
  desktopAspectRatio?: number;
  mobileAspectRatio?: number;
}) {
  const responsiveStyle = desktopAspectRatio || mobileAspectRatio ? {
    "--media-aspect-desktop": desktopAspectRatio,
    "--media-aspect-mobile": mobileAspectRatio ?? desktopAspectRatio,
  } as React.CSSProperties : undefined;
  if (media.src) {
    return (
      <figure className={`${styles.mediaFrame} ${className}`} style={responsiveStyle}>
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
      style={responsiveStyle}
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
      if (!block.eyebrow.trim() && !block.title.trim() && !block.body.trim()) return null;
      return (
        <section className={styles.textBlock} aria-labelledby={block.title.trim() ? `${block.id}-title` : undefined}>
          {block.eyebrow.trim() && <p>{block.eyebrow}</p>}
          {block.title.trim() && <h4 id={`${block.id}-title`}>{block.title}</h4>}
          {block.body.trim() && <div><p>{block.body}</p></div>}
        </section>
      );
    case "media-text":
      return (
        <section
          className={`${styles.mediaTextBlock} ${block.side === "right" ? styles.mediaRight : ""}`}
          aria-labelledby={block.title.trim() ? `${block.id}-title` : undefined}
        >
          <MediaFrame media={block.media} className={styles.detailMedia} desktopAspectRatio={4 / 3} mobileAspectRatio={4 / 3} />
          {(block.eyebrow.trim() || block.title.trim() || block.body.trim()) && <div className={styles.blockCopy}>
            {block.eyebrow.trim() && <p>{block.eyebrow}</p>}
            {block.title.trim() && <h4 id={`${block.id}-title`}>{block.title}</h4>}
            {block.body.trim() && <p>{block.body}</p>}
          </div>}
        </section>
      );
    case "gallery":
      return (
        <section className={styles.galleryBlock} aria-labelledby={block.title.trim() ? `${block.id}-title` : undefined}>
          {(block.eyebrow.trim() || block.title.trim()) && <header>
            {block.eyebrow.trim() && <p>{block.eyebrow}</p>}
            {block.title.trim() && <h4 id={`${block.id}-title`}>{block.title}</h4>}
          </header>}
          <div className={styles.galleryGrid} data-count={block.items.length} data-orientation={block.orientation}>
            {block.items.map((item) => <MediaFrame key={item.id} media={item} desktopAspectRatio={block.orientation === "landscape" ? 4 / 3 : 3 / 4} mobileAspectRatio={block.orientation === "landscape" ? 4 / 3 : 3 / 4} />)}
          </div>
        </section>
      );
    case "full-media":
      return (
        <section className={styles.fullMediaBlock}>
          <MediaFrame media={block.media} desktopAspectRatio={16 / 9} mobileAspectRatio={16 / 9} />
          {block.caption.trim() && <p>{block.caption}</p>}
        </section>
      );
  }
}

function ProjectDetails({ project }: { project: Project }) {
  const synopsis = trimVisibleText(project.synopsis);
  const year = trimVisibleText(project.year);
  const duration = trimVisibleText(project.duration);
  const challenge = trimVisibleText(project.challenge);
  const solution = trimVisibleText(project.solution);
  return (
    <div className={styles.projectDetails}>
      <section className={styles.projectIntro} aria-label={`${project.title}项目介绍`}>
        <div className={styles.introLead}>
          <p>PROJECT DETAILS</p>
          <h3 id={`${project.id}-project-heading`}>{project.title}</h3>
          {synopsis && <p className={styles.projectSynopsis}>{synopsis}</p>}
        </div>
        {(year || duration || challenge || solution) && <dl>
          {(year || duration) && <div><dt>年份 / 时长</dt><dd>{year}{year && duration && " · "}{duration}</dd></div>}
          {challenge && <div><dt>项目难点</dt><dd>{challenge}</dd></div>}
          {solution && <div><dt>解决思路</dt><dd>{solution}</dd></div>}
        </dl>}
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
  const year = trimVisibleText(project.year);
  const duration = trimVisibleText(project.duration);

  return (
    <article className={styles.project} data-project-id={project.id} data-open={isOpen} style={{ "--project-accent": category.accent } as React.CSSProperties}>
      <div className={styles.projectRail}>
        <span>{String(project.order).padStart(2, "0")}</span>
        <span>{category.label}</span>
        <span>{year}{year && duration && " · "}{duration}</span>
      </div>

      <ProjectCover project={project} category={category} isOpen={isOpen} onToggle={onToggle} onPlay={onPlay} />

      <div className={styles.detailReveal} data-open={isOpen} id={detailId} aria-hidden={!isOpen}>
        <div className={styles.detailRevealInner}>
          {isOpen && <ProjectDetails project={project} />}
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
  onAutoplayRejected,
  onPlaybackStarted,
}: {
  playback: Exclude<PlaybackState, null>;
  watermarkText: string;
  watermarkAppearance: PortfolioDocument["settings"]["videoWatermarkStyle"];
  onClose: () => void;
  onMediaError: (snapshot: { currentTime: number; shouldResume: boolean }) => void;
  onRetry: () => void;
  onAutoplayRejected: () => void;
  onPlaybackStarted: () => void;
}) {
  const { project, asset, status, error, restoreTime, shouldResume, autoplayRejected } = playback;
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [watermarkStarted, setWatermarkStarted] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  useScrollLock(true);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const pauseWhenHidden = () => {
      if (document.visibilityState === "hidden") video?.pause();
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", pauseWhenHidden);
      video?.pause();
    };
  }, []);

  function closeModal() {
    videoRef.current?.pause();
    onClose();
  }

  function tryManualPlayback() {
    const video = videoRef.current;
    if (!video) return;
    void video.play().then(onPlaybackStarted).catch(onAutoplayRejected);
  }

  return (
    <div
      className={styles.modal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="playback-title"
      onKeyDown={trapDialogFocus}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) closeModal();
      }}
    >
      <div className={styles.modalPanel}>
        <div className={styles.playerSurface}>
          {status === "ready" && asset.src ? (
            <video
              ref={videoRef}
              src={asset.src}
              controls
              autoPlay
              playsInline
              preload="metadata"
              onPlay={() => { onPlaybackStarted(); setWatermarkStarted(true); setVideoPlaying(true); }}
              onPause={() => setVideoPlaying(false)}
              onEnded={() => setVideoPlaying(false)}
              onLoadedMetadata={(event) => {
                if (typeof restoreTime === "number" && Number.isFinite(restoreTime)) {
                  event.currentTarget.currentTime = Math.min(restoreTime, event.currentTarget.duration || restoreTime);
                }
                if (shouldResume || event.currentTarget.autoplay) {
                  void event.currentTarget.play().then(onPlaybackStarted).catch(onAutoplayRejected);
                }
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
          {status === "ready" && asset.src && autoplayRejected && (
            <button className={styles.manualPlay} type="button" onClick={tryManualPlayback}>手动播放</button>
          )}
          {(status !== "ready" || !asset.src) && (
            <div className={styles.playerReady}>
              <span><PlayIcon /></span>
              <p>{status === "loading" ? "正在建立安全播放连接…" : error ?? "视频上传后在这里直接播放"}</p>
              {status === "error" && <button type="button" onClick={onRetry}>重新连接</button>}
            </div>
          )}
        </div>
        <h2 className={styles.srOnly} id="playback-title">{project.title}</h2>
        <button ref={closeRef} className={styles.modalClose} type="button" onClick={closeModal} aria-label="关闭播放器">
          <span aria-hidden="true">←</span>
        </button>
      </div>
    </div>
  );
}

export function PortfolioExperience({ initialPortfolio: portfolio, mode, embedded = false, initialPreviewTarget }: PortfolioExperienceProps) {
  const theme = portfolio.settings.activeTheme;
  const previewEntered = initialPreviewTarget?.kind === "project" || initialPreviewTarget?.kind === "end-cover";
  const [entered, setEntered] = useState(previewEntered);
  const expansionMode = portfolio.settings.expansionMode;
  const [openProjects, setOpenProjects] = useState<string[]>(initialPreviewTarget?.kind === "project" ? [initialPreviewTarget.projectId] : []);
  const [playback, setPlayback] = useState<PlaybackState>(null);
  const [contactOpen, setContactOpen] = useState(initialPreviewTarget?.kind === "contact");
  const playbackRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const playbackRequestIdRef = useRef(0);
  const playbackTriggerRef = useRef<HTMLButtonElement | null>(null);
  const playbackTriggerKeyRef = useRef<string | null>(null);
  const restorePlaybackFocusRef = useRef(false);
  const [contactReturnFocus, setContactReturnFocus] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (embedded) return;
    document.title = portfolio.settings.siteTitle;
  }, [embedded, portfolio.settings.siteTitle]);

  useEffect(() => {
    if (!initialPreviewTarget || initialPreviewTarget.kind === "contact") return;
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const selector = initialPreviewTarget.kind === "hero"
        ? initialPreviewTarget.slideId ? `[data-hero-slide-id="${CSS.escape(initialPreviewTarget.slideId)}"]` : "[data-hero-slide-index='0']"
        : initialPreviewTarget.kind === "project"
          ? `[data-project-id="${CSS.escape(initialPreviewTarget.projectId)}"]`
          : initialPreviewTarget.slideId ? `[data-end-cover-id="${CSS.escape(initialPreviewTarget.slideId)}"]` : "[data-end-cover-index='0']";
      document.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: "start" });
    }));
    return () => window.cancelAnimationFrame(frame);
  }, [initialPreviewTarget]);

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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePlayback();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
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
    const closing = openProjects.includes(projectId);
    if (playback && (playback.project.id === projectId || (!closing && expansionMode === "single"))) closePlayback();
    setOpenProjects((current) => {
      if (current.includes(projectId)) return current.filter((id) => id !== projectId);
      if (mode === "live") reportEvent("project_open", projectId, undefined, getPortfolioSessionId());
      return expansionMode === "single" ? [projectId] : [...current, projectId];
    });
    if (!closing) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        document.getElementById(`${projectId}-project-heading`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }));
    }
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
    if (!hasPlayableVideo(asset)) return;
    if (mode === "review") {
      const src = adminDraftVideoSource(asset);
      setPlayback(src
        ? { project, asset: { ...asset, src }, status: "ready", recoveryCount: 0, autoplayRejected: false }
        : { project, asset, status: "error", error: "草稿视频暂时无法读取，请保存草稿后重试", recoveryCount: 0, autoplayRejected: false });
      return;
    }
    if (asset.src) {
      setPlayback({ project, asset, status: "ready", recoveryCount: 0, autoplayRejected: false });
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
      autoplayRejected: false,
    });
    try {
      const response = await fetch("/api/playback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, version: "final", sessionId: getPortfolioSessionId() }),
        signal: request.controller.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw userFacingError("播放响应暂时无法读取，请稍后重试");
      }
      if (!response.ok) throw userFacingResponseError(body, "暂时无法播放这个版本");
      if (!isRecord(body) || typeof body.url !== "string" || !body.url.startsWith("/api/media/")) throw userFacingError("播放连接响应无效，请稍后重试");
      if (playbackRequestRef.current?.id !== request.id) return;
      setPlayback({
        project,
        asset: { ...asset, src: body.url },
        status: "ready",
        expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
        recoveryCount: recovery?.count ?? 0,
        restoreTime: recovery?.currentTime,
        shouldResume: recovery?.shouldResume,
        autoplayRejected: false,
      });
    } catch (error) {
      if (request.controller.signal.aborted || playbackRequestRef.current?.id !== request.id) return;
      const message = toUserFacingChineseError(error, "暂时无法播放这个版本，请检查网络后重试");
      setPlayback({ project, asset, status: "error", error: message, recoveryCount: recovery?.count ?? 0, autoplayRejected: false });
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
  const contactAvailable = hasContactContent(portfolio.hero, portfolio.settings.contact);
  const workHeadingLead = trimVisibleText(portfolio.settings.workHeading.lead);
  const workHeadingAccent = trimVisibleText(portfolio.settings.workHeading.accent);
  const workHeadingAvailable = Boolean(workHeadingLead || workHeadingAccent);
  const hasEndCover = portfolio.endCovers.enabled && portfolio.endCovers.slides.length > 0;

  function enterWorks() {
    setEntered(true);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.getElementById("works")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  const Root = embedded ? "div" : "main";
  return (
    <Root className={styles.demo} data-theme={theme} data-has-end-cover={hasEndCover ? "true" : "false"} data-embedded={embedded ? "true" : undefined} id={embedded ? undefined : "top"}>
      {customFontUrl && <style>{`@font-face{font-family:PortfolioCustom;src:url("${customFontUrl}");font-display:swap;}`}</style>}
      <HeroSequence
        hero={portfolio.hero}
        entered={entered}
        yearRange={yearRange}
        projectCount={portfolio.projects.length}
        onEnter={enterWorks}
        onExit={() => {
          setEntered(false);
          setOpenProjects([]);
          window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
        }}
        onContact={(trigger) => {
          setContactReturnFocus(trigger);
          setContactOpen(true);
        }}
        contactAvailable={contactAvailable}
      />

      <section className={styles.workSection} id="works" aria-labelledby={workHeadingAvailable ? "work-heading" : undefined} hidden={!entered}>
        {workHeadingAvailable && <header className={styles.workHeading}>
          <p>SELECTED WORK · {yearRange}</p>
          <h2 id="work-heading">{workHeadingLead}{workHeadingLead && workHeadingAccent && <br />}{workHeadingAccent && <span>{workHeadingAccent}</span>}</h2>
        </header>}

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

      <EndCoverSequence config={portfolio.endCovers} entered={entered} />

      <footer className={styles.footer} hidden={!entered}>
        <div>
          <span>PORTFOLIO / {yearRange}</span>
          <strong>{portfolio.hero.name}</strong>
        </div>
        {(trimVisibleText(portfolio.hero.role) || trimVisibleText(portfolio.hero.targetRole)) && <p>{trimVisibleText(portfolio.hero.role)}{trimVisibleText(portfolio.hero.role) && trimVisibleText(portfolio.hero.targetRole) && <br />}{trimVisibleText(portfolio.hero.targetRole)}</p>}
        {trimVisibleText(portfolio.hero.email) && <a href={`mailto:${trimVisibleText(portfolio.hero.email)}`}>{trimVisibleText(portfolio.hero.email)}</a>}
      </footer>

      {playback && (
        <PlaybackModal
          playback={playback}
          watermarkText={resolveWatermarkText(portfolio.settings.videoWatermarkText, portfolio.hero.name)}
          watermarkAppearance={portfolio.settings.videoWatermarkStyle}
          onClose={closePlayback}
          onMediaError={recoverPlayback}
          onRetry={() => void startPlayback(playback.project)}
          onAutoplayRejected={() => setPlayback((current) => current ? { ...current, autoplayRejected: true } : current)}
          onPlaybackStarted={() => setPlayback((current) => current ? { ...current, autoplayRejected: false } : current)}
        />
      )}
      {contactOpen && contactAvailable && <ContactDialog
        hero={portfolio.hero}
        contact={portfolio.settings.contact}
        onClose={() => setContactOpen(false)}
        returnFocus={contactReturnFocus}
      />}
    </Root>
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
