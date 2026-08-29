"use client";

import localVersion from "@/deployment/template-version.json";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  LOCAL_UPGRADE_PROMPT_VERSION,
  getUpgradePrompt,
  syncUpgradePrompt,
} from "./admin-upgrade-content";

type VersionStatus = {
  currentVersion: string;
  latestVersion: string;
  latestReleasedAt?: string;
  updateAvailable: boolean;
  importance?: "routine" | "recommended" | "important";
  releaseNotes?: string[];
  checkSucceeded: boolean;
  latestUpgradePrompt: string;
  latestUpgradePromptVersion: string;
  upgradePromptCheckSucceeded: boolean;
};

const styles = `
[data-admin-tools] button[data-kind="upgrade"]{position:relative}
[data-admin-tools] button[data-kind="upgrade"][data-update-available="true"]::before{
  content:"";position:absolute;right:-3px;top:-3px;width:9px;height:9px;border:2px solid #fff;border-radius:50%;background:#e3382f;box-shadow:0 0 0 1px rgba(227,56,47,.18)
}
[data-update-status-host]{margin:22px 0 0}
[data-update-status-card]{padding:18px 20px;border:1px solid var(--line,#d9d9d6);border-radius:10px;background:#fafaf8}
[data-update-status-card][data-state="available"]{border-color:#f0b9b4;background:#fff7f6}
[data-update-status-card] .head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
[data-update-status-card] .head>div{min-width:0}
[data-update-status-card] .eyebrow{margin:0 0 5px;color:var(--muted,#6d7077);font-size:9px;font-weight:800;letter-spacing:.14em}
[data-update-status-card] strong{display:block;font-size:17px;letter-spacing:-.02em}
[data-update-status-card] .meta{margin-top:6px;color:var(--muted,#6d7077);font-size:11px;line-height:1.6}
[data-update-status-card] .versionFlow{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
[data-update-status-card] .badge{display:inline-flex;align-items:center;min-height:25px;padding:0 9px;border-radius:999px;background:#e8e8e4;color:#34363b;font-size:9px;font-weight:800;letter-spacing:.08em;white-space:nowrap}
[data-update-status-card][data-state="available"] .badge{background:#e3382f;color:#fff}
[data-update-status-card] ul{margin:13px 0 0;padding-left:18px;color:var(--muted,#6d7077);font-size:11px;line-height:1.7}
[data-update-status-card] button{margin-top:14px;min-height:34px;padding:0 11px;border:1px solid var(--line,#d9d9d6);border-radius:7px;background:#fff;color:inherit;font:inherit;font-size:10px;cursor:pointer}
[data-native-upgrade-center] .version strong{font-variant-numeric:tabular-nums}

@media(min-width:901px){
  [data-admin-guide-overlay] .layout{
    width:min(1760px,calc(100% - 32px))!important;
    padding:42px 0 90px!important;
    grid-template-columns:minmax(176px,210px) minmax(0,1fr)!important;
    gap:clamp(44px,4vw,76px)!important;
  }
  [data-admin-guide-overlay] .nav{
    width:100%;padding:2px 0 2px 14px!important;border-left:1px solid var(--line)!important;
  }
  [data-admin-guide-overlay] .nav a{
    margin-left:-15px!important;padding:8px 0 8px 14px!important;border-left:2px solid transparent!important;border-radius:0!important;background:transparent!important;font-size:12px!important;line-height:1.3!important;
  }
  [data-admin-guide-overlay] .nav a:hover{
    border-left-color:var(--blue,#3159ff)!important;color:var(--ink,#111217)!important;background:transparent!important;
  }
  [data-admin-guide-overlay] .content{width:100%!important;max-width:1320px!important}
  [data-admin-guide-overlay] section.guide p,[data-admin-guide-overlay] section.guide li{max-width:92ch!important}
}
@media(min-width:1450px){
  [data-admin-guide-overlay] .layout{
    width:min(1840px,calc(100% - 48px))!important;
    grid-template-columns:200px minmax(0,1fr)!important;
    gap:64px!important;
  }
  [data-admin-guide-overlay] .content{max-width:1400px!important}
}
@media(max-width:900px){
  [data-admin-guide-overlay] .nav{border-left:0!important;padding-left:0!important}
}
@media(max-width:620px){
  [data-update-status-card] .head{display:grid}
  [data-update-status-card] .badge{width:max-content}
}
`;

export function AdminUpdateNotifier() {
  const [status, setStatus] = useState<VersionStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [adminReady, setAdminReady] = useState(false);
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);

  const checkVersion = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const response = await fetch(`/api/version?check=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("version check failed");
      const payload = await response.json() as VersionStatus;
      if (payload.upgradePromptCheckSucceeded) {
        syncUpgradePrompt(payload.latestUpgradePrompt, payload.latestUpgradePromptVersion);
      }
      setStatus(payload);
    } catch {
      setStatus({
        currentVersion: localVersion.version,
        latestVersion: localVersion.version,
        updateAvailable: false,
        checkSucceeded: false,
        latestUpgradePrompt: getUpgradePrompt(),
        latestUpgradePromptVersion: LOCAL_UPGRADE_PROMPT_VERSION,
        upgradePromptCheckSucceeded: false,
      });
    } finally {
      setChecking(false);
    }
  }, [checking]);

  useEffect(() => {
    const locate = () => {
      const toolbar = document.querySelector<HTMLElement>("[data-admin-tools]");
      setAdminReady(Boolean(toolbar));

      const versionText = document.querySelector<HTMLElement>("[data-native-upgrade-center] .version strong");
      if (versionText && versionText.textContent !== `v${localVersion.version}`) versionText.textContent = `v${localVersion.version}`;

      const panel = document.getElementById("program-upgrade-center");
      if (!panel) {
        setPanelHost(null);
        return;
      }
      let host = panel.querySelector<HTMLElement>("[data-update-status-host]");
      if (!host) {
        host = document.createElement("div");
        host.setAttribute("data-update-status-host", "");
        const grid = panel.querySelector(".grid");
        panel.insertBefore(host, grid ?? null);
      }
      setPanelHost((current) => current === host ? current : host);
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!adminReady || status || checking) return;
    const timer = window.setTimeout(() => void checkVersion(), 0);
    return () => window.clearTimeout(timer);
  }, [adminReady, status, checking, checkVersion]);

  useEffect(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-admin-tools] button[data-kind="upgrade"]');
    if (!button) return;
    const available = Boolean(status?.updateAvailable);
    button.dataset.updateAvailable = available ? "true" : "false";
    if (available) {
      button.title = `发现新版本 v${status?.latestVersion}`;
      button.setAttribute("aria-label", `程序升级，有新版本 v${status?.latestVersion}`);
    } else {
      button.title = status?.checkSucceeded ? `当前已是最新版本 v${status.currentVersion}` : "程序升级";
      button.setAttribute("aria-label", "程序升级");
    }
  }, [status]);

  const state = status?.updateAvailable ? "available" : status?.checkSucceeded ? "current" : "offline";
  const panel = panelHost ? createPortal(
    <div data-update-status-card data-state={state}>
      <div className="head">
        <div>
          <p className="eyebrow">VERSION CHECK</p>
          {status?.updateAvailable ? (
            <>
              <strong>发现新版本 v{status.latestVersion}</strong>
              <div className="meta versionFlow">当前 v{status.currentVersion} → 最新 v{status.latestVersion}</div>
              {status.latestReleasedAt ? <div className="meta">发布时间：{status.latestReleasedAt}</div> : null}
            </>
          ) : status?.checkSucceeded ? (
            <>
              <strong>当前已是最新版本</strong>
              <div className="meta versionFlow">v{status.currentVersion}</div>
            </>
          ) : (
            <>
              <strong>暂时没有获取到模板版本</strong>
              <div className="meta">当前网站可以继续正常使用，稍后重新检查即可。</div>
            </>
          )}
        </div>
        <span className="badge">{status?.updateAvailable ? "NEW UPDATE" : status?.checkSucceeded ? "UP TO DATE" : "CHECK LATER"}</span>
      </div>
      {status?.updateAvailable && status.releaseNotes?.length ? (
        <ul>{status.releaseNotes.map((note) => <li key={note}>{note}</li>)}</ul>
      ) : null}
      <div className="meta">
        {status?.upgradePromptCheckSucceeded
          ? `升级指令已同步至 v${status.latestUpgradePromptVersion}`
          : `升级指令使用内置安全版本 v${LOCAL_UPGRADE_PROMPT_VERSION}`}
      </div>
      <button type="button" onClick={() => void checkVersion()} disabled={checking}>{checking ? "正在检查…" : "重新检查版本"}</button>
    </div>,
    panelHost,
  ) : null;

  return <><style>{styles}</style>{panel}</>;
}
