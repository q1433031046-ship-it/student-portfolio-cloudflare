import { env } from "cloudflare:workers";
import { notFound } from "next/navigation";
import { createDefaultPortfolioDocument } from "../portfolio/default-document";
import { PortfolioExperience } from "../portfolio/portfolio-experience";

export default function PortfolioDemoPage() {
  if (String(Reflect.get(env, "AUTH_PLATFORM")) === "cloudflare") notFound();
  return <PortfolioExperience initialPortfolio={createDefaultPortfolioDocument()} mode="review" />;
}
