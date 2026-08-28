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
  return (
    <div className={styles.projectCover} data-cover-overlay={presentation.overlayMode} style={{ aspectRatio: mediaCropAspect(project.cover, 16 / 9) }}>
      <ProjectArtwork project={project} />
      <button
        className={styles.coverToggle}
        type="button"
        aria-label={`${isOpen ? "收起" : "展开"}《${project.title}》项目详情`}
        aria-expanded={isOpen}
        aria-controls={detailId}
        onClick={onToggle}
      />
      <div className={styles.projectCoverInfo}>
        {presentation.showTitle && <div className={styles.projectTitleGroup} style={coverTextStyle(titleStyle)}>
          <span>{category.label}</span><h2>{project.title}</h2>
        </div>}
        {presentation.showSynopsis && <div className={styles.projectSynopsis} style={coverTextStyle(synopsisStyle)}>
          <span>项目介绍</span>
          <p>{project.synopsis}</p>
        </div>}
        {presentation.showFacts && <dl className={styles.projectFacts} style={coverTextStyle(factsStyle)}>
          <div><dt>年份 / 时长</dt><dd>{project.year} · {project.duration}</dd></div>
          <div><dt>项目难点</dt><dd>{project.challenge || "—"}</dd></div>
          <div><dt>解决思路</dt><dd>{project.solution || "—"}</dd></div>
        </dl>}
        <button
          className={styles.projectPlay}
          type="button"
          data-playback-trigger={`${project.id}:final`}
          aria-label={`播放《${project.title}》视频`}
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

function coverTextStyle(style: CoverTextStyle): React.CSSProperties {
  return {
    "--cover-x": `${style.x}%`,
    "--cover-y": `${style.y}%`,
    "--cover-width": `${style.width}%`,
    "--cover-scale": style.scale,
    textAlign: style.align,
    color: style.color === "system" ? undefined : style.color,
    fontFamily: style.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined,
  } as React.CSSProperties;
}
