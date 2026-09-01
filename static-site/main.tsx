import React from "react";
import { createRoot } from "react-dom/client";
import { StaticPortfolio } from "./static-portfolio";
import type { PortfolioDocument } from "../app/portfolio/model";
import "./styles.css";

async function start() {
  const response = await fetch("/data/portfolio.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("静态作品数据不可用");
  const portfolio = await response.json() as PortfolioDocument;
  if (portfolio.settings.customFont.src) {
    const font = new FontFace("PortfolioCustom", `url(${JSON.stringify(portfolio.settings.customFont.src)})`);
    await font.load();
    document.fonts.add(font);
  }
  document.documentElement.dataset.theme = portfolio.settings.activeTheme;
  const workerAdminUrl = document.querySelector<HTMLMetaElement>('meta[name="worker-admin-url"]')?.content;
  createRoot(document.getElementById("root")!).render(<StaticPortfolio portfolio={portfolio} workerAdminUrl={workerAdminUrl} />);
}

void start();
