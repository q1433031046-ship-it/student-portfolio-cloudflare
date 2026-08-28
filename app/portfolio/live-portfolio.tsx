"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PortfolioExperience } from "./portfolio-experience";
import { validatePortfolioDocument, type PortfolioDocument } from "./model";

export function LivePortfolio({ fallback }: { fallback: PortfolioDocument }) {
  const [portfolio, setPortfolio] = useState(fallback);
  const revisionRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch("/api/portfolio", { signal: controller.signal, cache: "no-store", headers: { "Cache-Control": "no-cache" } });
      if (response.status === 403) {
        window.location.assign("/");
        return;
      }
      if (!response.ok) throw new Error("portfolio unavailable");
      const body: unknown = await response.json();
      if (!isRecord(body)) throw new Error("invalid portfolio response");
      const validation = validatePortfolioDocument(body.portfolio);
      if (!validation.ok) throw new Error("invalid portfolio document");
      const nextRevision = typeof body.revision === "number" ? body.revision : 0;
      if (nextRevision >= revisionRef.current) {
        setPortfolio(validation.value);
        revisionRef.current = nextRevision;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Published portfolio could not be refreshed.");
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refresh(); }, 0);
    const onFocus = () => { void refresh(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    const onStorage = (event: StorageEvent) => { if (event.key === "portfolio-published-revision") void refresh(); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initialRefresh);
      requestRef.current?.abort();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    document.title = portfolio.settings.siteTitle;
  }, [portfolio.settings.siteTitle]);

  // Keep the viewing state (hero expansion, open project, playback focus) while a
  // no-store refresh swaps in the latest published snapshot. Remounting here
  // would collapse the hero whenever the background request finishes.
  return <PortfolioExperience initialPortfolio={portfolio} mode="live" />;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
