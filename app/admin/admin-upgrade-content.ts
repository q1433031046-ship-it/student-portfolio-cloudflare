import localVersion from "@/deployment/template-version.json";
import localUpgradePrompt from "@/deployment/upgrade-prompt.json";
import { compareSemanticVersion, parseSemanticVersion } from "../../shared/semantic-version.mjs";

export const PROGRAM_VERSION = localVersion.version;
export const LOCAL_UPGRADE_PROMPT = localUpgradePrompt.prompt.trim();
export const LOCAL_UPGRADE_PROMPT_VERSION = localUpgradePrompt.promptVersion;
export const UPGRADE_PROMPT_SYNC_EVENT = "portfolio:upgrade-prompt-synced";

const MINIMUM_PROMPT_LENGTH = 300;
const MAXIMUM_PROMPT_LENGTH = 20_000;

let activeUpgradePrompt = LOCAL_UPGRADE_PROMPT;
let activeUpgradePromptVersion = LOCAL_UPGRADE_PROMPT_VERSION;

export function getUpgradePrompt() {
  return activeUpgradePrompt;
}

export function getUpgradePromptVersion() {
  return activeUpgradePromptVersion;
}

export function syncUpgradePrompt(prompt: string, promptVersion: string) {
  const normalizedPrompt = prompt.trim();
  if (
    !isSemanticVersion(promptVersion)
    || normalizedPrompt.length < MINIMUM_PROMPT_LENGTH
    || normalizedPrompt.length > MAXIMUM_PROMPT_LENGTH
    || compareSemanticVersion(promptVersion, activeUpgradePromptVersion) < 0
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

function isSemanticVersion(value: string) {
  try { parseSemanticVersion(value); return true; } catch { return false; }
}
