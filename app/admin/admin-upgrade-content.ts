import localVersion from "@/deployment/template-version.json";
import localUpgradePrompt from "@/deployment/upgrade-prompt.json";
import candidate from "@/deployment/local-candidate.json";
import { compareSemanticVersion, parseSemanticVersion } from "../../shared/semantic-version.mjs";

export const PROGRAM_VERSION = candidate.version;
export const LOCAL_UPGRADE_PROMPT = candidate.status === "unreleased"
  ? "当前程序是 Cloudflare Pages 手动打包的本地候选，尚无对应正式发布标签。请先核对准确候选及独立审计结果，再准备发布对象。历史升级说明对应 " + localVersion.releaseTag + "，不能据此安装本次 Pages 改动。"
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
