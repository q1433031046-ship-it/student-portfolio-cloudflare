import localUpgradePrompt from "@/deployment/upgrade-prompt.json";
import candidate from "@/deployment/local-candidate.json";
import { UPGRADE_PREPARATION_PROMPT } from "./upgrade-preparation-prompt";
import { compareSemanticVersion, parseSemanticVersion } from "../../shared/semantic-version.mjs";

export const PROGRAM_VERSION = candidate.version;
export const IS_UPGRADE_PREPARATION = candidate.status === "unreleased";
export const UPGRADE_CONTENT_LABEL = IS_UPGRADE_PREPARATION ? "升级准备指令" : "升级指令";
export const UPGRADE_COPY_LABEL = `复制${UPGRADE_CONTENT_LABEL}`;
export const LOCAL_UPGRADE_PROMPT = IS_UPGRADE_PREPARATION
  ? UPGRADE_PREPARATION_PROMPT.trim()
  : localUpgradePrompt.prompt.trim();
export const LOCAL_UPGRADE_PROMPT_VERSION = candidate.status === "unreleased" ? candidate.version : localUpgradePrompt.promptVersion;
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
