"use client";

import { useEffect, useState } from "react";

export type VisualViewportState = {
  height: number;
  offsetTop: number;
  keyboardInset: number;
};

function readVisualViewport(): VisualViewportState {
  if (typeof window === "undefined") return { height: 0, offsetTop: 0, keyboardInset: 0 };
  const viewport = window.visualViewport;
  const height = Math.max(0, Math.round(viewport?.height ?? window.innerHeight));
  const offsetTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
  const layoutHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
  return {
    height,
    offsetTop,
    keyboardInset: viewport ? Math.max(0, Math.round(layoutHeight - height - offsetTop)) : 0,
  };
}

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => readVisualViewport());

  useEffect(() => {
    let frame: number | null = null;
    const update = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const next = readVisualViewport();
        setState((current) => current.height === next.height
          && current.offsetTop === next.offsetTop
          && current.keyboardInset === next.keyboardInset
          ? current
          : next);
      });
    };
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return state;
}
