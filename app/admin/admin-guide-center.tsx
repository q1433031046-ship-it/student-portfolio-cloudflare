"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PROGRAM_VERSION, UPGRADE_PROMPT_SYNC_EVENT, getUpgradePrompt } from "./admin-upgrade-content";
import { useScrollLock } from "../lib/use-scroll-lock";
import { closeAdminMobileMore } from "./mobile-more-contract";

const CENTRAL_GUIDE_URL = "https://github.com/q1433031046-ship-it/student-portfolio-cloudflare#readme";
const DEPLOY_URL = "https://deploy.workers.cloudflare.com/?url=https://github.com/q1433031046-ship-it/student-portfolio-cloudflare";
const OPEN_GUIDE_EVENT = "portfolio:open-guide";
const OPEN_UPGRADE_EVENT = "portfolio:open-upgrade";

const DEPLOY_PROMPT = `我要部署“学生作品展示”网站。请全程一步一步带我完成，一次只让我做一个主要动作。

开始前请先确认：
1. 能单独选择模型时优先使用 GPT-5.6 Sol；看不到单独模型时保留默认 Power。一般部署使用默认或 High（高）；复杂升级或故障时，按界面实际可用项提高到 High（高）或 Extra High（超高）。
2. 当前浏览器实际登录的是哪一个 GitHub 账号、哪一个 Cloudflare 账号。
3. 这是这个 GitHub / Cloudflare 账号里的第几个学生作品网站。
4. 如果账号里已有其他网站，请为本次网站规划新的仓库、Worker、D1 和 MEDIA_KV，保持资源完全独立。
5. 如果同一个 GPT 正在帮助不同学生，请以当前浏览器里的 GitHub / Cloudflare 登录身份为准。

公共模板配置只声明 DB 和 MEDIA_KV 绑定，不携带任何站点的真实资源 ID，也不携带固定 database_name。Cloudflare 必须按当前 Worker 名与绑定为本网站独立创建资源，并在平台支持时把精确 ID 写入本次克隆仓库的配置；同一账号的多个站点不得按固定数据库名复用 D1。首次部署完成后，请只读核对克隆仓库与当前 Worker 的 DB、MEDIA_KV ID 已固定且逐项一致；平台没有写回时停止后续自动升级准备，只从当前站点的 Cloudflare 官方资源界面精确补回，绝不猜测或复用其他站点的 ID。Workers Builds 提供 WRANGLER_CI_OVERRIDE_NAME 时，部署检查会先验证它并作为有效 Worker 名，状态、版本、资源指纹和最终部署必须始终指向该名称。

在要求我授权前，先分别对当前 GitHub 和 Cloudflare 连接执行一次无害的只读检查。只读检查成功就复用现有连接，不要再次打开授权页面。只有官方连接明确返回 Connect、Reconnect、授权已过期或权限不足时，才让我在官方页面授权一次。授权后重新执行同一只读检查，并从刚才中断的步骤继续；不要重新开始部署，不要重复创建仓库、Worker、D1 或 MEDIA_KV。若授权页面连续再次出现，立即停止并核对账号、目标站点和已经创建的资源。

账号和命名确认完成后，再带我打开官方 Deploy to Cloudflare：
${DEPLOY_URL}

请自动完成能够完成的检查、构建、迁移和验证。GitHub / Cloudflare 官方授权、一次性部署口令、管理员密码和系统恢复码由我本人操作。

以下信息始终由我本人在官方页面输入，不进入聊天：GitHub 密码、Cloudflare 密码、管理员密码、INITIAL_ADMIN_CODE、系统恢复码、浏览器 Cookie、长期 API Token。

首次部署完成后继续带我进入 /admin：使用一次性部署口令创建管理员密码、保存系统恢复码，并检查图片上传、可选 MP4（上传时检查播放；留空时检查 00:00 和无播放按钮）、草稿预览、正式发布、二维码访问、网站空间、使用教程和程序升级中心。`;

const toolbarStyles = `
[data-admin-tools]{display:flex;align-items:center;gap:8px}
[data-admin-tools] button{min-height:34px;padding:0 12px;border:1px solid var(--line,#d9d9d6);border-radius:999px;background:#fff;color:var(--ink,#101114);font:inherit;font-size:11px;font-weight:700;cursor:pointer;transition:border-color .18s ease,background .18s ease,transform .18s ease}
[data-admin-tools] button:hover{border-color:var(--accent,#3258ff);transform:translateY(-1px)}
[data-admin-tools] button:focus-visible{outline:3px solid color-mix(in srgb,var(--accent,#3258ff) 24%,transparent);outline-offset:2px}
[data-admin-tools] button[data-kind="upgrade"]{border-color:var(--accent,#3258ff);background:var(--accent,#3258ff);color:#fff}
@media(max-width:1120px){[data-admin-tools] button{padding:0 9px;font-size:10px}}
@media(max-width:820px){[data-admin-tools]{position:fixed;right:14px;bottom:14px;z-index:90;padding:8px;border:1px solid #d9d9d6;border-radius:999px;background:rgba(255,255,255,.96);box-shadow:0 12px 32px rgba(16,17,20,.14);backdrop-filter:blur(14px)}}
`;

const overlayStyles = `
[data-admin-guide-overlay]{--ink:#111217;--muted:#676b73;--line:#deded9;--paper:#f4f3ee;--card:#fff;--blue:#3159ff;position:fixed;inset:0;z-index:1000;overflow:auto;background:var(--paper);color:var(--ink);font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}
[data-admin-guide-overlay] *{box-sizing:border-box}
[data-admin-guide-overlay] a{color:inherit}
[data-admin-guide-overlay] button,[data-admin-guide-overlay] a{ -webkit-tap-highlight-color:transparent }
[data-admin-guide-overlay] :focus-visible{outline:3px solid rgba(49,89,255,.24);outline-offset:3px}
[data-admin-guide-overlay] .top{position:sticky;top:0;z-index:4;min-height:68px;padding:10px clamp(16px,4vw,54px);display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid var(--line);background:rgba(244,243,238,.96);backdrop-filter:blur(16px)}
[data-admin-guide-overlay] .top strong{font-size:15px}
[data-admin-guide-overlay] .top div{display:flex;flex-wrap:wrap;gap:8px}
[data-admin-guide-overlay] .top a,[data-admin-guide-overlay] .top button{min-height:38px;padding:0 13px;border:1px solid var(--line);border-radius:8px;background:#fff;color:inherit;font:inherit;font-size:11px;text-decoration:none;cursor:pointer}
[data-admin-guide-overlay] .top button.primary{border-color:var(--ink);background:var(--ink);color:#fff}
[data-admin-guide-overlay] .hero{padding:clamp(46px,7vw,86px) clamp(18px,5vw,74px) 44px;border-bottom:1px solid var(--line)}
[data-admin-guide-overlay] .eyebrow{margin:0 0 13px;color:var(--blue);font-size:9px;font-weight:800;letter-spacing:.18em}
[data-admin-guide-overlay] .hero h1{max-width:900px;margin:0;font-size:clamp(40px,6.5vw,76px);line-height:.96;letter-spacing:-.065em}
[data-admin-guide-overlay] .hero>p:last-of-type{max-width:780px;margin:24px 0 0;color:var(--muted);font-size:15px;line-height:1.8}
[data-admin-guide-overlay] .quickGrid{max-width:980px;margin-top:30px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
[data-admin-guide-overlay] .quickGrid a,[data-admin-guide-overlay] .quickGrid button{min-height:84px;padding:17px 18px;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;border:1px solid var(--line);border-radius:11px;background:#fff;color:inherit;text-align:left;text-decoration:none;cursor:pointer}
[data-admin-guide-overlay] .quickGrid b{font-size:14px}
[data-admin-guide-overlay] .quickGrid span{color:var(--muted);font-size:11px;line-height:1.5}
[data-admin-guide-overlay] .layout{width:min(1480px,100%);margin:0 auto;padding:42px clamp(16px,4vw,54px) 90px;display:grid;grid-template-columns:230px minmax(0,1fr);gap:42px}
[data-admin-guide-overlay] .nav{position:sticky;top:92px;align-self:start;display:grid;gap:3px;max-height:calc(100svh - 112px);overflow:auto;padding-right:6px}
[data-admin-guide-overlay] .nav a{padding:9px 11px;border-radius:7px;color:#545861;font-size:11px;text-decoration:none}
[data-admin-guide-overlay] .nav a:hover{background:#fff;color:var(--ink)}
[data-admin-guide-overlay] .content{min-width:0;max-width:1080px}
[data-admin-guide-overlay] section.guide{scroll-margin-top:92px;margin:0 0 62px}
[data-admin-guide-overlay] section.guide>header{margin-bottom:21px}
[data-admin-guide-overlay] section.guide h2{margin:0;font-size:clamp(28px,4vw,46px);letter-spacing:-.05em}
[data-admin-guide-overlay] section.guide h3{margin:26px 0 10px;font-size:20px;letter-spacing:-.03em}
[data-admin-guide-overlay] section.guide p,[data-admin-guide-overlay] section.guide li{color:var(--muted);font-size:13px;line-height:1.82}
[data-admin-guide-overlay] section.guide strong{color:var(--ink)}
[data-admin-guide-overlay] section.guide ul,[data-admin-guide-overlay] section.guide ol{padding-left:21px}
[data-admin-guide-overlay] .callout{margin:18px 0;padding:18px 20px;border:1px solid #ccd5ff;border-radius:11px;background:#f6f7ff}
[data-admin-guide-overlay] .callout.safe{border-color:#cfe3d5;background:#f5fbf7}
[data-admin-guide-overlay] .callout p{margin:5px 0 0}
[data-admin-guide-overlay] .steps{display:grid;gap:9px;counter-reset:guide-step}
[data-admin-guide-overlay] .step{position:relative;padding:19px 20px 19px 66px;border:1px solid var(--line);border-radius:10px;background:#fff}
[data-admin-guide-overlay] .step:before{counter-increment:guide-step;content:counter(guide-step);position:absolute;left:18px;top:18px;width:31px;height:31px;display:grid;place-items:center;border-radius:50%;background:var(--ink);color:#fff;font-size:11px;font-weight:800}
[data-admin-guide-overlay] .step p{margin:5px 0 0}
[data-admin-guide-overlay] .prompt{padding:18px;border-radius:11px;background:#111217;color:#f4f4f1}
[data-admin-guide-overlay] .prompt pre{margin:0;white-space:pre-wrap;word-break:break-word;font:11px/1.8 ui-monospace,SFMono-Regular,Consolas,monospace}
[data-admin-guide-overlay] .prompt button{margin-top:14px;min-height:36px;padding:0 12px;border:1px solid #4b4f59;border-radius:7px;background:#202229;color:#fff;cursor:pointer}
[data-admin-guide-overlay] .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
[data-admin-guide-overlay] .card{padding:20px;border:1px solid var(--line);border-radius:11px;background:#fff}
[data-admin-guide-overlay] .card h3{margin:0 0 7px;font-size:19px}
[data-admin-guide-overlay] .card p{margin:0}
[data-admin-guide-overlay] table{width:100%;border-collapse:collapse;border:1px solid var(--line);background:#fff}
[data-admin-guide-overlay] th,[data-admin-guide-overlay] td{padding:13px 14px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:11px;line-height:1.65}
[data-admin-guide-overlay] th{background:#ebeae5}
[data-admin-guide-overlay] tr:last-child td{border-bottom:0}
[data-admin-guide-overlay] code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
[data-admin-guide-overlay] .flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:18px 0}
[data-admin-guide-overlay] .flow div{padding:15px;border:1px solid var(--line);border-radius:8px;background:#fff;text-align:center;font-size:11px}
[data-admin-guide-overlay] .flow b{display:block;margin-bottom:4px;color:var(--blue)}
[data-admin-guide-overlay] .checks{columns:2;column-gap:34px}
[data-admin-guide-overlay] .inlineActions{display:flex;flex-wrap:wrap;gap:9px;margin-top:16px}
[data-admin-guide-overlay] .inlineActions button,[data-admin-guide-overlay] .inlineActions a{min-height:38px;padding:0 13px;border:1px solid var(--line);border-radius:8px;background:#fff;color:inherit;font:inherit;font-size:11px;text-decoration:none;cursor:pointer}
[data-admin-guide-overlay] .inlineActions .primary{border-color:var(--blue);background:var(--blue);color:#fff}
@media(max-width:900px){[data-admin-guide-overlay] .layout{grid-template-columns:1fr}[data-admin-guide-overlay] .nav{position:static;display:flex;overflow:auto;max-height:none;padding-bottom:8px}[data-admin-guide-overlay] .nav a{white-space:nowrap;border:1px solid var(--line);background:#fff}[data-admin-guide-overlay] .grid{grid-template-columns:1fr}[data-admin-guide-overlay] .flow{grid-template-columns:repeat(2,1fr)}[data-admin-guide-overlay] .quickGrid{grid-template-columns:1fr}}
@media(max-width:620px){[data-admin-guide-overlay] .top{align-items:flex-start}[data-admin-guide-overlay] .top div{justify-content:flex-end}[data-admin-guide-overlay] .hero{padding-top:40px}[data-admin-guide-overlay] table{display:block;overflow-x:auto}[data-admin-guide-overlay] .flow{grid-template-columns:1fr}[data-admin-guide-overlay] .checks{columns:1}}
`;

type OpenGuideDetail = { sectionId?: string };

function GuideHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <header><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></header>;
}

export function AdminGuideCenter() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [targetSection, setTargetSection] = useState<string | null>(null);
  const [deployCopy, setDeployCopy] = useState("复制部署引导语");
  const [upgradeCopy, setUpgradeCopy] = useState("复制升级指令");
  const [upgradePrompt, setUpgradePrompt] = useState(getUpgradePrompt);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useScrollLock(open);

  useEffect(() => {
    const locate = () => {
      const header = document.querySelector<HTMLElement>("header[class*='adminHeader']")
        ?? Array.from(document.querySelectorAll<HTMLElement>("header")).find((node) =>
          node.textContent?.includes("ONLINE") && node.textContent?.includes("打开已发布前台"),
        )
        ?? null;
      const mobileHost = document.querySelector<HTMLElement>("[data-admin-mobile-more-actions]");
      const headerHost = header?.querySelector<HTMLElement>(":scope > div") ?? header?.querySelector<HTMLElement>("div") ?? null;
      const actionHost = window.matchMedia("(max-width: 720px)").matches && mobileHost ? mobileHost : headerHost;
      setHost((current) => current === actionHost ? current : actionHost);
    };
    locate();
    const media = window.matchMedia("(max-width: 720px)");
    media.addEventListener("change", locate);
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { media.removeEventListener("change", locate); observer.disconnect(); };
  }, []);

  useEffect(() => {
    const refreshUpgradePrompt = () => setUpgradePrompt(getUpgradePrompt());
    window.addEventListener(UPGRADE_PROMPT_SYNC_EVENT, refreshUpgradePrompt);
    return () => window.removeEventListener(UPGRADE_PROMPT_SYNC_EVENT, refreshUpgradePrompt);
  }, []);

  useEffect(() => {
    const handleOpenGuide = (event: Event) => {
      const detail = (event as CustomEvent<OpenGuideDetail>).detail;
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setTargetSection(detail?.sectionId ?? null);
      setOpen(true);
    };
    window.addEventListener(OPEN_GUIDE_EVENT, handleOpenGuide);
    return () => window.removeEventListener(OPEN_GUIDE_EVENT, handleOpenGuide);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeGuide(); };
    window.addEventListener("keydown", closeOnEscape);
    const timer = window.setTimeout(() => {
      if (targetSection) document.getElementById(targetSection)?.scrollIntoView({ block: "start" });
      else document.querySelector<HTMLElement>("[data-admin-guide-overlay]")?.scrollTo({ top: 0 });
      closeButtonRef.current?.focus();
    }, 20);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, targetSection]);

  function openGuide(sectionId?: string) {
    closeAdminMobileMore();
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTargetSection(sectionId ?? null);
    setOpen(true);
  }

  function closeGuide() {
    setOpen(false);
    setTargetSection(null);
    window.setTimeout(() => previousFocusRef.current?.focus(), 0);
  }

  function openUpgradeCenter() {
    closeAdminMobileMore();
    setOpen(false);
    setTargetSection(null);
    window.setTimeout(() => window.dispatchEvent(new Event(OPEN_UPGRADE_EVENT)), 0);
  }

  async function copy(value: string, kind: "deploy" | "upgrade") {
    try {
      await navigator.clipboard.writeText(value);
      if (kind === "deploy") setDeployCopy("已复制部署引导语");
      else setUpgradeCopy("已复制升级指令");
      window.setTimeout(() => {
        if (kind === "deploy") setDeployCopy("复制部署引导语");
        else setUpgradeCopy("复制升级指令");
      }, 1800);
    } catch {
      if (kind === "deploy") setDeployCopy("复制失败，请重试");
      else setUpgradeCopy("复制失败，请重试");
    }
  }

  const tools = (
    <div data-admin-tools aria-label="后台帮助工具">
      <button type="button" data-kind="guide" onClick={() => openGuide()}>使用教程</button>
      <button type="button" data-kind="upgrade" onClick={openUpgradeCenter}>程序升级</button>
    </div>
  );

  const overlay = open ? (
    <div data-admin-guide-overlay role="dialog" aria-modal="true" aria-labelledby="admin-guide-title">
      <style>{overlayStyles}</style>
      <header className="top">
        <strong>学生作品展示 · 后台使用教程</strong>
        <div>
          <a href={CENTRAL_GUIDE_URL} target="_blank" rel="noreferrer">在 GitHub 打开完整指南 ↗</a>
          <button ref={closeButtonRef} className="primary" type="button" onClick={closeGuide}>关闭教程</button>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">ADMIN GUIDE / V{PROGRAM_VERSION}</p>
        <h1 id="admin-guide-title">先找到要做的事，<br/>再按步骤完成。</h1>
        <p>教程按“部署、编辑、发布、升级”四条主线整理。安全信息集中在一处说明，操作步骤保持短句和单一动作。</p>
        <div className="quickGrid">
          <a href="#admin-guide-sections"><b>编辑现有网站</b><span>查看后台每一栏和媒体尺寸</span></a>
          <a href="#admin-guide-deploy"><b>部署新网站</b><span>从 GPT 核对账号到 Cloudflare 完成部署</span></a>
          <button type="button" onClick={openUpgradeCenter}><b>升级当前网站</b><span>定位升级中心并复制升级指令</span></button>
        </div>
      </section>

      <div className="layout">
        <nav className="nav" aria-label="教程目录">
          <a href="#admin-guide-logic">整体逻辑</a>
          <a href="#admin-guide-prepare">部署准备</a>
          <a href="#admin-guide-gpt">GPT 设置</a>
          <a href="#admin-guide-deploy">一键部署</a>
          <a href="#admin-guide-first">第一次进后台</a>
          <a href="#admin-guide-sections">后台栏目</a>
          <a href="#admin-guide-sizes">图片 / 视频尺寸</a>
          <a href="#admin-guide-crop">裁切与排版</a>
          <a href="#admin-guide-publish">草稿与发布</a>
          <a href="#admin-guide-qr">二维码</a>
          <a href="#admin-guide-password">密码与恢复</a>
          <a href="#admin-guide-accounts">多账号 / 多网站</a>
          <a href="#admin-guide-upgrade">程序升级</a>
          <a href="#admin-guide-errors">常见问题</a>
          <a href="#admin-guide-checks">验收清单</a>
        </nav>

        <div className="content">
          <section className="guide" id="admin-guide-logic">
            <GuideHeader eyebrow="00 / LOGIC" title="先看懂整个逻辑" />
            <div className="callout"><strong>标准流程</strong><p>GitHub 中央指南 → GPT 核对账号 → Cloudflare 一键部署 → 创建管理员 → 后台编辑 → 快速预览 → 正式发布。</p></div>
            <ul>
              <li>GitHub 仓库首页是部署前的公开指南。</li>
              <li>作品前台面向访客；后台与本教程使用管理员会话保护。</li>
              <li>同一个 GPT 可以帮助多人，网站归属由浏览器中的 GitHub / Cloudflare 登录身份决定。</li>
              <li>每个站点使用独立 Worker、D1 和 MEDIA_KV。</li>
            </ul>
            <div className="callout safe"><strong>安全边界</strong><p>只把遮住个人信息与秘密的局部截图、项目名和构建错误交给 GPT。密码、INITIAL_ADMIN_CODE、恢复码、Token、Cookie、二维码和访问链接只在官方页面或网站后台使用，不进入聊天或截图。</p></div>
          </section>

          <section className="guide" id="admin-guide-prepare">
            <GuideHeader eyebrow="01 / PREPARE" title="部署前准备" />
            <p>准备 ChatGPT、GitHub、Cloudflare 三个可正常登录的账号、可接收验证码的邮箱、Chrome 或 Edge，以及手机二步验证。Google / Gmail 不是硬性要求，关键是记清各账号的原始登录方式。</p>
            <p>正常部署无需提前创建 OpenAI API Key、Cloudflare API Token、GitHub Personal Access Token 或其他长期密钥。</p>
          </section>

          <section className="guide" id="admin-guide-gpt">
            <GuideHeader eyebrow="02 / GPT" title="先打开 GPT，再部署" />
            <div className="callout"><strong>推荐配置</strong><p>能单独选择时优先 GPT-5.6 Sol；看不到单独模型时保留默认 Power。一般部署使用默认或 High（高），复杂升级或故障按界面实际可用项提高到 High（高）或 Extra High（超高）。</p></div>
            <h3>在 ChatGPT 里具体怎么点</h3>
            <div className="steps">
              <div className="step"><strong>打开 ChatGPT 并新建对话</strong><p>在电脑浏览器登录自己的账号，进入“工作”或普通对话。</p></div>
              <div className="step"><strong>选择可用模型</strong><p>能单独选择时优先 GPT-5.6 Sol；没有选择器就保留默认 Power。</p></div>
              <div className="step"><strong>按任务调整思考程度</strong><p>一般部署使用默认或 High；复杂构建、迁移或升级使用界面提供的 High 或 Extra High。</p></div>
              <div className="step"><strong>完整复制部署引导语</strong><p>保留账号核对、资源隔离和秘密保护规则。</p></div>
              <div className="step"><strong>先完成账号核对</strong><p>确认当前学生、GitHub 登录身份、Cloudflare 登录身份和网站序号。</p></div>
              <div className="step"><strong>确认独立资源命名</strong><p>新站使用新的仓库、Worker、D1 和 MEDIA_KV。</p></div>
              <div className="step"><strong>完成核对后进入 Cloudflare</strong><p>由 GPT 给出下一步，一次执行一个主要动作。</p></div>
            </div>
            <h3>复制给 GPT</h3>
            <div className="prompt"><pre>{DEPLOY_PROMPT}</pre><button type="button" onClick={() => void copy(DEPLOY_PROMPT, "deploy")}>{deployCopy}</button></div>
          </section>

          <section className="guide" id="admin-guide-deploy">
            <GuideHeader eyebrow="03 / DEPLOY" title="Cloudflare 一键部署：逐步操作" />
            <div className="callout safe"><strong>免费方案边界</strong><p>新站媒体使用 MEDIA_KV，不需要启用 R2。页面要求开通 R2、付费套餐或订阅时，先停止，只提供遮挡后的局部截图核对。</p></div>
            <div className="callout"><strong>模板不携带站点资源 ID</strong><p>公共模板只声明 DB 和 MEDIA_KV 绑定，不携带任何站点的真实资源 ID，也不携带固定 database_name；Cloudflare 按当前 Worker 与绑定为本网站独立创建资源，同一账号内不得按固定数据库名复用 D1。</p></div>
            <div className="callout"><strong>防止反复授权</strong><p>先做 GitHub 和 Cloudflare 官方连接的只读检查；检查成功直接复用。仅在明确要求 Connect、Reconnect、授权过期或权限不足时授权一次，随后从中断步骤继续。</p></div>
            <div className="steps">
              <div className="step"><strong>确认 GitHub 和 Cloudflare</strong><p>核对当前学生自己的账号，以及这是第几个网站。</p></div>
              <div className="step"><strong>先检查连接是否有效</strong><p>由 GPT 运行无害的只读检查；成功后不要再次登录或授权。</p></div>
              <div className="step"><strong>打开官方部署入口</strong><p><a href={DEPLOY_URL} target="_blank" rel="noreferrer"><b>Deploy to Cloudflare</b></a> 会复制模板并准备站点资源。</p></div>
              <div className="step"><strong>仅在需要时授权一次</strong><p>确认 GitHub 用户名后完成官方授权，再用同一只读检查确认连接。</p></div>
              <div className="step"><strong>从中断步骤继续</strong><p>不要从头部署，不要重复创建仓库、Worker、D1 或 MEDIA_KV。</p></div>
              <div className="step"><strong>按原方式登录 Cloudflare</strong><p>使用创建账号时的 Google、GitHub、Apple 或邮箱密码方式。</p></div>
              <div className="step"><strong>填写唯一项目名称</strong><p>推荐 <code>student-portfolio-姓名拼音-01</code>；后续网站使用 <code>-02</code>、<code>-03</code>。</p></div>
              <div className="step"><strong>确认独立资源</strong><p>D1 绑定名为 DB，KV 绑定名为 MEDIA_KV；需要选择时使用 Create new。</p></div>
              <div className="step"><strong>设置 INITIAL_ADMIN_CODE</strong><p>使用 Secret 类型，至少 16 位，同时包含英文字母和数字。</p></div>
              <div className="step"><strong>保持构建默认值</strong><p>main、npm run build、npm run deploy、根目录默认值。</p></div>
              <div className="step"><strong>点击 Deploy 并等待成功</strong><p>保持页面打开，完成后保存仓库、Worker、前台和后台地址。</p></div>
              <div className="step"><strong>只读核对资源 ID</strong><p>首次部署完成后，让 GPT 核对克隆仓库与当前 Worker 的 DB、MEDIA_KV ID 已固定且一致。平台没有写回时停止后续自动升级准备，只从当前站点官方资源界面精确补回；不得猜测或复用其他站点 ID。</p></div>
              <div className="step"><strong>锁定有效 Worker 名</strong><p>Workers Builds 提供 WRANGLER_CI_OVERRIDE_NAME 时，部署检查会验证并把它作为有效 Worker 名；状态、版本、资源指纹和最终部署必须指向同一名称。</p></div>
            </div>
            <h3>“Set up your application” 字段对照</h3>
            <table><thead><tr><th>字段</th><th>处理方式</th></tr></thead><tbody>
              <tr><td>Git account</td><td>当前学生自己的 GitHub。</td></tr>
              <tr><td>Project / Repository</td><td>使用唯一名称；同账号第二个网站加 -02。</td></tr>
              <tr><td>D1 / DB</td><td>自动创建或 Create new，使用本网站独立数据库。</td></tr>
              <tr><td>KV / MEDIA_KV</td><td>自动创建或 Create new，使用本网站独立媒体空间。</td></tr>
              <tr><td>INITIAL_ADMIN_CODE</td><td>Secret；至少 16 位字母和数字。</td></tr>
              <tr><td>Build / Deploy</td><td>保留 npm run build / npm run deploy。</td></tr>
              <tr><td>Root directory</td><td>保持 /、留空或页面默认值。</td></tr>
            </tbody></table>
          </section>

          <section className="guide" id="admin-guide-first">
            <GuideHeader eyebrow="04 / FIRST LOGIN" title="第一次进入后台" />
            <ol>
              <li>打开部署后网站地址并在末尾加 <code>/admin</code>。</li>
              <li>输入部署时设置的一次性部署口令。</li>
              <li>创建 10 至 128 位、至少包含文字和数字的管理员密码。</li>
              <li>下载系统恢复码并离线保存。</li>
              <li>确认恢复码已保存后进入后台。</li>
            </ol>
            <p>第一次发布前打开前台会显示“网站尚未发布”，属于正常状态；完成内容后到“发布”栏生成第一份公开快照。</p>
          </section>

          <section className="guide" id="admin-guide-sections">
            <GuideHeader eyebrow="05 / ADMIN" title="后台每一栏怎么用" />
            <div className="grid">
              <article className="card"><h3>概览</h3><p>网站名称、二维码访问、数据统计、网站空间、程序版本和升级中心。</p></article>
              <article className="card"><h3>联系方式</h3><p>后台菜单名称是“联系方式”；可编辑邮箱、电话、联系图片、左右排版和画布文字位置。</p></article>
              <article className="card"><h3>首图与文字</h3><p>多张首图、纯图片 / 系统排版 / 自由排版、主题、字体和个人定位。</p></article>
              <article className="card"><h3>作品分类</h3><p>新建分类先填名称并保存草稿，再上传 8:1 自定义过渡图；还可调整颜色和顺序。</p></article>
              <article className="card"><h3>作品</h3><p>新建作品先填名称、选分类并保存草稿，再上传 16:9 封面或“成稿视频（可选）”。无视频可发布并显示 00:00；已有视频可点“移除成稿视频”后保存、发布。</p></article>
              <article className="card"><h3>封底</h3><p>多张封底分别上传、裁切、复制、排序、删除和排版，显示在全部作品之后、页脚之前。</p></article>
              <article className="card"><h3>发布</h3><p>检查必要媒体并生成公开快照。</p></article>
              <article className="card"><h3>记录</h3><p>访问、播放请求、播放错误和管理操作。</p></article>
              <article className="card"><h3>帮助工具</h3><p>宽屏时右上角显示“使用教程”和“程序升级”；手机从底部操作栏打开“更多”，再进入对应入口。</p></article>
            </div>
          </section>

          <section className="guide" id="admin-guide-sizes">
            <GuideHeader eyebrow="06 / MEDIA" title="图片与视频建议尺寸" />
            <p>图片支持 JPG、PNG、WebP、AVIF。系统会尝试转为 WebP 并把最长边控制在 2560 像素以内；优化后单张上限为 8 MiB。</p>
            <table><thead><tr><th>位置</th><th>比例</th><th>建议尺寸</th><th>构图建议</th></tr></thead><tbody>
              <tr><td>首页首图</td><td>自由裁切</td><td>2560 × 1440</td><td>主体放中间 60%，四周预留裁切空间。</td></tr>
              <tr><td>联系图片</td><td>1:1</td><td>1600 × 1600</td><td>主体居中并留边。</td></tr>
              <tr><td>分类过渡图</td><td>8:1</td><td>2560 × 320</td><td>横向纹理、环境或大留白。</td></tr>
              <tr><td>项目封面</td><td>16:9</td><td>1920 × 1080 / 2560 × 1440</td><td>重要内容放安全区。</td></tr>
              <tr><td>封底</td><td>16:9</td><td>1920 × 1080 / 2560 × 1440</td><td>每张独立构图，主体放中央安全区。</td></tr>
              <tr><td>图文混排</td><td>4:3</td><td>2000 × 1500</td><td>左右保留空间。</td></tr>
              <tr><td>图片组竖图</td><td>3:4</td><td>1500 × 2000</td><td>同组统一色调和主体比例。</td></tr>
              <tr><td>图片组横图</td><td>4:3</td><td>2000 × 1500</td><td>同组统一视觉风格。</td></tr>
              <tr><td>通栏图片</td><td>16:9</td><td>1920 × 1080 / 2560 × 1440</td><td>关键内容放中央安全区。</td></tr>
              <tr><td>成稿视频（可选）</td><td>推荐 16:9</td><td>1920 × 1080</td><td>MP4、H.264 / AAC、≤ 50 MB。</td></tr>
            </tbody></table>
            <h3>视频压缩参考</h3>
            <ul><li>30 秒：约 8–10 Mbps。</li><li>60 秒：约 5–6 Mbps。</li><li>120 秒：约 2.5–3 Mbps。</li><li>推荐 24、25 或 30 fps。</li></ul>
            <p>最终以导出文件实际小于 50 MB 为准；1080p 足够用于作品展示。</p>
          </section>

          <section className="guide" id="admin-guide-crop">
            <GuideHeader eyebrow="07 / CROP" title="裁切、排版与预览" />
            <ul>
              <li>上传后先使用默认裁切。</li>
              <li>点击“调整裁切”后显示裁切框；完成后点击“确认裁切”。</li>
              <li>项目封面、图文、图片组和通栏图按各自比例裁切。</li>
              <li>首图支持自由裁切。</li>
              <li>文字可在真实画布中拖动，轻点文字可直接修改。</li>
              <li>中文可直接输入；中文输入法按 Enter 选词时不会提前结束编辑。</li>
              <li>项目封面以“桌面 16:9”检查字号、位置与换行。</li>
              <li>手机快速预览复用同一份草稿，可直接定位首图、当前作品、联系模块或封底，不会保存另一套手机坐标或裁切。</li>
              <li>手机裁切以全屏方式打开，支持拖动、双指缩放、重置、取消恢复和确认写入。</li>
              <li>上传进行中不能切换栏目、预览、保存或发布；失败后可重试、关闭提示或定位。</li>
              <li>封面与联系模块会即时显示排版结果。</li>
              <li>出现“媒体已上传，等待草稿保存”时，本地预览会保留；先保存草稿，再点“重新检查”。</li>
              <li>联系标题、作品区标题、项目说明和内容块文字等可选字段允许留空，前台会自动隐藏。</li>
              <li>报错会写明第几个作品、第几个内容块、具体字段和字符数；点击“定位并修改”可打开并高亮输入框。</li>
            </ul>
          </section>

          <section className="guide" id="admin-guide-publish">
            <GuideHeader eyebrow="08 / PUBLISH" title="保存草稿与正式发布" />
            <div className="flow"><div><b>1</b>编辑</div><div><b>2</b>保存草稿</div><div><b>3</b>快速预览</div><div><b>4</b>正式发布</div></div>
            <ul>
              <li>保存草稿更新后台版本，公开前台保持当前内容。</li>
              <li>点击“快速预览”时，快速预览会先自动保存当前修改，再打开管理员草稿版本。</li>
              <li>正式发布生成公开快照，访客看到新内容。</li>
              <li>新建作品先填名称和分类、新建分类先填名称，保存草稿后再上传媒体。</li>
              <li>每次上传或替换图片后先保存草稿，再切换作品或后台栏目。</li>
              <li>左下角显示“有未保存修改”时，保存后再离开。</li>
              <li>“发布”栏有修改时显示“保存并发布 →”，草稿已保存时显示“发布当前草稿 →”。</li>
              <li>第一次发布前的公开首页显示“网站尚未发布”。</li>
            </ul>
          </section>

          <section className="guide" id="admin-guide-qr">
            <GuideHeader eyebrow="09 / QR" title="二维码访问" />
            <p>普通前台开始为“公开访问”。先填写名称并点“生成二维码密钥”，至少有一张可用二维码后，再把开关切换为“限制访问已开启”。每张二维码用“停用”“启用”和“删除”管理。</p>
            <ul>
              <li>扫码或打开访问链接后先进入确认页；确认页不会扣除次数。</li>
              <li>点击“打开作品集”才计为 1 次成功使用。</li>
              <li>二维码访客会话固定为 24 小时；重复打开不扣次数，也不会延长到期时间。</li>
              <li>次数耗尽只阻止新浏览器进入，已经建立的会话继续到自身到期。</li>
              <li>二维码暂停、删除或到期后，关联会话立即失效。</li>
              <li>管理员登录仍为 12 小时，与二维码访客会话互不影响。</li>
            </ul>
          </section>

          <section className="guide" id="admin-guide-password">
            <GuideHeader eyebrow="10 / PASSWORD" title="密码、12 小时登录与恢复码" />
            <ul>
              <li>输入正确管理员密码后，这台浏览器保持登录 12 小时。</li>
              <li>12 小时内再次点“管理”通常直接进入后台。</li>
              <li>点击“安全退出”后当前会话立即结束。</li>
              <li>同一 Cloudflare 客户网络连续输错 5 次管理员密码后，只锁定该网络的密码登录 15 分钟；其他网络不受影响。</li>
              <li>高熵系统恢复码使用独立校验流程，不受密码网络锁定影响；错误恢复码不会触发密码登录锁定。</li>
              <li>恢复码使用后自动轮换，新码需要重新保存。</li>
              <li>每次正式升级后，使用升级前保存的当前最新恢复码确认一次；确认后下载并保存新码。</li>
              <li>从 v1.2.0 起，确认完成后的管理员密码、恢复码和会话不再依赖一次性部署口令。</li>
              <li>v1.3.0 正式确认会撤销旧管理员会话；当前浏览器随后获得新的 12 小时会话。</li>
              <li>新文件名为“{'{hostname}'}-v1.3.0-系统恢复码-{'{YYYYMMDDTHHMMSSZ}'}.txt”；下载后实际打开，核对站点和版本。</li>
              <li>管理员密码和最新恢复码分开离线保存。</li>
            </ul>
          </section>

          <section className="guide" id="admin-guide-accounts">
            <GuideHeader eyebrow="11 / ACCOUNTS" title="多账号与多网站" />
            <h3>一个 GPT 帮不同学生部署</h3>
            <p>每次重新确认当前学生、GitHub 登录身份、Cloudflare 登录身份、网站序号和目标资源名称。GPT 是操作助手，实际授权账号决定网站归属。</p>
            <h3>同一托管账号部署多个网站</h3>
            <p>每个网站分别拥有仓库、Worker、D1、MEDIA_KV、地址、管理员密码和恢复码。推荐使用 <code>-01</code>、<code>-02</code>、<code>-03</code> 区分。</p>
          </section>

          <section className="guide" id="admin-guide-upgrade">
            <GuideHeader eyebrow="12 / UPGRADE" title="程序升级" />
            <p>满足资源前置条件的升级会沿用当前 Worker、地址、D1、MEDIA_KV、Secrets、管理员身份和全部内容。版本清单可以从主模板发现更新；升级指令只从对应发布标签读取，并通过 SHA-256 后显示。</p>
            <div className="callout safe"><strong>先打开当前恢复码文件</strong><p>确认文件属于当前 workers.dev 站点，只向 GPT 说明“已经保存”，不要发送内容。v1.3.0 确认会轮换恢复码、重设密码验证并撤销旧管理员会话。</p></div>
            <div className="callout"><strong>先核对升级前置资源</strong><p>自动升级要求原站已有固定 D1 DB ID 和唯一 MEDIA_KV ID，当前 Worker 也使用相同绑定。纯 v1.0 R2-only 站点没有 MEDIA_KV，本版本未支持直接自动升级；GPT 必须在指纹和部署前停止，不得创建、复用或认领新的 MEDIA_KV，不得改动任何远端资源。</p></div>
            <div className="callout"><strong>旧仓库使用已验证工具</strong><p>前置条件满足后，GPT 会在原站仓库外的隔离工作树验证 v1.3.0；指纹脚本把 Wrangler 的运行目录固定在已验证标签工作树根目录，再用原站 wrangler.jsonc 只读记录指纹。然后把已验证源码收敛进原站工作树，恢复原资源配置并再比对一次指纹。升级前基线用 0600 权限只捕获一次，跨失败续跑保留；隔离工作树不部署。</p></div>
            <div className="callout"><strong>旧 R2 只走条件分支</strong><p>没有 R2 媒体行时继续使用 MEDIA_KV。有旧行时，“概览”会显示“R2 → MEDIA_KV”；保留同一 BUCKET，点击“开始逐块迁移并校验”。程序会固定原 R2 对象 ETag，逐块复制校验后进入可续跑的 final-verifying 最终 KV 复验；每次重读一块并核对字节数、SHA-256，全量复验通过才切换。旧 50–90 MiB 媒体保留，程序不会自动删除 R2 源对象。</p></div>
            <div className="callout"><strong>新版本提醒</strong><p>登录后台后会检查版本；发现更新时右上角“程序升级”显示小红点。远程标签或摘要校验失败时继续使用当前版本内置的安全指令。</p></div>
            <h3>学生要做的 8 步</h3>
            <div className="steps">
              <div className="step"><strong>打开当前恢复码文件</strong><p>核对站点地址，并把恢复码继续留在本地。</p></div>
              <div className="step"><strong>复制升级指令</strong><p>点击下方“复制升级指令”，完整发给 GPT。</p></div>
              <div className="step"><strong>确认前置资源并等待部署</strong><p>先确认 GPT 报告固定 DB ID、唯一 MEDIA_KV ID 与当前 Worker 绑定一致；缺少时停止。满足后，确认它已记录原分支和 commit、检查未提交改动；有改动就先停止并做可恢复保存。再用隔离工作树和原站配置记录升级前指纹，在原站更新源码后复核指纹并运行严格升级。自动 Builds 的关闭失败不算升级结果。</p></div>
              <div className="step"><strong>返回原来的 /admin</strong><p>使用升级前记录的同一个 workers.dev 地址。</p></div>
              <div className="step"><strong>完成一次升级确认</strong><p>输入“当前最新系统恢复码”“管理员密码”“再次输入密码”，点击“确认升级并进入后台 →”。</p></div>
              <div className="step"><strong>下载并打开新文件</strong><p>文件名为“{'{hostname}'}-v1.3.0-系统恢复码-{'{YYYYMMDDTHHMMSSZ}'}.txt”；核对站点与版本 v1.3.0。</p></div>
              <div className="step"><strong>进入后台</strong><p>离线保存文件后，点击“我已妥善保存，进入后台 →”。</p></div>
              <div className="step"><strong>完成旧媒体并对照基线</strong><p>若“概览”出现“R2 → MEDIA_KV”，点“开始逐块迁移并校验”直到完成并抽查；再核对 Worker、地址、D1、MEDIA_KV、可选 BUCKET、数据计数与迁移状态。无生产证据的项目记为“未验证”。</p></div>
            </div>
            <div className="prompt"><pre>{upgradePrompt}</pre><button type="button" onClick={() => void copy(getUpgradePrompt(), "upgrade")}>{upgradeCopy}</button></div>
            <div className="inlineActions"><button className="primary" type="button" onClick={openUpgradeCenter}>定位后台升级中心</button></div>
          </section>

          <section className="guide" id="admin-guide-errors">
            <GuideHeader eyebrow="13 / HELP" title="常见问题" />
            <div className="grid">
              <article className="card"><h3>为什么会直接进入后台</h3><p>浏览器仍在 12 小时登录期内；安全退出后可重新验证密码门禁。</p></article>
              <article className="card"><h3>Cloudflare 登录方式提示</h3><p>改用创建账号时的 Google、GitHub、Apple 或邮箱密码方式。</p></article>
              <article className="card"><h3>授权页面反复出现</h3><p>停止重复点击；先只读检查连接，核对账号和已有资源，再从中断步骤继续。</p></article>
              <article className="card"><h3>项目名称重复</h3><p>新站名称使用 -02 / -03，并创建独立资源。</p></article>
              <article className="card"><h3>构建没有成功</h3><p>查看日志底部红色错误，修复当前项目并沿用已创建资源。</p></article>
              <article className="card"><h3>图片上传没有完成</h3><p>检查格式和大小，最长边建议控制在 2560 像素以内。</p></article>
              <article className="card"><h3>图片等待保存或预览读取失败</h3><p>先保存草稿，再点“重新检查”；不要重复上传同一张图。</p></article>
              <article className="card"><h3>视频上传没有完成</h3><p>视频可留空；已有视频要改为无视频时，到“作品 → 成稿视频（可选）”点“移除成稿视频”，再保存草稿并发布。需要上传时确认是 H.264 / AAC MP4 且小于 50 MiB。</p></article>
              <article className="card"><h3>快速预览没有打开</h3><p>允许当前站点打开弹出窗口。</p></article>
              <article className="card"><h3>保存后前台仍是旧内容</h3><p>进入“发布”生成公开快照，再刷新前台。</p></article>
            </div>
          </section>

          <section className="guide" id="admin-guide-checks">
            <GuideHeader eyebrow="14 / CHECK" title="最终验收清单" />
            <ul className="checks">
              <li>仓库、Worker 属于当前学生。</li><li>D1 / KV 为本网站独立资源；有旧 R2 时 BUCKET 属于同站。</li><li>前台和后台可打开。</li><li>恢复码已离线保存。</li><li>正式升级后已保存并打开新的站点专属恢复码文件，旧恢复码和旧管理员会话失效。</li><li>安全退出后重新进入要密码。</li><li>首图、联系图、封面“调整裁切”正常。</li><li>封面桌面 16:9 的字号、位置与换行正常。</li><li>320、360 和 390 px 手机宽度下前台无整页水平滚动，首图、作品、联系、视频和封底正常。</li><li>手机后台只有一条底部操作栏，栏目导航、“更多”、保存状态和错误定位可用。</li><li>手机预览复用真实作品树并可定位内容；全屏裁切、取消恢复和确认写入正常。</li><li>上传进行中阻止切换、预览、保存和发布；失败后可重试、关闭或定位。</li><li>多张封底独立编辑并位于作品之后、页脚之前。</li><li>中文和空白可选字段保存正常，错误可精确定位。</li><li>上传后未保存并切换栏目仍能预览。</li><li>图片组与通栏图正常。</li><li>无视频可发布、显示 00:00 且无播放按钮；有视频时可播放和拖动。</li><li>有视频时，用独立浏览器配置文件或独立 Cookie jar 建立 10 个独立 Cookie 会话。</li><li>保存草稿不改变前台。</li><li>快速预览可打开并先自动保存修改。</li><li>“保存并发布 →”“发布当前草稿 →”状态正确。</li><li>先“生成二维码密钥”再开启限制访问，“停用”“启用”规则正常。</li><li>网站空间统计正常。</li><li>使用教程可打开。</li><li>程序升级可定位并复制已校验指令。</li><li>大陆手机流量和常用宽带由所有者人工验收。</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <style>{toolbarStyles}</style>
      {host ? createPortal(tools, host) : null}
      {overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}
