"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PROGRAM_VERSION, IS_UPGRADE_PREPARATION, UPGRADE_CONTENT_LABEL, UPGRADE_COPY_LABEL, getUpgradePrompt } from "./admin-upgrade-content";
import { closeAdminMobileMore } from "./mobile-more-contract";

const OPEN_GUIDE_EVENT = "portfolio:open-guide";
const OPEN_UPGRADE_EVENT = "portfolio:open-upgrade";

export function AdminUpgradeCenter() {
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  const [copyLabel, setCopyLabel] = useState(UPGRADE_COPY_LABEL);

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
    closeAdminMobileMore();
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
      await navigator.clipboard.writeText(getUpgradePrompt());
      setCopyLabel(`已复制${UPGRADE_CONTENT_LABEL}`);
      window.setTimeout(() => setCopyLabel(UPGRADE_COPY_LABEL), 1800);
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
          <small>数据库、图片、视频和媒体空间完整保留；旧 R2 只在检测到历史记录时迁移。</small>
        </div>
        <div>
          <strong>保留身份与内容</strong>
          <small>内容保留；恢复码确认按实际版本条件处理，同 1.3.1 部署不自动轮换。</small>
        </div>
      </div>
      <p className="note">
        {IS_UPGRADE_PREPARATION ? "当前版本 尚未正式分发，复制的是完整升级准备指令。先核对正式标签、清单、准确审核及原站地址适配；条件不齐只读盘点并停止升级写入。" : "先核对固定发布标签与配套摘要、原站资源和内容，再准备准确同站升级对象。"}
      </p>
      <div className="actions">
        <button className="primary" type="button" onClick={() => void copyPrompt()}>{copyLabel}</button>
        <button type="button" onClick={openUpgradeGuide}>查看升级步骤</button>
        <details>
          <summary>查看升级说明</summary>
          <div className="detail">
            <p><strong>入口：</strong>后台右上角“程序升级”，或“概览 → 网站空间 → 程序升级中心”。</p>
            <p><strong>推荐配置：</strong>能单独选择时优先 GPT-5.6 Sol；没有选择器时保留默认 Power。一般任务使用默认或 High，复杂迁移或故障按界面实际可用项使用 High 或 Extra High。</p>
            <p><strong>升级前读取：</strong>README.md、AGENTS.md、deployment/agent-manifest.json、deployment/template-version.json、deployment/upgrade-prompt.json。</p>
            <p><strong>准备流程：</strong>打开原站恢复码文件 → 复制当前完整指令 → 核对正式目标及原站适配 → 核定迁移、资源指纹与恢复对象 → 准确审核和授权满足后执行 → 原 /admin 按实际版本条件确认 → 有限验收。</p>
            <p><strong>原站适配：</strong>Pages 和上传页读取原站配置，ZIP 后台入口来自本次已鉴权的 HTTPS 请求。缺失或冲突时对应静态快捷入口不可用；不要复制其他网站账号、资源 ID 或凭据。保留原 Worker、DB、MEDIA_KV、必要旧绑定、免费套餐与内容。</p>
            <p><strong>必要迁移：</strong>1.3.1 涉及 0008–0011，按真实账本与摘要只处理缺失增量；不能沿用旧“止于 0007”说明或靠打开 /admin 补齐。cloudflare:deploy 会真实迁移和部署，不是只读工具。</p>
            <p><strong>恢复码条件：</strong>从 1.3.0 升级到 1.3.1，需要本人用当前恢复码确认、设置密码并保存新恢复码。同一 1.3.1 再部署不自动轮换。新文件名按实际版本生成，下载后核对站点和版本；秘密不发到聊天。</p>
            <p><strong>历史说明：</strong>历史 v1.3.0 标签保留原发布记录；当前两个复制入口共享已校验的正式 1.3.1 指令。</p>
            <p><strong>有限验收：</strong>核对生产版本、原首页与后台、资源指纹、内容和必要迁移；沿用适用证据，不默认追加手机、多会话或重复 ZIP/视频检查。动态内容发布和静态发布分别判断结果，异常先读回。</p>
          </div>
        </details>
      </div>
    </section>
  );

  return (
    panelHost ? createPortal(panel, panelHost) : null
  );
}
