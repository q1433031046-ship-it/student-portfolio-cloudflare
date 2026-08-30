import { PROGRAM_VERSION } from "../lib/program-version";

const recoveryDownloadVersion = `v${PROGRAM_VERSION}`;

export function buildRecoveryCodeDownload(recoveryCode: string, hostname: string, generatedAt = new Date()) {
  const safeHostname = sanitizeHostname(hostname);
  const generatedAtIso = generatedAt.toISOString();
  const filenameTime = generatedAtIso.replace(/\.\d{3}Z$/u, "Z").replaceAll("-", "").replaceAll(":", "");
  return {
    filename: `${safeHostname}-${recoveryDownloadVersion}-系统恢复码-${filenameTime}.txt`,
    content: [
      "网站管理员系统恢复码",
      "",
      `站点：${safeHostname}`,
      `程序版本：${recoveryDownloadVersion}`,
      `生成时间（UTC）：${generatedAtIso}`,
      "",
      recoveryCode,
      "",
      "此恢复码只能使用一次。使用后系统会生成新恢复码。",
      "",
    ].join("\n"),
  };
}

function sanitizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/[^a-z0-9.-]+/gu, "-").replace(/^-+|-+$/gu, "") || "unknown-host";
}
