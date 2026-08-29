"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const PROGRAM_VERSION = "1.0.0";
const UPGRADE_PROMPT = "请把我的学生作品集网站升级到模板最新版本。先读取 README.md、AGENTS.md、deployment/agent-manifest.json 和 deployment/template-version.json。升级只允许更新程序代码和增量数据库迁移，必须保留当前 Worker、workers.dev 地址、D1 DB、MEDIA_KV、管理员账号、Secrets、图片、视频、草稿、已发布内容、二维码和访问记录。不要创建新的 D1、KV 或 Worker，也不要把模板仓库中的资源 ID 覆盖到我的站点。先检查并确认目标站点和现有资源，再执行升级；需要账号官方授权时再叫我，任何密码、一次性部署口令和系统恢复码都由我本人在官方页面输入，不要向我索取。升级完成后请验证后台登录、图片、视频、草稿预览、正式发布和网站空间统计。";

export function AdminUpgradeCenter() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [copyLabel, setCopyLabel] = useState("复制给 GPT 的升级指令");

  useEffect(() => {
    const locate = () => {
      const storage = Array.from(document.querySelectorAll<HTMLElement>("section")).find((node) =>
        node.textContent?.includes("WEBSITE STORAGE") && node.textContent?.includes("网站空间"),
      );
      const nextHost = storage?.parentElement ?? null;
      setHost((current) => current === nextHost ? current : nextHost);
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(UPGRADE_PROMPT);
      setCopyLabel("已复制升级指令");
      window.setTimeout(() => setCopyLabel("复制给 GPT 的升级指令"), 1800);
    } catch {
      setCopyLabel("复制失败，请重试");
    }
  }

  const panel = (
    <section data-native-upgrade-center>
      <style>{`
        [data-native-upgrade-center]{margin:22px 0 0;padding:clamp(24px,4vw,42px);border:1px solid var(--line,#d9d9d6);background:#fff;color:var(--ink,#101114)}
        [data-native-upgrade-center] header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end}
        [data-native-upgrade-center] .kicker{margin:0 0 10px;color:var(--accent,#3258ff);font-size:9px;font-weight:800;letter-spacing:.18em}
        [data-native-upgrade-center] h2{margin:0;font-size:clamp(30px,4vw,48px);letter-spacing:-.055em}
        [data-native-upgrade-center] .version{text-align:right}[data-native-upgrade-center] .version small{display:block;color:var(--muted,#6d7077);font-size:10px}[data-native-upgrade-center] .version strong{font-size:clamp(28px,3vw,44px);letter-spacing:-.05em}
        [data-native-upgrade-center] .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:30px 0 22px;border:1px solid var(--line,#d9d9d6)}
        [data-native-upgrade-center] .grid>div{min-height:108px;padding:20px;border-right:1px solid var(--line,#d9d9d6)}[data-native-upgrade-center] .grid>div:last-child{border-right:0}
        [data-native-upgrade-center] .grid strong,[data-native-upgrade-center] .grid small{display:block}[data-native-upgrade-center] .grid strong{margin-bottom:8px}[data-native-upgrade-center] .grid small{color:var(--muted,#6d7077);line-height:1.6}
        [data-native-upgrade-center] .note{color:var(--muted,#6d7077);font-size:12px;line-height:1.75}
        [data-native-upgrade-center] .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}[data-native-upgrade-center] button,[data-native-upgrade-center] summary{padding:11px 15px;border:1px solid var(--line,#d9d9d6);border-radius:8px;background:#fff;color:inherit;cursor:pointer;font:inherit}
        [data-native-upgrade-center] details{width:100%;margin-top:4px}[data-native-upgrade-center] .detail{margin-top:12px;padding:16px;border:1px solid #e4e4e0;background:#fafaf8;color:var(--muted,#6d7077);font-size:12px;line-height:1.75}[data-native-upgrade-center] .detail p{margin:0 0 10px}[data-native-upgrade-center] .detail p:last-child{margin-bottom:0}
        @media(max-width:760px){[data-native-upgrade-center] header{display:grid}[data-native-upgrade-center] .version{text-align:left}[data-native-upgrade-center] .grid{grid-template-columns:1fr}[data-native-upgrade-center] .grid>div{border-right:0!important;border-bottom:1px solid var(--line,#d9d9d6)}[data-native-upgrade-center] .grid>div:last-child{border-bottom:0}}
      `}</style>
      <header>
        <div><p className="kicker">PROGRAM / UPGRADE</p><h2>程序升级中心</h2></div>
        <div className="version"><small>当前程序版本</small><strong>v{PROGRAM_VERSION}</strong></div>
      </header>
      <div className="grid">
        <div><strong>程序可以独立升级</strong><small>以后更新功能时，不需要重新做一个网站。</small></div>
        <div><strong>D1 / KV 不动</strong><small>原数据库、图片、视频和媒体空间全部保留。</small></div>
        <div><strong>管理员与内容不动</strong><small>密码、恢复状态、草稿、发布内容和二维码全部保留。</small></div>
      </div>
      <p className="note">升级前 GPT 必须先确认当前 Worker、DB 和 MEDIA_KV 属于这个网站，再只更新程序代码和增量数据库迁移。禁止为了升级创建第二套 Worker、D1 或 KV。</p>
      <div className="actions">
        <button type="button" onClick={() => void copyPrompt()}>{copyLabel}</button>
        <details><summary>查看升级说明</summary><div className="detail">
          <p><strong>推荐配置：</strong>最低使用 GPT-5.6 Sol，思考程度使用“高”；遇到部署失败、资源绑定、数据库迁移或版本冲突时使用“超高”。</p>
          <p><strong>升级前读取：</strong>README.md、AGENTS.md、deployment/agent-manifest.json、deployment/template-version.json。</p>
          <p><strong>升级后检查：</strong>后台登录、图片读取、视频播放、草稿预览、正式发布和网站空间统计都要正常。</p>
          <p><strong>登录说明：</strong>输入正确管理员密码后，这台浏览器会记住登录状态 12 小时。12 小时内再次点“管理”会直接进入后台；点“安全退出”后立即失效。密码连续输错 5 次会锁定 15 分钟。</p>
        </div></details>
      </div>
    </section>
  );

  return (
    <>
      <span data-program-upgrade-center hidden aria-hidden="true" />
      {host ? createPortal(panel, host) : null}
    </>
  );
}
