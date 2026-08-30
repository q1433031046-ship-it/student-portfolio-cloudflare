"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { EndCoverSlide, HeroLayer } from "../portfolio/model";
import { clampHeroLayer, keyboardMoveDelta, moveHeroLayer, resizeHeroLayer } from "../portfolio/hero-layout";
import { croppedImageStyle } from "../portfolio/media-crop";
import { shouldFinishInlineEditing } from "./inline-editing";
import styles from "./admin.module.css";

const labels: Record<HeroLayer["kind"], string> = {
  identity: "封底标题",
  statement: "封底说明",
  facts: "补充信息",
};

export function EndCoverLayoutEditor({
  slide,
  customFontReady,
  onChange,
}: {
  slide: EndCoverSlide;
  customFontReady: boolean;
  onChange: (slide: EndCoverSlide) => void;
}) {
  const [selectedId, setSelectedId] = useState(slide.layers[0]?.id ?? "");
  const dragRef = useRef<{ id: string; mode: "move" | "resize"; startX: number; startY: number; layer: HeroLayer; width: number; height: number } | null>(null);

  function updateLayer(id: string, updater: (layer: HeroLayer) => HeroLayer) {
    onChange({ ...slide, layers: slide.layers.map((layer) => layer.id === id ? updater(layer) : layer) });
  }

  function updateText(patch: Partial<Pick<EndCoverSlide, "title" | "statement" | "details">>) {
    onChange({ ...slide, ...patch });
  }

  function startPointer(event: ReactPointerEvent<HTMLElement>, layer: HeroLayer, mode: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    const canvas = event.currentTarget.closest<HTMLElement>("[data-end-cover-layout-canvas]");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: layer.id, mode, startX: event.clientX, startY: event.clientY, layer, width: rect.width, height: rect.height };
    setSelectedId(layer.id);
  }

  function movePointer(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = ((event.clientX - drag.startX) / drag.width) * 100;
    const dy = ((event.clientY - drag.startY) / drag.height) * 100;
    updateLayer(drag.id, () => drag.mode === "move" ? moveHeroLayer(drag.layer, dx, dy) : resizeHeroLayer(drag.layer, dx));
  }

  function stopPointer(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  function keyboardMove(event: KeyboardEvent<HTMLElement>, layer: HeroLayer) {
    const delta = keyboardMoveDelta(event.key, event.shiftKey);
    if (!delta) return;
    event.preventDefault();
    updateLayer(layer.id, (current) => moveHeroLayer(current, delta.x, delta.y));
  }

  return (
    <div className={styles.layoutEditor} data-end-cover-editor>
      <div className={styles.previewDeviceSwitch} aria-label="封底预览尺寸"><span>桌面预览 · 16:9</span></div>
      <div className={`${styles.layoutCanvas} ${styles.endCoverLayoutCanvas}`} data-layout-canvas data-end-cover-layout-canvas style={{ aspectRatio: 16 / 9 }}>
        {slide.media.src
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={slide.media.src} alt="" style={croppedImageStyle(slide.media, "contain")} />
          : <div className={styles.layoutPlaceholder}>上传封底图片后在这里排版</div>}
        {slide.layers.filter((layer) => layer.visible).map((layer) => (
          <div
            key={layer.id}
            className={styles.layoutLayer}
            data-selected={selectedId === layer.id}
            data-kind={layer.kind}
            style={{
              left: `${layer.x}%`, top: `${layer.y}%`, width: `${layer.width}%`, zIndex: layer.zIndex,
              textAlign: layer.align, fontSize: `${layer.scale}em`,
              color: layer.color === "system" ? undefined : layer.color,
              fontFamily: layer.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined,
            }}
            role="button"
            tabIndex={0}
            aria-label={`移动${labels[layer.kind]}`}
            onKeyDown={(event) => keyboardMove(event, layer)}
            onPointerDown={(event) => startPointer(event, layer, "move")}
            onPointerMove={movePointer}
            onPointerUp={stopPointer}
            onPointerCancel={stopPointer}
          >
            {layer.kind === "identity" && <InlineEditable tag="strong" value={slide.title || "双击填写封底标题"} placeholder={!slide.title} ariaLabel="封底标题" onCommit={(title) => updateText({ title })} />}
            {layer.kind === "statement" && <InlineEditable value={slide.statement || "双击填写封底说明"} placeholder={!slide.statement} ariaLabel="封底说明" onCommit={(statement) => updateText({ statement })} />}
            {layer.kind === "facts" && <InlineEditable tag="small" value={slide.details || "双击填写补充信息"} placeholder={!slide.details} ariaLabel="补充信息" onCommit={(details) => updateText({ details })} />}
            <i className={styles.resizeHandle} aria-hidden="true" onPointerDown={(event) => startPointer(event, layer, "resize")} onPointerMove={movePointer} onPointerUp={stopPointer} onPointerCancel={stopPointer} />
          </div>
        ))}
      </div>
      <p className={styles.layoutHint}>拖动文字改变位置，拖动右下角改变大小；双击文字可编辑，Enter 换行，Ctrl/⌘ + Enter 完成。</p>
      <div className={styles.layerControls}>
        {slide.layers.map((layer) => (
          <article key={layer.id} data-selected={selectedId === layer.id}>
            <button type="button" onClick={() => setSelectedId(layer.id)}>{labels[layer.kind]}</button>
            <label><input type="checkbox" checked={layer.visible} onChange={(event) => updateLayer(layer.id, (current) => ({ ...current, visible: event.target.checked }))} />显示</label>
            <select value={layer.align} aria-label={`${labels[layer.kind]}对齐`} onChange={(event) => updateLayer(layer.id, (current) => ({ ...current, align: event.target.value as HeroLayer["align"] }))}>
              <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option>
            </select>
            <select value={layer.fontFamily} aria-label={`${labels[layer.kind]}字体`} onChange={(event) => updateLayer(layer.id, (current) => ({ ...current, fontFamily: event.target.value as HeroLayer["fontFamily"] }))}>
              <option value="system">系统字体</option><option value="custom" disabled={!customFontReady}>自定义字体</option>
            </select>
            <div className={styles.layerColor}>
              <select value={layer.color === "system" ? "system" : "custom"} aria-label={`${labels[layer.kind]}颜色模式`} onChange={(event) => updateLayer(layer.id, (current) => ({ ...current, color: event.target.value === "system" ? "system" : current.color === "system" ? "#ffffff" : current.color }))}>
                <option value="system">主题色</option><option value="custom">自选色</option>
              </select>
              {layer.color !== "system" && <input type="color" value={layer.color} aria-label={`${labels[layer.kind]}自选颜色`} onChange={(event) => updateLayer(layer.id, (current) => ({ ...current, color: event.target.value as `#${string}` }))} />}
            </div>
            <input type="range" min="0.5" max="2.5" step="0.1" value={layer.scale} aria-label={`${labels[layer.kind]}字号`} onChange={(event) => updateLayer(layer.id, (current) => clampHeroLayer({ ...current, scale: Number(event.target.value) }))} />
          </article>
        ))}
      </div>
    </div>
  );
}

function InlineEditable({ value, placeholder, ariaLabel, onCommit, tag = "span" }: { value: string; placeholder: boolean; ariaLabel: string; onCommit: (value: string) => void; tag?: "span" | "strong" | "small" }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editing]);
  const props = {
    ref: (node: HTMLElement | null) => { ref.current = node; },
    contentEditable: editing,
    suppressContentEditableWarning: true,
    role: "textbox",
    "aria-label": `双击修改${ariaLabel}`,
    "data-editing": editing,
    "data-placeholder": placeholder,
    onDoubleClick: (event: React.MouseEvent<HTMLElement>) => { event.preventDefault(); event.stopPropagation(); setEditing(true); },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => { if (editing) event.stopPropagation(); },
    onBlur: (event: React.FocusEvent<HTMLElement>) => { setEditing(false); onCommit(placeholder && event.currentTarget.innerText === value ? "" : normalizeEditableText(event.currentTarget.innerText)); },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (editing && shouldFinishInlineEditing(event.nativeEvent)) { event.preventDefault(); event.currentTarget.blur(); } if (editing) event.stopPropagation(); },
    children: value,
  };
  if (tag === "strong") return <strong {...props} />;
  if (tag === "small") return <small {...props} />;
  return <span {...props} />;
}

function normalizeEditableText(value: string) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n{3,}/gu, "\n\n").trim();
}
