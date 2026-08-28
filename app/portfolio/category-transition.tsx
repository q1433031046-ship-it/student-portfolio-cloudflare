import type { CategoryConfig } from "./model";
import type { CSSProperties } from "react";
import styles from "../demo/portfolio-demo.module.css";
import { croppedImageStyle, mediaCropAspect } from "./media-crop";

export function CategoryTransition({
  categories,
  current,
  projectCounts,
}: {
  categories: CategoryConfig[];
  current: CategoryConfig;
  projectCounts: Record<string, number>;
}) {
  if (!current.transition.visible) return null;
  if (current.transition.mode === "image" && current.transition.media.src) {
    return (
      <header className={styles.customTransition} style={{ aspectRatio: mediaCropAspect(current.transition.media, 8) }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.transition.media.src} alt={current.transition.media.alt || `${current.label}模块过渡图`} style={croppedImageStyle(current.transition.media)} />
        <h2 className={styles.srOnly}>{current.label}</h2>
      </header>
    );
  }
  return (
    <header className={styles.defaultTransition}>
      <ModuleLinks categories={categories} current={current} projectCounts={projectCounts} />
    </header>
  );
}

function ModuleLinks({
  categories,
  current,
  projectCounts,
}: {
  categories: CategoryConfig[];
  current: CategoryConfig;
  projectCounts: Record<string, number>;
}) {
  return (
    <nav className={styles.moduleLinks} aria-label="作品模块">
      {categories.map((category, index) => (
        <a
          key={category.id}
          href={`#category-${category.id}`}
          aria-current={category.id === current.id ? "true" : undefined}
          style={{ "--module-accent": category.accent } as CSSProperties}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{category.label}</strong>
          <small>{String(projectCounts[category.id] ?? 0).padStart(2, "0")} 项</small>
        </a>
      ))}
    </nav>
  );
}
