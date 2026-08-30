"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PortfolioDocument } from "../portfolio/model";
import { PortfolioExperience } from "../portfolio/portfolio-experience";
import type { PortfolioPreviewTarget } from "../portfolio/preview-target";
import { useScrollLock } from "../lib/use-scroll-lock";
import styles from "./admin.module.css";

export type { PortfolioPreviewTarget } from "../portfolio/preview-target";

type InertElement = HTMLElement & { inert: boolean };

export function MobilePortfolioPreview({ open, portfolio, target, onClose }: { open: boolean; portfolio: PortfolioDocument; target: PortfolioPreviewTarget; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useScrollLock(open);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const adminRoot = document.querySelector<InertElement>("[data-admin-root]");
    const previousInert = adminRoot?.inert ?? false;
    const previousHidden = adminRoot?.getAttribute("aria-hidden") ?? null;
    if (adminRoot) {
      adminRoot.inert = true;
      adminRoot.setAttribute("aria-hidden", "true");
    }
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key === "Tab" && dialogRef.current) trapFocus(event, dialogRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      if (adminRoot) {
        adminRoot.inert = previousInert;
        if (previousHidden === null) adminRoot.removeAttribute("aria-hidden");
        else adminRoot.setAttribute("aria-hidden", previousHidden);
      }
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={dialogRef} className={styles.mobilePreviewOverlay} data-mobile-portfolio-preview role="dialog" aria-modal="true" aria-labelledby="mobile-preview-title">
      <header>
        <div><span>READ ONLY</span><strong id="mobile-preview-title">手机最终效果</strong></div>
        <button ref={closeRef} type="button" onClick={onClose}>关闭</button>
      </header>
      <div className={styles.mobilePreviewViewport} onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest("a")) event.preventDefault();
      }}>
        <PortfolioExperience initialPortfolio={portfolio} mode="review" embedded initialPreviewTarget={target} />
      </div>
    </div>,
    document.body,
  );
}

function trapFocus(event: KeyboardEvent, root: HTMLElement) {
  const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), video[controls], [href], [tabindex]:not([tabindex="-1"])'));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
