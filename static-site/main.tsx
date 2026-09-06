import React from "react";
import { createRoot } from "react-dom/client";
import { PortfolioExperience } from "../app/portfolio/portfolio-experience";
import { mediaAssetsInDocument, type PortfolioDocument } from "../app/portfolio/model";
import "../cloudflare-demo/reset.css";

async function start() {
  const response = await fetch("/data/portfolio.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("静态作品数据不可用");
  const portfolio = await response.json() as PortfolioDocument;
  for (const asset of mediaAssetsInDocument(portfolio)) {
    if (asset.key || (asset.src && !/^\/media\/[A-Za-z0-9_.-]+$/u.test(asset.src))) {
      throw new Error("静态作品媒体引用无效，请联系管理员重新发布");
    }
  }
  document.documentElement.dataset.theme = portfolio.settings.activeTheme;
  const workerAdminUrl = document.querySelector<HTMLMetaElement>('meta[name="worker-admin-url"]')?.content;
  const admin = workerAdminUrl && /^https:\/\/[^/]+\/admin$/u.test(workerAdminUrl) ? workerAdminUrl : undefined;
  createRoot(document.getElementById("root")!).render(<><PortfolioExperience initialPortfolio={portfolio} mode="static" />{admin && <a href={admin} rel="noopener noreferrer" style={{ display: "block", padding: 16, textAlign: "center" }}>管理网站</a>}</>);
}

void start().catch((error: unknown) => {
  const root = document.getElementById("root");
  if (root) root.textContent = error instanceof Error ? error.message : "静态网站暂时无法读取，请稍后重试";
});
