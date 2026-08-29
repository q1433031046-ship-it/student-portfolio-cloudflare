import localVersion from "@/deployment/template-version.json";

const LATEST_VERSION_URL = "https://raw.githubusercontent.com/q1433031046-ship-it/student-portfolio-cloudflare/main/deployment/template-version.json";

type VersionManifest = {
  program?: string;
  version?: string;
  releasedAt?: string;
  importance?: "routine" | "recommended" | "important";
  releaseNotes?: string[];
  templateRepository?: string;
};

function compareVersions(left: string, right: string) {
  const a = left.split(".").map((value) => Number.parseInt(value, 10) || 0);
  const b = right.split(".").map((value) => Number.parseInt(value, 10) || 0);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export async function GET() {
  const currentVersion = localVersion.version;
  let latestVersion = currentVersion;
  let latestReleasedAt = localVersion.releasedAt;
  let importance: VersionManifest["importance"] = localVersion.importance as VersionManifest["importance"];
  let releaseNotes = [...localVersion.releaseNotes];
  let checkSucceeded = false;

  try {
    const response = await fetch(LATEST_VERSION_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      const remote = await response.json() as VersionManifest;
      if (remote.program === localVersion.program && remote.version) {
        latestVersion = remote.version;
        latestReleasedAt = remote.releasedAt ?? latestReleasedAt;
        importance = remote.importance ?? importance;
        releaseNotes = Array.isArray(remote.releaseNotes) ? remote.releaseNotes.slice(0, 8) : releaseNotes;
        checkSucceeded = true;
      }
    }
  } catch {
    checkSucceeded = false;
  }

  return Response.json({
    program: localVersion.program,
    version: currentVersion,
    currentVersion,
    releasedAt: localVersion.releasedAt,
    latestVersion,
    latestReleasedAt,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    importance,
    releaseNotes,
    checkSucceeded,
    templateRepository: localVersion.templateRepository,
    latestManifestUrl: LATEST_VERSION_URL,
  }, {
    headers: {
      "Cache-Control": "private, max-age=300",
    },
  });
}
