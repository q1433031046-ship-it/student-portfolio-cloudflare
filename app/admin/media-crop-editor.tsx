"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { MediaAsset, MediaCrop } from "../portfolio/model";
import { croppedImageStyle, fitCropToAspect, fullMediaCrop, normalizeMediaCrop, validAspect } from "../portfolio/media-crop";
import styles from "./admin.module.css";
import { MobileEditorSheet } from "./mobile-editor-sheet";

type Handle = "move" | "nw" | "ne" | "sw" | "se";

export function MediaCropEditor({
  asset,
  previewSrc,
  fixedAspect,
  onPreviewLoad,
  onPreviewError,
  onConfirm,
}: {
  asset: MediaAsset;
  previewSrc?: string;
  fixedAspect?: number;
  onPreviewLoad?: () => void;
  onPreviewError?: () => void;
  onConfirm: (crop: MediaCrop, sourceAspectRatio: number) => void;
}) {
  const [detectedAspect, setDetectedAspect] = useState<number | undefined>();
  const sourceAspect = validAspect(asset.sourceAspectRatio ?? detectedAspect, fixedAspect ?? 16 / 9);
  const initialCrop = useMemo(
    () => asset.crop ?? (fixedAspect ? fitCropToAspect(sourceAspect, fixedAspect) : fullMediaCrop()),
    [asset.crop, fixedAspect, sourceAspect],
  );
  const [draft, setDraft] = useState(initialCrop);
  const [editing, setEditing] = useState(!asset.crop || !asset.sourceAspectRatio);
  const [mobileViewport, setMobileViewport] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileSnapshotRef = useRef(initialCrop);
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    width: number;
    height: number;
    crop: MediaCrop;
  } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; crop: MediaCrop } | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function start(event: ReactPointerEvent<HTMLElement>, handle: Handle) {
    event.preventDefault();
    event.stopPropagation();
    const canvas = event.currentTarget.closest<HTMLElement>("[data-crop-canvas]");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2) {
      pinchRef.current = { distance: pointerDistance(pointersRef.current), crop: draft };
      dragRef.current = null;
      return;
    }
    dragRef.current = { handle, startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height, crop: draft };
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchRef.current && pointersRef.current.size >= 2) {
      event.preventDefault();
      const distance = pointerDistance(pointersRef.current);
      if (distance > 0) setDraft(scaleCrop(pinchRef.current.crop, pinchRef.current.distance / distance, sourceAspect, fixedAspect));
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const dx = ((event.clientX - drag.startX) / drag.width) * 100;
    const dy = ((event.clientY - drag.startY) / drag.height) * 100;
    setDraft(resizeCrop(drag.crop, drag.handle, dx, dy, sourceAspect, fixedAspect));
  }

  function stop(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    dragRef.current = null;
  }

  function openMobileEditor() {
    mobileSnapshotRef.current = draft;
    setEditing(true);
    setMobileOpen(true);
  }

  function cancelMobileEditor() {
    pointersRef.current.clear();
    pinchRef.current = null;
    dragRef.current = null;
    setDraft(mobileSnapshotRef.current);
    setMobileOpen(false);
    setEditing(false);
  }

  function confirmCrop() {
    const confirmed = normalizeMediaCrop(draft);
    onConfirm(confirmed, sourceAspect);
    setDraft(confirmed);
    setEditing(false);
    setMobileOpen(false);
  }

  const changed = !sameCrop(draft, asset.crop ?? initialCrop) || !asset.crop || !asset.sourceAspectRatio;
  const outputAspect = sourceAspect * (draft.width / draft.height);
  const previewAsset: MediaAsset = { ...asset, crop: draft, sourceAspectRatio: sourceAspect };

  const editCanvas = (mobile = false) => (
    <div className={`${styles.positionCanvas} ${mobile ? styles.mobileCropCanvas : ""}`} data-crop-canvas style={{ aspectRatio: sourceAspect }}>
      {previewSrc
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={previewSrc} alt="" onLoad={(event) => {
          onPreviewLoad?.();
          if (asset.sourceAspectRatio) return;
          const aspect = event.currentTarget.naturalWidth / event.currentTarget.naturalHeight;
          if (Number.isFinite(aspect) && aspect > 0) {
            setDetectedAspect(aspect);
            if (!asset.crop) setDraft(fixedAspect ? fitCropToAspect(aspect, fixedAspect) : fullMediaCrop());
          }
        }} onError={onPreviewError} />
        : <span>上传图片后调整裁切</span>}
      <div
        className={styles.cropFrame}
        style={{ left: `${draft.x}%`, top: `${draft.y}%`, width: `${draft.width}%`, height: `${draft.height}%` }}
        role="group"
        aria-label={`${asset.label || "图片"}裁切区域`}
        onPointerDown={(event) => start(event, "move")}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
      >
        {(["nw", "ne", "sw", "se"] as const).map((handle) => (
          <i
            key={handle}
            className={styles.cropHandle}
            data-handle={handle}
            onPointerDown={(event) => start(event, handle)}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerCancel={stop}
            onLostPointerCapture={stop}
          />
        ))}
      </div>
    </div>
  );

  if (mobileViewport) {
    return (
      <div className={styles.positionEditor}>
        <div className={styles.cropToolbar}>
          <span>{asset.crop ? `已确认 · ${fixedAspect ? `固定比例 ${formatAspect(fixedAspect)}` : `自由比例 ${formatAspect(outputAspect)}`}` : "图片需要确认裁切"}</span>
          <button type="button" onClick={openMobileEditor}>{asset.crop ? "调整裁切" : "打开裁切"}</button>
        </div>
        <div className={styles.positionCanvas} style={{ aspectRatio: outputAspect }}>
          {previewSrc
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={previewSrc} alt="" onLoad={onPreviewLoad} onError={onPreviewError} style={{ ...croppedImageStyle(previewAsset, "contain"), opacity: 1 }} />
            : <span>上传图片后调整裁切</span>}
        </div>
        <small>手机上会在全屏编辑器中调整，不会因滑动页面误改裁切。</small>
        <MobileEditorSheet open={mobileOpen} title="调整图片裁切" dirty={changed} onCancel={cancelMobileEditor} onConfirm={confirmCrop}>
          <div className={styles.mobileCropTools} role="group" aria-label="裁切缩放">
            <button type="button" onClick={() => setDraft((current) => scaleCrop(current, 1.12, sourceAspect, fixedAspect))} aria-label="缩小图片">−</button>
            <button type="button" onClick={() => setDraft(fixedAspect ? fitCropToAspect(sourceAspect, fixedAspect) : fullMediaCrop())}>重置</button>
            <button type="button" onClick={() => setDraft((current) => scaleCrop(current, .88, sourceAspect, fixedAspect))} aria-label="放大图片">＋</button>
          </div>
          <div className={styles.mobileCropStage}>{editCanvas(true)}</div>
          <p className={styles.mobileCropHint}>单指拖动裁切区域，拖动四角改变大小；也可以双指或使用 ＋/− 缩放。只有点击“确认”才会写入草稿。</p>
        </MobileEditorSheet>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className={styles.positionEditor}>
        <div className={styles.cropToolbar}>
          <span>已确认 · {fixedAspect ? `固定比例 ${formatAspect(fixedAspect)}` : `自由比例 ${formatAspect(outputAspect)}`}</span>
          <button type="button" onClick={() => setEditing(true)}>调整裁切</button>
        </div>
        <div className={styles.positionCanvas} style={{ aspectRatio: outputAspect }}>
          {previewSrc
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={previewSrc} alt="" onLoad={onPreviewLoad} onError={onPreviewError} style={{ ...croppedImageStyle(previewAsset, "contain"), opacity: 1 }} />
            : <span>上传图片后调整裁切</span>}
        </div>
        <small>裁切框已隐藏；需要再次修改时点击“调整裁切”。</small>
      </div>
    );
  }

  return (
    <div className={styles.positionEditor}>
      <div className={styles.cropToolbar}>
        <span>{fixedAspect ? `固定比例 ${formatAspect(fixedAspect)}` : `自由比例 ${formatAspect(outputAspect)}`}</span>
        <button type="button" onClick={() => setDraft(fixedAspect ? fitCropToAspect(sourceAspect, fixedAspect) : fullMediaCrop())}>重置裁切</button>
        <button className={styles.cropConfirm} type="button" disabled={!changed} onClick={confirmCrop}>确认裁切</button>
      </div>
      {editCanvas()}
      <small>拖动虚线框改变位置，拖动四角改变大小{fixedAspect ? "（比例保持不变）" : "和比例"}；确认后虚线框会隐藏。</small>
    </div>
  );
}

function resizeCrop(crop: MediaCrop, handle: Handle, dx: number, dy: number, sourceAspect: number, fixedAspect?: number) {
  if (handle === "move") return normalizeMediaCrop({ ...crop, x: crop.x + dx, y: crop.y + dy });

  const left = handle === "nw" || handle === "sw";
  const top = handle === "nw" || handle === "ne";

  if (fixedAspect) {
    const percentRatio = fixedAspect / sourceAspect;
    const widthFromHorizontalMove = left ? crop.width - dx : crop.width + dx;
    const heightFromVerticalMove = top ? crop.height - dy : crop.height + dy;
    const widthFromVerticalMove = heightFromVerticalMove * percentRatio;
    let width = Math.abs(dx) >= Math.abs(dy) ? widthFromHorizontalMove : widthFromVerticalMove;

    const horizontalLimit = left ? crop.x + crop.width : 100 - crop.x;
    const verticalLimit = (top ? crop.y + crop.height : 100 - crop.y) * percentRatio;
    const aspectLimit = Math.min(100, 100 * percentRatio);
    const maxWidth = Math.max(0.001, Math.min(horizontalLimit, verticalLimit, aspectLimit));
    const requestedMinWidth = Math.max(5, 5 * percentRatio);
    const minWidth = Math.min(requestedMinWidth, maxWidth);
    width = clampNumber(width, minWidth, maxWidth);
    const height = width / percentRatio;
    const x = left ? crop.x + crop.width - width : crop.x;
    const y = top ? crop.y + crop.height - height : crop.y;
    return normalizeMediaCrop({ x, y, width, height });
  }

  const x = left ? crop.x + dx : crop.x;
  const y = top ? crop.y + dy : crop.y;
  const width = left ? crop.width - dx : crop.width + dx;
  const height = top ? crop.height - dy : crop.height + dy;
  return normalizeMediaCrop({ x, y, width, height });
}

function sameCrop(a: MediaCrop, b: MediaCrop) {
  return ["x", "y", "width", "height"].every((key) => Math.abs(a[key as keyof MediaCrop] - b[key as keyof MediaCrop]) < 0.01);
}

function pointerDistance(pointers: ReadonlyMap<number, { x: number; y: number }>) {
  const [first, second] = Array.from(pointers.values());
  if (!first || !second) return 0;
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function scaleCrop(crop: MediaCrop, factor: number, sourceAspect: number, fixedAspect?: number) {
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  let width = Math.max(5, Math.min(100, crop.width * factor));
  let height = Math.max(5, Math.min(100, crop.height * factor));
  if (fixedAspect) {
    const percentRatio = fixedAspect / sourceAspect;
    width = Math.min(width, 100 * percentRatio, 100);
    height = width / percentRatio;
    if (height > 100) {
      height = 100;
      width = height * percentRatio;
    }
  }
  return normalizeMediaCrop({ x: centerX - width / 2, y: centerY - height / 2, width, height });
}

function formatAspect(value: number) {
  return Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/u, "") + ":1" : "—";
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
