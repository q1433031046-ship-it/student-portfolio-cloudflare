import React from "react";
import { createRoot } from "react-dom/client";
import { createDefaultPortfolioDocument } from "../app/portfolio/default-document";
import { PortfolioExperience } from "../app/portfolio/portfolio-experience";
import "./reset.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing application root");
}

createRoot(root).render(
  <React.StrictMode>
    <PortfolioExperience initialPortfolio={createDefaultPortfolioDocument()} mode="review" />
  </React.StrictMode>,
);
