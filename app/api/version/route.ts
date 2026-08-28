const PROGRAM_VERSION = "1.0.0";
const RELEASED_AT = "2026-08-29";
const TEMPLATE_REPOSITORY = "https://github.com/q1433031046-ship-it/student-portfolio-cloudflare";

export async function GET() {
  return Response.json({
    program: "student-portfolio-cloudflare",
    version: PROGRAM_VERSION,
    releasedAt: RELEASED_AT,
    templateRepository: TEMPLATE_REPOSITORY,
    upgradeGuide: "/UPGRADE-GUIDE.md",
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
