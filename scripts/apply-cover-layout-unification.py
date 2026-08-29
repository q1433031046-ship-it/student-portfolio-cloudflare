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
        raise RuntimeError(f"missing replacement in {path}: {old[:160]!r}")
    write(path, content.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    content = read(path)
    updated, count = re.subn(pattern, lambda _match: replacement, content, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one regex replacement in {path}, found {count}: {pattern[:160]!r}")
    write(path, updated)


def append_once(path: str, marker: str, addition: str) -> None:
    content = read(path)
    if marker in content:
        return
    write(path, content.rstrip() + "\n\n" + addition.strip() + "\n")


admin = "app/admin/admin-client.tsx"
replace_once(
    admin,
    'import styles from "./admin.module.css";',
    'import styles from "./admin.module.css";\nimport portfolioStyles from "../demo/portfolio-demo.module.css";',
)

regex_once(
    admin,
    r'function CoverLayoutPreview\(.*?\n}\n\nfunction DirectText',
    '''function CoverLayoutPreview({ project, categoryLabel, update, updateStyle }: { project: Project; categoryLabel: string; update: (updater: (project: Project) => Project) => void; updateStyle: (key: "titleStyle" | "synopsisStyle" | "factsStyle", patch: Partial<CoverTextStyle>) => void }) {
  const defaults = createDefaultCoverPresentation();
  const previewSrc = useMediaPreview(project.cover);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [selected, setSelected] = useState<"titleStyle" | "synopsisStyle" | "factsStyle">("titleStyle");
  const [drag, setDrag] = useState<{ key: "titleStyle" | "synopsisStyle" | "factsStyle"; mode: "move" | "resize"; startX: number; startY: number; width: number; height: number; style: CoverTextStyle } | null>(null);
  const styleFor = (style: CoverTextStyle): React.CSSProperties => ({
    "--cover-x": `${style.x}%`,
    "--cover-y": `${style.y}%`,
    "--cover-width": `${style.width}%`,
    "--cover-scale": style.scale,
    textAlign: style.align,
    color: style.color === "system" ? undefined : style.color,
    fontFamily: style.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined,
  } as React.CSSProperties);
  function start(event: React.PointerEvent<HTMLElement>, key: "titleStyle" | "synopsisStyle" | "factsStyle", mode: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    const canvas = event.currentTarget.closest<HTMLElement>("[data-cover-canvas]");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const style = project.coverPresentation[key] ?? defaults[key];
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ key, mode, startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height, style });
    setSelected(key);
  }
  function movePointer(event: React.PointerEvent<HTMLElement>) {
    if (!drag) return;
    const dx = ((event.clientX - drag.startX) / drag.width) * 100;
    const dy = ((event.clientY - drag.startY) / drag.height) * 100;
    if (drag.mode === "move") {
      updateStyle(drag.key, { x: clamp(drag.style.x + dx, 0, 100 - drag.style.width), y: clamp(drag.style.y + dy, 0, 100) });
    } else {
      updateStyle(drag.key, { width: clamp(drag.style.width + dx, 10, 100 - drag.style.x), scale: clamp(drag.style.scale + dy / 18, .5, 2.5) });
    }
  }
  function stopPointer(event: React.PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  }
  function layerProps(key: "titleStyle" | "synopsisStyle" | "factsStyle") {
    return {
      "data-selected": selected === key,
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => start(event, key, "move"),
      onPointerMove: movePointer,
      onPointerUp: stopPointer,
      onPointerCancel: stopPointer,
    };
  }
  const category = categoryLabel.trim();
  const duration = project.duration !== "00:00" ? project.duration : "";
  const yearDuration = [project.year.trim(), duration].filter(Boolean).join(" · ");
  return (
    <>
      <div className={styles.coverPreviewMode} role="group" aria-label="封面预览尺寸">
        <button type="button" data-active={previewMode === "desktop"} onClick={() => setPreviewMode("desktop")}>桌面 16:9</button>
        <button type="button" data-active={previewMode === "mobile"} onClick={() => setPreviewMode("mobile")}>手机 4:5</button>
        <span>此画布与正式前台使用同一套字号、宽度和换行规则。</span>
      </div>
      <div
        className={`${styles.coverLayoutPreview} ${portfolioStyles.projectCover}`}
        data-cover-canvas
        data-cover-overlay="fixed"
        data-cover-preview={previewMode}
        style={{ aspectRatio: previewMode === "mobile" ? 4 / 5 : mediaCropAspect(project.cover, 16 / 9) }}
      >
        <figure className={portfolioStyles.projectArtwork}>
          {previewSrc
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={previewSrc} alt="" style={croppedImageStyle(project.cover)} />
            : <span className={styles.coverPreviewPlaceholder}>上传项目封面后在这里排版</span>}
        </figure>
        <div className={portfolioStyles.projectCoverInfo}>
          {project.coverPresentation.showTitle && <section {...layerProps("titleStyle")} className={`${portfolioStyles.projectTitleGroup} ${styles.coverPreviewLayer}`} style={styleFor(project.coverPresentation.titleStyle ?? defaults.titleStyle)}>
            {category && <span>{category}</span>}
            <h2><DirectText value={project.title} placeholder="双击填写作品名称" label="作品名称" onCommit={(title) => update((current) => ({ ...current, title }))} /></h2>
            <i className={styles.resizeHandle} onPointerDown={(event) => start(event, "titleStyle", "resize")} onPointerMove={movePointer} onPointerUp={stopPointer} />
          </section>}
          {project.coverPresentation.showSynopsis && <section {...layerProps("synopsisStyle")} className={`${portfolioStyles.projectSynopsis} ${styles.coverPreviewLayer}`} style={styleFor(project.coverPresentation.synopsisStyle ?? defaults.synopsisStyle)}>
            <span>项目介绍</span>
            <p><DirectText value={project.synopsis} placeholder="双击填写作品简介" label="作品简介" onCommit={(synopsis) => update((current) => ({ ...current, synopsis }))} /></p>
            <i className={styles.resizeHandle} onPointerDown={(event) => start(event, "synopsisStyle", "resize")} onPointerMove={movePointer} onPointerUp={stopPointer} />
          </section>}
          {project.coverPresentation.showFacts && <dl {...layerProps("factsStyle")} className={`${portfolioStyles.projectFacts} ${styles.coverPreviewLayer}`} style={styleFor(project.coverPresentation.factsStyle ?? defaults.factsStyle)}>
            <div><dt>年份 / 时长</dt><dd><DirectText value={yearDuration} placeholder="双击填写年份" label="年份" onCommit={(year) => update((current) => ({ ...current, year: year.split("·")[0]?.trim() ?? "" }))} /></dd></div>
            <div><dt>项目难点</dt><dd><DirectText value={project.challenge} placeholder="双击填写项目难点" label="项目难点" onCommit={(challenge) => update((current) => ({ ...current, challenge }))} /></dd></div>
            <div><dt>解决思路</dt><dd><DirectText value={project.solution} placeholder="双击填写解决思路" label="解决思路" onCommit={(solution) => update((current) => ({ ...current, solution }))} /></dd></div>
            <i className={styles.resizeHandle} onPointerDown={(event) => start(event, "factsStyle", "resize")} onPointerMove={movePointer} onPointerUp={stopPointer} />
          </dl>}
        </div>
      </div>
    </>
  );
}

function DirectText''',
)

regex_once(
    admin,
    r'function DirectText\(\{ value, label, onCommit, tag = "span" \}: \{ value: string; label: string; onCommit: \(value: string\) => void; tag\?: "span" \| "strong" \| "p" \| "small" \}\) \{.*?\n}\n\nfunction CoverStyleControls',
    '''function DirectText({ value, placeholder = "", label, onCommit, tag = "span" }: { value: string; placeholder?: string; label: string; onCommit: (value: string) => void; tag?: "span" | "strong" | "p" | "small" }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.focus();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editing]);
  const props = {
    ref: (node: HTMLElement | null) => { ref.current = node; },
    contentEditable: editing,
    suppressContentEditableWarning: true,
    role: "textbox",
    "aria-label": `双击修改${label}`,
    "data-editing": editing,
    "data-placeholder": !value && !editing,
    onDoubleClick: (event: React.MouseEvent<HTMLElement>) => { event.preventDefault(); event.stopPropagation(); setEditing(true); },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => { if (editing) event.stopPropagation(); },
    onBlur: (event: React.FocusEvent<HTMLElement>) => { setEditing(false); onCommit(event.currentTarget.textContent?.trim() ?? ""); },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (editing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.currentTarget.blur();
      }
      if (editing) event.stopPropagation();
    },
    children: editing ? value : value || placeholder,
  };
  if (tag === "strong") return <strong {...props} />;
  if (tag === "p") return <p {...props} />;
  if (tag === "small") return <small {...props} />;
  return <span {...props} />;
}

function CoverStyleControls''',
)

portfolio_css = "app/demo/portfolio-demo.module.css"
replace_once(
    portfolio_css,
    '''.projectCover {
  position: relative;''',
    '''.projectCover {
  position: relative;
  container-type: inline-size;''',
)
replace_once(
    portfolio_css,
    '.projectTitleGroup { position: absolute; top: var(--cover-y, clamp(28px, 8%, 76px)); left: var(--cover-x, clamp(24px, 3.4vw, 52px)); width: min(var(--cover-width, 62%), 760px); max-width: calc(100% - 48px); transform: translateY(-50%) scale(var(--cover-scale, 1)); transform-origin: left center; }',
    '.projectTitleGroup { position: absolute; top: var(--cover-y, 10%); left: var(--cover-x, 3%); width: min(var(--cover-width, 62%), calc(100% - 48px)); max-width: calc(100% - 48px); transform: translateY(-50%) scale(var(--cover-scale, 1)); transform-origin: left center; }',
)
replace_once(
    portfolio_css,
    '.projectTitleGroup h2 { margin: 20px 0 0; font-size: clamp(58px, 7vw, 112px); font-weight: 540; line-height: .84; letter-spacing: -.075em; }',
    '.projectTitleGroup h2 { margin: 1.4cqw 0 0; font-size: 7cqw; font-weight: 540; line-height: .84; letter-spacing: -.075em; }',
)
replace_once(
    portfolio_css,
    '.projectSynopsis { position: absolute; top: var(--cover-y, 63%); left: var(--cover-x, clamp(24px, 3.4vw, 52px)); width: min(var(--cover-width, 42%), 440px); max-width: calc(100% - 48px); padding: 16px 0 0; border-top: 1px solid rgba(255,255,255,.34); transform: translateY(-50%) scale(var(--cover-scale, 1)); transform-origin: left center; }',
    '.projectSynopsis { position: absolute; top: var(--cover-y, 63%); left: var(--cover-x, 3%); width: min(var(--cover-width, 42%), calc(100% - 48px)); max-width: calc(100% - 48px); padding: 1.15cqw 0 0; border-top: 1px solid rgba(255,255,255,.34); transform: translateY(-50%) scale(var(--cover-scale, 1)); transform-origin: left center; }',
)
replace_once(
    portfolio_css,
    '.projectSynopsis p { margin: 13px 0 0; color: rgba(245,245,243,.75); font-size: 12px; line-height: 1.75; }',
    '.projectSynopsis p { margin: .9cqw 0 0; color: rgba(245,245,243,.75); font-size: clamp(9px, .9cqw, 15px); line-height: 1.75; }',
)
replace_once(
    portfolio_css,
    '.projectFacts { position: absolute; top: var(--cover-y, 78%); left: var(--cover-x, clamp(24px, 3.4vw, 52px)); width: min(var(--cover-width, 72%), calc(100% - 48px)); max-width: calc(100% - 48px); margin: 0; display: grid; grid-template-columns: .55fr 1fr 1fr; border-top: 1px solid rgba(255,255,255,.3); transform: translateY(-50%) scale(var(--cover-scale, 1)); transform-origin: left center; }',
    '.projectFacts { position: absolute; top: var(--cover-y, 78%); left: var(--cover-x, 3%); width: min(var(--cover-width, 72%), calc(100% - 48px)); max-width: calc(100% - 48px); margin: 0; display: grid; grid-template-columns: .55fr 1fr 1fr; border-top: 1px solid rgba(255,255,255,.3); transform: translateY(-50%) scale(var(--cover-scale, 1)); transform-origin: left center; }',
)
replace_once(
    portfolio_css,
    '  .projectTitleGroup h2 { margin-top: 8px; font-size: clamp(40px, 13vw, 58px); }',
    '  .projectTitleGroup h2 { margin-top: 2cqw; font-size: 13cqw; }',
)
replace_once(
    portfolio_css,
    '  .projectSynopsis p { margin-top: 8px; font-size: 10px; line-height: 1.55; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }',
    '  .projectSynopsis p { margin-top: 2cqw; font-size: 2.7cqw; line-height: 1.55; }',
)
append_once(
    portfolio_css,
    '/* admin cover viewport parity */',
    '''/* admin cover viewport parity */
.projectCover[data-cover-preview="mobile"] {
  width: min(420px, 100%);
  aspect-ratio: 4 / 5;
  margin-inline: auto;
}
.projectCover[data-cover-preview="mobile"] .projectCoverInfo { display: block; padding: 20px; }
.projectCover[data-cover-preview="mobile"] .projectTitleGroup { top: var(--cover-y, 22px); left: var(--cover-x, 20px); width: min(var(--cover-width, calc(100% - 40px)), calc(100% - 40px)); max-width: calc(100% - 40px); }
.projectCover[data-cover-preview="mobile"] .projectTitleGroup h2 { margin-top: 2cqw; font-size: 13cqw; }
.projectCover[data-cover-preview="mobile"] .projectSynopsis { top: var(--cover-y, 63%); right: auto; bottom: auto; left: var(--cover-x, 20px); width: min(var(--cover-width, calc(100% - 40px)), calc(100% - 40px)); padding-top: 2cqw; }
.projectCover[data-cover-preview="mobile"] .projectSynopsis p { margin-top: 2cqw; font-size: 2.7cqw; line-height: 1.55; }
.projectCover[data-cover-preview="mobile"] .projectFacts { top: var(--cover-y, 78%); right: auto; bottom: auto; left: var(--cover-x, 20px); width: min(var(--cover-width, calc(100% - 40px)), calc(100% - 40px)); grid-template-columns: 1fr 1fr; }
.projectCover[data-cover-preview="mobile"] .projectFacts div:first-child { grid-column: 1 / -1; }
.projectCover[data-cover-preview="mobile"] .projectFacts div { padding-top: 8px; }
''',
)

admin_css = "app/admin/admin.module.css"
append_once(
    admin_css,
    '/* shared project-cover editing canvas */',
    '''/* shared project-cover editing canvas */
.coverPreviewMode {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin: 8px 0 0;
}
.coverPreviewMode button {
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  cursor: pointer;
}
.coverPreviewMode button[data-active="true"] {
  border-color: var(--accent);
  background: #eef1ff;
  color: #2447c6;
}
.coverPreviewMode span { margin-left: auto; color: var(--muted); font-size: 10px; }
.coverLayoutPreview { width: 100%; container-type: inline-size; }
.coverLayoutPreview .coverPreviewLayer {
  max-height: 68%;
  overflow: visible;
  pointer-events: auto;
  cursor: move;
  touch-action: none;
}
.coverPreviewLayer[data-selected="true"] {
  outline: 1px solid #8da4ff;
  outline-offset: 4px;
}
.coverPreviewLayer [data-placeholder="true"] {
  color: rgba(245,245,243,.58);
  font-style: normal;
}
.coverPreviewLayer > .resizeHandle {
  pointer-events: auto;
}
@media (max-width: 720px) {
  .coverPreviewMode span { width: 100%; margin-left: 0; }
}
''',
)

print("project-cover layout unification applied")
