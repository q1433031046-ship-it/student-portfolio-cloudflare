import localVersion from "@/deployment/template-version.json";
import localUpgradePrompt from "@/deployment/upgrade-prompt.json";
import { compareSemanticVersion, parseSemanticVersion } from "../../../shared/semantic-version.mjs";

const LATEST_VERSION_URL = "https://raw.githubusercontent.com/q1433031046-ship-it/student-portfolio-cloudflare/main/deployment/template-version.json";
const TAGGED_RELEASE_ROOT = "https://raw.githubusercontent.com/q1433031046-ship-it/student-portfolio-cloudflare";
const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VALID_IMPORTANCE = new Set(["routine", "recommended", "important"] as const);
const MAXIMUM_RELEASE_NOTES = 8;
const MAXIMUM_RELEASE_NOTE_LENGTH = 240;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MINIMUM_PROMPT_LENGTH = 300;
const MAXIMUM_PROMPT_LENGTH = 20_000;

type VersionManifest = {
  schemaVersion?: number;
  program?: string;
  version?: string;
  releaseTag?: string;
  releasedAt?: string;
  importance?: "routine" | "recommended" | "important";
  releaseNotes?: string[];
  templateRepository?: string;
  upgradePromptManifest?: string;
  upgradePromptSha256?: string;
};

type UpgradePromptManifest = {
  schemaVersion?: number;
  program?: string;
  promptVersion?: string;
  releaseTag?: string;
  promptSha256?: string;
  prompt?: string;
};

function taggedPromptUrl(releaseTag: string, promptPath: string) {
  return `${TAGGED_RELEASE_ROOT}/${encodeURIComponent(releaseTag)}/${promptPath}`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isValidCalendarDate(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function hasValidReleaseNotes(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= MAXIMUM_RELEASE_NOTES
    && value.every((note) => typeof note === "string"
      && note === note.trim()
      && note.length > 0
      && note.length <= MAXIMUM_RELEASE_NOTE_LENGTH
      && !CONTROL_CHARACTER_PATTERN.test(note));
}

function hasValidVersionManifest(remote: VersionManifest, currentVersion: string): remote is Required<Pick<VersionManifest,
  "schemaVersion" | "program" | "version" | "releaseTag" | "releasedAt" | "importance" | "releaseNotes" | "upgradePromptManifest" | "upgradePromptSha256"
>> & VersionManifest {
  return remote.schemaVersion === localVersion.schemaVersion
    && remote.program === localVersion.program
    && typeof remote.version === "string"
    && isSemanticVersion(remote.version)
    && compareSemanticVersion(remote.version, currentVersion) >= 0
    && typeof remote.releaseTag === "string"
    && remote.releaseTag === `v${remote.version}`
    && typeof remote.releasedAt === "string"
    && RELEASE_DATE_PATTERN.test(remote.releasedAt)
    && isValidCalendarDate(remote.releasedAt)
    && typeof remote.importance === "string"
    && VALID_IMPORTANCE.has(remote.importance)
    && hasValidReleaseNotes(remote.releaseNotes)
    && remote.upgradePromptManifest === localVersion.upgradePromptManifest
    && typeof remote.upgradePromptSha256 === "string"
    && SHA256_PATTERN.test(remote.upgradePromptSha256);
}

async function hasValidUpgradePrompt(
  remotePrompt: UpgradePromptManifest,
  latestVersion: string,
  releaseTag: string,
  expectedPromptSha256: string,
) {
  if (
    remotePrompt.schemaVersion !== 1
    || remotePrompt.program !== localVersion.program
    || remotePrompt.promptVersion !== latestVersion
    || remotePrompt.releaseTag !== releaseTag
    || remotePrompt.promptSha256 !== expectedPromptSha256
    || !isSemanticVersion(remotePrompt.promptVersion)
    || typeof remotePrompt.prompt !== "string"
    || remotePrompt.prompt.length < MINIMUM_PROMPT_LENGTH
    || remotePrompt.prompt.length > MAXIMUM_PROMPT_LENGTH
  ) return false;

  return await sha256Hex(remotePrompt.prompt) === expectedPromptSha256;
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
  let releaseTag = localVersion.releaseTag;
  let expectedPromptSha256 = localVersion.upgradePromptSha256;
  let latestUpgradePromptManifestUrl = taggedPromptUrl(releaseTag, localVersion.upgradePromptManifest);

  const versionResponse = await fetch(LATEST_VERSION_URL, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  }).catch(() => null);

  try {
    if (versionResponse?.ok) {
      const remote = await versionResponse.json() as VersionManifest;
      if (hasValidVersionManifest(remote, currentVersion)) {
        latestVersion = remote.version;
        latestReleasedAt = remote.releasedAt;
        importance = remote.importance;
        releaseNotes = [...remote.releaseNotes];
        releaseTag = remote.releaseTag;
        expectedPromptSha256 = remote.upgradePromptSha256;
        latestUpgradePromptManifestUrl = taggedPromptUrl(releaseTag, remote.upgradePromptManifest);
        checkSucceeded = true;
      }
    }
  } catch {
    checkSucceeded = false;
  }

  try {
    if (checkSucceeded) {
      const promptResponse = await fetch(latestUpgradePromptManifestUrl, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }).catch(() => null);
      if (promptResponse?.ok) {
        const remotePrompt = await promptResponse.json() as UpgradePromptManifest;
        if (
          await hasValidUpgradePrompt(remotePrompt, latestVersion, releaseTag, expectedPromptSha256)
          && compareSemanticVersion(remotePrompt.promptVersion ?? "0.0.0", localUpgradePrompt.promptVersion) >= 0
        ) {
          latestUpgradePrompt = remotePrompt.prompt?.trim() ?? latestUpgradePrompt;
          latestUpgradePromptVersion = remotePrompt.promptVersion ?? latestUpgradePromptVersion;
          upgradePromptCheckSucceeded = true;
        }
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
    updateAvailable: compareSemanticVersion(latestVersion, currentVersion) > 0,
    importance,
    releaseNotes,
    checkSucceeded,
    latestUpgradePrompt,
    latestUpgradePromptVersion,
    upgradePromptCheckSucceeded,
    templateRepository: localVersion.templateRepository,
    latestManifestUrl: LATEST_VERSION_URL,
    latestUpgradePromptManifestUrl,
  }, {
    headers: {
      "Cache-Control": "private, max-age=300",
    },
  });
}

function isSemanticVersion(value: string) {
  try { parseSemanticVersion(value); return true; } catch { return false; }
}
