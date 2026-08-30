"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useScrollLock } from "../lib/use-scroll-lock";
import styles from "./admin.module.css";

export type MobileEditorSheetProps = {
  open: boolean;
  title: string;
  dirty: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
};

type InertElement = HTMLElement & { inert: boolean };

export function MobileEditorSheet({ open, title, dirty, onCancel, onConfirm, children }: MobileEditorSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  useScrollLock(open);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    const adminRoot = document.querySelector<InertElement>("[data-admin-root]");
    const previousInert = adminRoot?.inert ?? false;
    const previousHidden = adminRoot?.getAttribute("aria-hidden") ?? null;
    if (adminRoot) {
      adminRoot.inert = true;
      adminRoot.setAttribute("aria-hidden", "true");
    }
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
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
    <div className={styles.mobileEditorBackdrop} data-mobile-editor-sheet onMouseDown={(event) => { if (event.currentTarget === event.target) onCancel(); }}>
      <section ref={dialogRef} className={styles.mobileEditorSheet} role="dialog" aria-modal="true" aria-labelledby="mobile-editor-title">
        <header>
          <button ref={cancelRef} type="button" onClick={onCancel}>取消</button>
          <h2 id="mobile-editor-title">{title}</h2>
          <button type="button" className={styles.mobileEditorConfirm} disabled={!dirty} onClick={onConfirm}>确认</button>
        </header>
        <div className={styles.mobileEditorBody}>{children}</div>
      </section>
    </div>,
    document.body,
  );
}

function trapFocus(event: KeyboardEvent, root: HTMLElement) {
  const items = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
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
