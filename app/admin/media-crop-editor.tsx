"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { MediaAsset, MediaCrop } from "../portfolio/model";
import { fitCropToAspect, fullMediaCrop, normalizeMediaCrop, validAspect } from "../portfolio/media-crop";
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

  return (
    <div className={styles.positionEditor}>
      <div className={styles.cropToolbar}>
        <span>{fixedAspect ? `固定比例 ${formatAspect(fixedAspect)}` : `自由比例 ${formatAspect(outputAspect)}`}</span>
        <button type="button" onClick={() => setDraft(fixedAspect ? fitCropToAspect(sourceAspect, fixedAspect) : fullMediaCrop())}>重置裁切</button>
        <button className={styles.cropConfirm} type="button" disabled={!changed} onClick={() => onConfirm(normalizeMediaCrop(draft), sourceAspect)}>确认裁切</button>
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
      <small>拖动虚线框改变位置，拖动四角改变大小{fixedAspect ? "（比例保持不变）" : "和比例"}；确认后才写入草稿。</small>
    </div>
  );
}

function resizeCrop(crop: MediaCrop, handle: Handle, dx: number, dy: number, sourceAspect: number, fixedAspect?: number) {
  if (handle === "move") return normalizeMediaCrop({ ...crop, x: crop.x + dx, y: crop.y + dy });

  const left = handle === "nw" || handle === "sw";
  const top = handle === "nw" || handle === "ne";
  let x = left ? crop.x + dx : crop.x;
  let y = top ? crop.y + dy : crop.y;
  let width = left ? crop.width - dx : crop.width + dx;
  let height = top ? crop.height - dy : crop.height + dy;

  if (fixedAspect) {
    const percentRatio = fixedAspect / sourceAspect;
    const widthFromHeight = height * percentRatio;
    if (Math.abs(widthFromHeight - crop.width) > Math.abs(width - crop.width)) width = widthFromHeight;
    height = width / percentRatio;
    if (left) x = crop.x + crop.width - width;
    if (top) y = crop.y + crop.height - height;
  }

  return normalizeMediaCrop({ x, y, width, height });
}

function sameCrop(a: MediaCrop, b: MediaCrop) {
  return ["x", "y", "width", "height"].every((key) => Math.abs(a[key as keyof MediaCrop] - b[key as keyof MediaCrop]) < 0.01);
}

function formatAspect(value: number) {
  return Number.isFinite(value) ? value.toFixed(2).replace(/\.00$/u, "") + ":1" : "—";
}
