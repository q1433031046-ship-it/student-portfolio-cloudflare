import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { createDefaultCoverPresentation, type CoverTextStyle, type Project } from "./model";
import styles from "./project-cover-text.module.css";

export type CoverLayerKey = "titleStyle" | "synopsisStyle" | "factsStyle";
export type CoverTextKey = "title" | "synopsis" | "year" | "challenge" | "solution";
export type CoverViewport = "responsive" | "desktop" | "mobile";

type LayerProps = Omit<HTMLAttributes<HTMLElement>, "className" | "style">;

export function ProjectCoverText({
  project,
  categoryLabel,
  accent,
  viewport = "responsive",
  editor = false,
  layerProps,
  renderText,
  renderResizeHandle,
}: {
  project: Project;
  categoryLabel: string;
  accent?: string;
  viewport?: CoverViewport;
  editor?: boolean;
  layerProps?: (key: CoverLayerKey) => LayerProps;
  renderText?: (key: CoverTextKey, value: string) => ReactNode;
  renderResizeHandle?: (key: CoverLayerKey) => ReactNode;
}) {
  const presentation = project.coverPresentation;
  const defaults = createDefaultCoverPresentation();
  const text = (key: CoverTextKey, value: string) => renderText?.(key, value) ?? value;

  return (
    <div
      className={styles.root}
      data-cover-text-root
      data-cover-viewport={viewport}
      data-cover-editor={editor ? "true" : "false"}
      style={{ "--project-accent": accent } as CSSProperties}
    >
      {presentation.showTitle && (
        <section
          {...layerProps?.("titleStyle")}
          className={`${styles.layer} ${styles.title}`}
          data-cover-layer="titleStyle"
          style={coverTextStyle(presentation.titleStyle ?? defaults.titleStyle)}
        >
          <span>{categoryLabel}</span>
          <h2>{text("title", project.title)}</h2>
          {renderResizeHandle?.("titleStyle")}
        </section>
      )}
      {presentation.showSynopsis && project.synopsis.trim() && (
        <section
          {...layerProps?.("synopsisStyle")}
          className={`${styles.layer} ${styles.synopsis}`}
          data-cover-layer="synopsisStyle"
          style={coverTextStyle(presentation.synopsisStyle ?? defaults.synopsisStyle)}
        >
          <span>项目介绍</span>
          <p>{text("synopsis", project.synopsis)}</p>
          {renderResizeHandle?.("synopsisStyle")}
        </section>
      )}
      {presentation.showFacts && (
        <dl
          {...layerProps?.("factsStyle")}
          className={`${styles.layer} ${styles.facts}`}
          data-cover-layer="factsStyle"
          style={coverTextStyle(presentation.factsStyle ?? defaults.factsStyle)}
        >
          {(project.year || project.duration) && <div><dt>年份 / 时长</dt><dd>{project.year && text("year", project.year)}{project.year && project.duration && " · "}{project.duration}</dd></div>}
          {project.challenge.trim() && <div><dt>项目难点</dt><dd>{text("challenge", project.challenge)}</dd></div>}
          {project.solution.trim() && <div><dt>解决思路</dt><dd>{text("solution", project.solution)}</dd></div>}
          {renderResizeHandle?.("factsStyle")}
        </dl>
      )}
    </div>
  );
}

export function coverTextStyle(style: CoverTextStyle): CSSProperties {
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
