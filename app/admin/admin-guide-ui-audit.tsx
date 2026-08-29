"use client";

import { useEffect } from "react";

const auditedStyles = `
[data-admin-tools] button{
  min-height:34px;
  padding:0 10px;
  border:1px solid #d9d9d6;
  border-radius:7px;
  background:#fff;
  color:inherit;
  font:inherit;
  font-size:11px;
  line-height:1;
  cursor:pointer;
  white-space:nowrap;
}
[data-admin-tools] button:hover{
  border-color:#3258ff;
  color:#2448d8;
  text-decoration:none;
}
[data-admin-tools] button[data-kind="upgrade"]{
  border-color:#3258ff;
  background:#3258ff;
  color:#fff;
}
[data-admin-tools] button:focus-visible,
[data-admin-guide-overlay] a:focus-visible,
[data-admin-guide-overlay] button:focus-visible{
  outline:2px solid #3258ff;
  outline-offset:3px;
}
header:has([data-admin-tools]) > div{
  gap:10px;
  flex-wrap:wrap;
  justify-content:flex-end;
}
[data-admin-guide-overlay]{
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
}
[data-admin-guide-overlay] .top{
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
}
[data-admin-guide-overlay] .top > div{
  justify-content:flex-end;
}
[data-admin-guide-overlay] .layout{
  align-items:start;
}
[data-admin-guide-overlay] .nav{
  max-height:calc(100svh - 116px);
  overflow:auto;
  padding-right:6px;
  overscroll-behavior:contain;
}
[data-admin-guide-overlay] .content{
  width:100%;
  max-width:1080px;
}
[data-admin-guide-overlay] section.guide p,
[data-admin-guide-overlay] section.guide li{
  max-width:82ch;
}
[data-admin-guide-overlay] .prompt pre{
  font-size:12px;
}
[data-admin-guide-overlay] table{
  border-radius:10px;
  overflow:hidden;
}
@media(max-width:820px){
  [data-admin-tools]{
    position:fixed;
    right:14px;
    bottom:14px;
    z-index:90;
    padding:7px;
    gap:6px;
    border:1px solid #d9d9d6;
    border-radius:9px;
    background:rgba(255,255,255,.96);
    box-shadow:0 12px 32px rgba(16,17,20,.14);
    backdrop-filter:blur(14px);
  }
}
@media(max-width:720px){
  header:has([data-admin-tools]){
    height:auto!important;
    min-height:64px;
    padding-block:8px!important;
    gap:8px;
  }
  header:has([data-admin-tools]) > div{
    gap:6px;
    flex-wrap:nowrap;
  }
  header:has([data-admin-tools]) > div > a[href="/"]{
    display:none;
  }
  [data-admin-tools] button{
    min-width:42px;
    min-height:34px;
    padding:0 8px;
    font-size:0;
  }
  [data-admin-tools] button[data-kind="guide"]::after{
    content:"教程";
    font-size:11px;
  }
  [data-admin-tools] button[data-kind="upgrade"]::after{
    content:"升级";
    font-size:11px;
  }
}
@media(max-width:620px){
  [data-admin-guide-overlay] .top{
    grid-template-columns:minmax(0,1fr) auto;
    padding:9px 12px;
  }
  [data-admin-guide-overlay] .top strong{
    align-self:center;
    overflow:hidden;
    font-size:13px;
    text-overflow:ellipsis;
    white-space:nowrap;
  }
  [data-admin-guide-overlay] .top > div{
    flex-wrap:nowrap;
  }
  [data-admin-guide-overlay] .top a[href*="github.com"]{
    font-size:0;
  }
  [data-admin-guide-overlay] .top a[href*="github.com"]::after{
    content:"GitHub 指南";
    font-size:10px;
  }
  [data-admin-guide-overlay] .top a,
  [data-admin-guide-overlay] .top button{
    min-height:36px;
    padding-inline:10px;
  }
  [data-admin-guide-overlay] .hero h1{
    font-size:clamp(38px,12vw,58px);
  }
  [data-admin-guide-overlay] .content{
    max-width:none;
  }
  [data-admin-guide-overlay] section.guide p,
  [data-admin-guide-overlay] section.guide li{
    max-width:none;
  }
}
@media(max-width:420px){
  header:has([data-admin-tools]) > button:first-child{
    min-width:124px!important;
    width:124px;
    grid-template-columns:24px 1fr!important;
    column-gap:7px!important;
  }
  header:has([data-admin-tools]) > button:first-child small{
    display:none;
  }
  [data-admin-tools]{right:10px;bottom:10px}
  [data-admin-guide-overlay] .top a[href*="github.com"]{
    display:none;
  }
}
@media(prefers-reduced-motion:reduce){
  [data-admin-guide-overlay]{scroll-behavior:auto}
  [data-admin-tools] button{transition:none}
}
`;

type InertElement = HTMLElement & { inert: boolean };

function visibleFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
}

export function AdminGuideUiAudit() {
  useEffect(() => {
    let activeOverlay: HTMLElement | null = null;
    let cleanupActiveOverlay: (() => void) | null = null;

    const labelActions = () => {
      document.querySelector<HTMLElement>('[data-admin-tools] button[data-kind="guide"]')
        ?.setAttribute("aria-label", "打开后台使用教程");
      document.querySelector<HTMLElement>('[data-admin-tools] button[data-kind="upgrade"]')
        ?.setAttribute("aria-label", "定位到程序升级中心");
    };

    const enhanceOverlay = (overlay: HTMLElement) => {
      const title = overlay.querySelector<HTMLElement>("#admin-guide-title")
        ?? overlay.querySelector<HTMLElement>(".top strong");
      if (title) overlay.setAttribute("aria-labelledby", title.id || "admin-guide-title");
      overlay.tabIndex = -1;

      const githubLink = overlay.querySelector<HTMLAnchorElement>('a[href*="github.com"]');
      if (githubLink) githubLink.textContent = "GitHub 完整指南 ↗";

      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const adminMain = document.querySelector<InertElement>("main");
      const previousInert = adminMain?.inert ?? false;
      const previousAriaHidden = adminMain?.getAttribute("aria-hidden") ?? null;
      if (adminMain && !adminMain.contains(overlay)) {
        adminMain.inert = true;
        adminMain.setAttribute("aria-hidden", "true");
      }

      const keyHandler = (event: KeyboardEvent) => {
        if (event.key !== "Tab") return;
        const focusables = visibleFocusableElements(overlay);
        if (focusables.length === 0) {
          event.preventDefault();
          overlay.focus();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      overlay.addEventListener("keydown", keyHandler);
      window.requestAnimationFrame(() => {
        const closeButton = overlay.querySelector<HTMLButtonElement>(".top button.primary");
        (closeButton ?? overlay).focus();
      });

      return () => {
        overlay.removeEventListener("keydown", keyHandler);
        if (adminMain) {
          adminMain.inert = previousInert;
          if (previousAriaHidden === null) adminMain.removeAttribute("aria-hidden");
          else adminMain.setAttribute("aria-hidden", previousAriaHidden);
        }
        window.requestAnimationFrame(() => opener?.focus());
      };
    };

    const inspect = () => {
      labelActions();
      const overlay = document.querySelector<HTMLElement>("[data-admin-guide-overlay]");
      if (overlay === activeOverlay) return;
      cleanupActiveOverlay?.();
      cleanupActiveOverlay = null;
      activeOverlay = overlay;
      if (overlay) cleanupActiveOverlay = enhanceOverlay(overlay);
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cleanupActiveOverlay?.();
    };
  }, []);

  return <style>{auditedStyles}</style>;
}
