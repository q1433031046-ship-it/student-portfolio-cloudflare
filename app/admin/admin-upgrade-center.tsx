"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PROGRAM_VERSION, UPGRADE_PROMPT } from "./admin-upgrade-content";

const OPEN_GUIDE_EVENT = "portfolio:open-guide";
const OPEN_UPGRADE_EVENT = "portfolio:open-upgrade";

export function AdminUpgradeCenter() {
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  const [copyLabel, setCopyLabel] = useState("复制给 GPT 的升级指令");

  useEffect(() => {
    const locate = () => {
      const storage = document.querySelector<HTMLElement>("section[class*='storagePanel']")
        ?? Array.from(document.querySelectorAll<HTMLElement>("section")).find((node) =>
          node.textContent?.includes("WEBSITE STORAGE") && node.textContent?.includes("网站空间"),
        )
        ?? null;
      const nextPanelHost = storage?.parentElement ?? null;
      setPanelHost((current) => current === nextPanelHost ? current : nextPanelHost);
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const openUpgradeCenter = useCallback(() => {
    const overview = Array.from(document.querySelectorAll<HTMLButtonElement>("aside nav button")).find((button) =>
      button.textContent?.trim().includes("概览"),
    );
    overview?.click();

    let attempts = 0;
    const reveal = () => {
      const panel = document.getElementById("program-upgrade-center");
      if (panel) {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
        panel.focus({ preventScroll: true });
        window.history.replaceState(null, "", "#program-upgrade-center");
        if (typeof panel.animate === "function") panel.animate(
          [
            { boxShadow: "0 0 0 0 rgba(50,88,255,0)" },
            { boxShadow: "0 0 0 6px rgba(50,88,255,.20)" },
            { boxShadow: "0 0 0 0 rgba(50,88,255,0)" },
          ],
          { duration: 1400, easing: "ease-out" },
        );
        return;
      }
      attempts += 1;
      if (attempts < 50) window.setTimeout(reveal, 100);
    };

    window.setTimeout(reveal, 60);
  }, []);

  useEffect(() => {
    const handleOpenUpgrade = () => openUpgradeCenter();
    window.addEventListener(OPEN_UPGRADE_EVENT, handleOpenUpgrade);
    return () => window.removeEventListener(OPEN_UPGRADE_EVENT, handleOpenUpgrade);
  }, [openUpgradeCenter]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(UPGRADE_PROMPT);
      setCopyLabel("已复制升级指令");
      window.setTimeout(() => setCopyLabel("复制给 GPT 的升级指令"), 1800);
    } catch {
      setCopyLabel("复制失败，请重试");
    }
  }

  function openUpgradeGuide() {
    window.dispatchEvent(new CustomEvent(OPEN_GUIDE_EVENT, { detail: { sectionId: "admin-guide-upgrade" } }));
  }

  const panel = (
    <section id="program-upgrade-center" data-native-upgrade-center tabIndex={-1} aria-labelledby="program-upgrade-title">
      <style>{`
        [data-native-upgrade-center]{scroll-margin-top:100px;margin:22px 0 0;padding:clamp(24px,4vw,42px);border:1px solid var(--line,#d9d9d6);background:#fff;color:var(--ink,#101114)}
        [data-native-upgrade-center]:focus{outline:none}
        [data-native-upgrade-center] header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end}
        [data-native-upgrade-center] .kicker{margin:0 0 10px;color:var(--accent,#3258ff);font-size:9px;font-weight:800;letter-spacing:.18em}
        [data-native-upgrade-center] h2{margin:0;font-size:clamp(30px,4vw,48px);letter-spacing:-.055em}
        [data-native-upgrade-center] .version{text-align:right}
        [data-native-upgrade-center] .version small{display:block;color:var(--muted,#6d7077);font-size:10px}
        [data-native-upgrade-center] .version strong{font-size:clamp(28px,3vw,44px);letter-spacing:-.05em}
        [data-native-upgrade-center] .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:30px 0 22px;border:1px solid var(--line,#d9d9d6)}
        [data-native-upgrade-center] .grid>div{min-height:108px;padding:20px;border-right:1px solid var(--line,#d9d9d6)}
        [data-native-upgrade-center] .grid>div:last-child{border-right:0}
        [data-native-upgrade-center] .grid strong,[data-native-upgrade-center] .grid small{display:block}
        [data-native-upgrade-center] .grid strong{margin-bottom:8px}
        [data-native-upgrade-center] .grid small{color:var(--muted,#6d7077);line-height:1.6}
        [data-native-upgrade-center] .note{color:var(--muted,#6d7077);font-size:12px;line-height:1.75}
        [data-native-upgrade-center] .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
        [data-native-upgrade-center] button,[data-native-upgrade-center] summary{padding:11px 15px;border:1px solid var(--line,#d9d9d6);border-radius:8px;background:#fff;color:inherit;cursor:pointer;font:inherit}
        [data-native-upgrade-center] button:focus-visible,[data-native-upgrade-center] summary:focus-visible{outline:3px solid rgba(50,88,255,.22);outline-offset:2px}
        [data-native-upgrade-center] .primary{border-color:var(--accent,#3258ff);background:var(--accent,#3258ff);color:#fff}
        [data-native-upgrade-center] details{width:100%;margin-top:4px}
        [data-native-upgrade-center] .detail{margin-top:12px;padding:16px;border:1px solid #e4e4e0;background:#fafaf8;color:var(--muted,#6d7077);font-size:12px;line-height:1.75}
        [data-native-upgrade-center] .detail p{margin:0 0 10px}
        [data-native-upgrade-center] .detail p:last-child{margin-bottom:0}
        @media(max-width:760px){
          [data-native-upgrade-center] header{display:grid}
          [data-native-upgrade-center] .version{text-align:left}
          [data-native-upgrade-center] .grid{grid-template-columns:1fr}
          [data-native-upgrade-center] .grid>div{border-right:0!important;border-bottom:1px solid var(--line,#d9d9d6)}
          [data-native-upgrade-center] .grid>div:last-child{border-bottom:0}
        }
      `}</style>
      <header>
        <div>
          <p className="kicker">PROGRAM / UPGRADE</p>
          <h2 id="program-upgrade-title">程序升级中心</h2>
        </div>
        <div className="version">
          <small>当前程序版本</small>
          <strong>v{PROGRAM_VERSION}</strong>
        </div>
      </header>
      <div className="grid">
        <div>
          <strong>沿用当前站点</strong>
          <small>Worker 与 workers.dev 地址保持不变。</small>
        </div>
        <div>
          <strong>沿用 D1 / KV</strong>
          <small>数据库、图片、视频和媒体空间完整保留。</small>
        </div>
        <div>
          <strong>沿用管理员与内容</strong>
          <small>密码验证、恢复状态、草稿、发布内容和二维码完整保留。</small>
        </div>
      </div>
      <p className="note">
        GPT 会先核对当前 Worker、DB 和 MEDIA_KV，再更新程序代码与增量数据库迁移。升级过程以“现有资源不变、内容完整保留”为验收标准。
      </p>
      <div className="actions">
        <button className="primary" type="button" onClick={() => void copyPrompt()}>{copyLabel}</button>
        <button type="button" onClick={openUpgradeGuide}>查看升级步骤</button>
        <details>
          <summary>查看升级说明</summary>
          <div className="detail">
            <p><strong>入口：</strong>后台右上角“程序升级”，或“概览 → 网站空间 → 程序升级中心”。</p>
            <p><strong>推荐配置：</strong>最低使用 GPT-5.6 Sol，思考程度使用“高”；资源绑定、数据库迁移或版本冲突时使用“超高”。</p>
            <p><strong>升级前读取：</strong>README.md、AGENTS.md、deployment/agent-manifest.json、deployment/template-version.json。</p>
            <p><strong>升级后检查：</strong>登录与恢复、图片、50 MB 分片视频与 Range 播放、草稿预览、正式发布、二维码、网站空间、10 会话播放及大陆网络访问。</p>
            <p><strong>资源原则：</strong>沿用现有 Worker、D1、MEDIA_KV、Secrets 与资源 ID；禁止 R2、付费套餐和付款方式，保留管理员、媒体和内容数据。</p>
          </div>
        </details>
      </div>
    </section>
  );

  return (
    <>
      <span data-program-upgrade-center hidden aria-hidden="true" />
      {panelHost ? createPortal(panel, panelHost) : null}
    </>
  );
}
