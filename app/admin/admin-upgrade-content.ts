import localVersion from "@/deployment/template-version.json";
import localUpgradePrompt from "@/deployment/upgrade-prompt.json";

export const PROGRAM_VERSION = localVersion.version;
export const LOCAL_UPGRADE_PROMPT = localUpgradePrompt.prompt.trim();
export const LOCAL_UPGRADE_PROMPT_VERSION = localUpgradePrompt.promptVersion;
export const UPGRADE_PROMPT_SYNC_EVENT = "portfolio:upgrade-prompt-synced";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const MINIMUM_PROMPT_LENGTH = 300;
const MAXIMUM_PROMPT_LENGTH = 20_000;

let activeUpgradePrompt = LOCAL_UPGRADE_PROMPT;
let activeUpgradePromptVersion = LOCAL_UPGRADE_PROMPT_VERSION;

function compareVersions(left: string, right: string) {
  const a = left.split(".").map((value) => Number.parseInt(value, 10));
  const b = right.split(".").map((value) => Number.parseInt(value, 10));
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function getUpgradePrompt() {
  return activeUpgradePrompt;
}

export function getUpgradePromptVersion() {
  return activeUpgradePromptVersion;
}

export function syncUpgradePrompt(prompt: string, promptVersion: string) {
  const normalizedPrompt = prompt.trim();
  if (
    !VERSION_PATTERN.test(promptVersion)
    || normalizedPrompt.length < MINIMUM_PROMPT_LENGTH
    || normalizedPrompt.length > MAXIMUM_PROMPT_LENGTH
    || compareVersions(promptVersion, activeUpgradePromptVersion) < 0
  ) return false;

  activeUpgradePrompt = normalizedPrompt;
  activeUpgradePromptVersion = promptVersion;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(UPGRADE_PROMPT_SYNC_EVENT, {
      detail: { promptVersion },
    }));
  }
  return true;
}
