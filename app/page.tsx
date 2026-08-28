import { createDefaultPortfolioDocument } from "./portfolio/default-document";
import { LivePortfolio } from "./portfolio/live-portfolio";
import { toPublicPortfolioDocument } from "./portfolio/model";
import { getPortfolioRecord } from "./api/_lib/portfolio-store";
import { checkPortfolioAccess } from "./api/_lib/portfolio-access";
import { PortfolioAccessGate } from "./portfolio/access-gate";
import { UnpublishedState } from "./portfolio/unpublished-state";
import { getSiteOwnership } from "./api/_lib/site-ownership";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams?: Promise<{ access_error?: string }> }) {
  let fallback = toPublicPortfolioDocument(createDefaultPortfolioDocument());
  let persistentPortfolioLoaded = false;
  let siteState: "unavailable" | "unbound" | "email_pending" | "unpublished" | "published" = "unavailable";
  let unpublishedTitle = "作品网站";
  try {
    const ownership = await getSiteOwnership();
    if (!ownership) {
      siteState = "unbound";
    } else if (!ownership.ready) {
      siteState = "email_pending";
    } else {
      const record = await getPortfolioRecord();
      unpublishedTitle = record?.draft.settings.siteTitle ?? unpublishedTitle;
      if (record?.published) {
        fallback = toPublicPortfolioDocument(record.published);
        persistentPortfolioLoaded = true;
        siteState = "published";
      } else {
        siteState = "unpublished";
      }
    }
  } catch {
    // Static builds and local previews may not have a D1 binding; the bundled sample remains available there.
  }

  if (siteState === "unbound" || siteState === "email_pending") redirect("/admin");
  if (siteState === "unpublished") return <UnpublishedState siteTitle={unpublishedTitle} />;

  if (persistentPortfolioLoaded) {
    const params = await searchParams;
    let accessAllowed = false;
    let accessError = params?.access_error?.slice(0, 120) ?? null;
    try {
      const requestHeaders = await headers();
      const decision = await checkPortfolioAccess(new Request("https://portfolio.local/", { headers: requestHeaders }));
      accessAllowed = decision.allowed;
    } catch {
      accessError = "暂时无法验证访问权限，请稍后再试";
    }
    if (!accessAllowed) return <PortfolioAccessGate siteTitle={fallback.settings.siteTitle} error={accessError} />;
  }
  return <LivePortfolio fallback={fallback} />;
}
