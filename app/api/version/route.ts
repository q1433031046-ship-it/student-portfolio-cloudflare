import localVersion from "@/deployment/template-version.json";
import localUpgradePrompt from "@/deployment/upgrade-prompt.json";

const LATEST_VERSION_URL = "https://raw.githubusercontent.com/q1433031046-ship-it/student-portfolio-cloudflare/main/deployment/template-version.json";
const LATEST_UPGRADE_PROMPT_URL = "https://raw.githubusercontent.com/q1433031046-ship-it/student-portfolio-cloudflare/main/deployment/upgrade-prompt.json";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const REQUIRED_PROMPT_MARKERS = [
  "这是“升级现有站点”，不是新建站点",
  "不得创建第二套 Worker、D1、KV",
  "不得创建或绑定 R2",
  "不要在聊天中索取、展示或记录",
  "无害的只读检查",
  "从中断步骤继续",
];

type VersionManifest = {
  schemaVersion?: number;
  program?: string;
  version?: string;
  releasedAt?: string;
  importance?: "routine" | "recommended" | "important";
  releaseNotes?: string[];
  templateRepository?: string;
  upgradePromptManifest?: string;
};

type UpgradePromptManifest = {
  schemaVersion?: number;
  program?: string;
  promptVersion?: string;
  prompt?: string;
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

function hasValidUpgradePrompt(remote: UpgradePromptManifest, latestVersion: string) {
  if (
    remote.schemaVersion !== 1
    || remote.program !== localVersion.program
    || remote.promptVersion !== latestVersion
    || !VERSION_PATTERN.test(remote.promptVersion)
    || typeof remote.prompt !== "string"
  ) return false;

  const prompt = remote.prompt.trim();
  return prompt.length >= 300
    && prompt.length <= 20_000
    && REQUIRED_PROMPT_MARKERS.every((marker) => prompt.includes(marker));
}

export async function GET() {
  const currentVersion = localVersion.version;
  let latestVersion = currentVersion;
  let latestReleasedAt = localVersion.releasedAt;
  let importance: VersionManifest["importance"] = localVersion.importance as VersionManifest["importance"];
  let releaseNotes = [...localVersion.releaseNotes];
  let checkSucceeded = false;
  let latestUpgradePrompt = localUpgradePrompt.prompt.trim();
  let latestUpgradePromptVersion = localUpgradePrompt.promptVersion;
  let upgradePromptCheckSucceeded = false;

  const [versionResponse, promptResponse] = await Promise.all([
    fetch(LATEST_VERSION_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).catch(() => null),
    fetch(LATEST_UPGRADE_PROMPT_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).catch(() => null),
  ]);

  try {
    if (versionResponse?.ok) {
      const remote = await versionResponse.json() as VersionManifest;
      if (
        remote.schemaVersion === localVersion.schemaVersion
        && remote.program === localVersion.program
        && typeof remote.version === "string"
        && VERSION_PATTERN.test(remote.version)
        && compareVersions(remote.version, currentVersion) >= 0
        && remote.upgradePromptManifest === localVersion.upgradePromptManifest
      ) {
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

  try {
    if (checkSucceeded && promptResponse?.ok) {
      const remotePrompt = await promptResponse.json() as UpgradePromptManifest;
      if (
        hasValidUpgradePrompt(remotePrompt, latestVersion)
        && compareVersions(remotePrompt.promptVersion ?? "0.0.0", localUpgradePrompt.promptVersion) >= 0
      ) {
        latestUpgradePrompt = remotePrompt.prompt?.trim() ?? latestUpgradePrompt;
        latestUpgradePromptVersion = remotePrompt.promptVersion ?? latestUpgradePromptVersion;
        upgradePromptCheckSucceeded = true;
      }
    }
  } catch {
    upgradePromptCheckSucceeded = false;
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
    latestUpgradePrompt,
    latestUpgradePromptVersion,
    upgradePromptCheckSucceeded,
    templateRepository: localVersion.templateRepository,
    latestManifestUrl: LATEST_VERSION_URL,
    latestUpgradePromptManifestUrl: LATEST_UPGRADE_PROMPT_URL,
  }, {
    headers: {
      "Cache-Control": "private, max-age=300",
    },
  });
}
