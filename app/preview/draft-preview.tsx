"use client";

import { useEffect, useState } from "react";
import { toUserFacingChineseError, userFacingError } from "../lib/user-facing-error";
import { PortfolioExperience } from "../portfolio/portfolio-experience";
import { validatePortfolioDocument, type PortfolioDocument } from "../portfolio/model";

export function DraftPreview() {
  const [portfolio, setPortfolio] = useState<PortfolioDocument | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/portfolio", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          throw userFacingError("草稿响应暂时无法读取，请稍后重试");
        }
        if (!response.ok || !isRecord(body)) throw userFacingError("草稿暂时无法读取");
        const validation = validatePortfolioDocument(body.portfolio);
        if (!validation.ok) throw userFacingError("草稿内容需要先修正");
        setPortfolio(validation.value);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(toUserFacingChineseError(reason, "草稿暂时无法读取，请检查网络后重试"));
      });
    return () => controller.abort();
  }, []);

  if (error) return <PreviewState title="快速预览未打开" detail={error} />;
  if (!portfolio) return <PreviewState title="正在载入草稿" detail="这里显示的是刚保存的草稿，不会影响已发布网页。" />;
  return <PortfolioExperience initialPortfolio={portfolio} mode="review" />;
}

function PreviewState({ title, detail }: { title: string; detail: string }) {
  return <main style={{ minHeight: "100svh", display: "grid", placeContent: "center", gap: 12, padding: 28, background: "#0b0c0f", color: "#f4f3ef", fontFamily: "Arial, PingFang SC, sans-serif", textAlign: "center" }}><h1 style={{ margin: 0 }}>{title}</h1><p style={{ margin: 0, color: "#a8abb4" }}>{detail}</p></main>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
