"use client";

import { useEffect } from "react";

type ScrollLockSnapshot = {
  scrollX: number;
  scrollY: number;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflow: string;
};

let lockCount = 0;
let snapshot: ScrollLockSnapshot | null = null;

export function acquireScrollLock() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;
  const body = document.body;
  if (lockCount === 0) {
    snapshot = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `${-snapshot.scrollY}px`;
    body.style.left = `${-snapshot.scrollX}px`;
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount !== 0 || !snapshot) return;
    const restore = snapshot;
    snapshot = null;
    body.style.position = restore.position;
    body.style.top = restore.top;
    body.style.left = restore.left;
    body.style.right = restore.right;
    body.style.width = restore.width;
    body.style.overflow = restore.overflow;
    window.scrollTo({ left: restore.scrollX, top: restore.scrollY, behavior: "instant" });
  };
}

export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return acquireScrollLock();
  }, [active]);
}
