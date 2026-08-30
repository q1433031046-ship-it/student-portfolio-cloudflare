import type { CategoryConfig, Project } from "./model";
import { croppedImageStyle, croppedImageStyleForAspect } from "./media-crop";
import { ProjectCoverText } from "./project-cover-text";
import { hasPlayableVideo } from "./video-availability";
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
  return (
    <div className={styles.projectCover} data-cover-overlay={presentation.overlayMode}>
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
        <ProjectCoverText project={project} categoryLabel={category.label} accent={category.accent} />
        {hasPlayableVideo(project.finalVideo) && <button
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
        </button>}
      </div>
    </div>
  );
}

function ProjectArtwork({ project }: { project: Project }) {
  if (project.cover.src) {
    return (
      <figure className={styles.projectArtwork}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.projectArtworkDesktop} src={project.cover.src} alt={project.cover.alt} style={croppedImageStyle(project.cover)} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.projectArtworkMobile} src={project.cover.src} alt="" aria-hidden="true" style={croppedImageStyleForAspect(project.cover, 4 / 5)} />
      </figure>
    );
  }
  return <figure className={styles.projectArtwork} data-visual={project.cover.visualKey}><span /></figure>;
}
