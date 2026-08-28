"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { MediaAsset, MediaCrop } from "../portfolio/model";
import { croppedImageStyle, fitCropToAspect, fullMediaCrop, normalizeMediaCrop, validAspect } from "../portfolio/media-crop";
import styles from "./admin.module.css";

type Handle = "move" | "nw" | "ne" | "sw" | "se";

export function MediaCropEditor({
  asset,
  previewSrc,
  fixedAspect,
  onConfirm,
}: {
  asset: MediaAsset;
  previewSrc?: string;
  fixedAspect?: number;
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
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    width: number;
    height: number;
    crop: MediaCrop;
  } | null>(null);

  function start(event: ReactPointerEvent<HTMLElement>, handle: Handle) {
    event.preventDefault();
    event.stopPropagation();
    const canvas = event.currentTarget.closest<HTMLElement>("[data-crop-canvas]");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { handle, startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height, crop: draft };
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = ((event.clientX - drag.startX) / drag.width) * 100;
    const dy = ((event.clientY - drag.startY) / drag.height) * 100;
    setDraft(resizeCrop(drag.crop, drag.handle, dx, dy, sourceAspect, fixedAspect));
  }

  function stop(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  const changed = !sameCrop(draft, asset.crop ?? initialCrop) || !asset.crop || !asset.sourceAspectRatio;
  const outputAspect = sourceAspect * (draft.width / draft.height);
  const previewAsset: MediaAsset = { ...asset, crop: draft, sourceAspectRatio: sourceAspect };

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
            ? <img src={previewSrc} alt="" style={{ ...croppedImageStyle(previewAsset, "contain"), opacity: 1 }} />
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
        <button className={styles.cropConfirm} type="button" disabled={!changed} onClick={() => {
          const confirmed = normalizeMediaCrop(draft);
          onConfirm(confirmed, sourceAspect);
          setDraft(confirmed);
          setEditing(false);
        }}>确认裁切</button>
      </div>
      <div className={styles.positionCanvas} data-crop-canvas style={{ aspectRatio: sourceAspect }}>
        {previewSrc
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={previewSrc} alt="" onLoad={(event) => {
            if (asset.sourceAspectRatio) return;
            const aspect = event.currentTarget.naturalWidth / event.currentTarget.naturalHeight;
            if (Number.isFinite(aspect) && aspect > 0) {
              setDetectedAspect(aspect);
              if (!asset.crop) setDraft(fixedAspect ? fitCropToAspect(aspect, fixedAspect) : fullMediaCrop());
            }
          }} />
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
            />
          ))}
        </div>
      </div>
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

function formatAspect(value: number) {
  return Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/u, "") + ":1" : "—";
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
