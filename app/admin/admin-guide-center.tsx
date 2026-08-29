"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const CENTRAL_GUIDE_URL = "https://github.com/q1433031046-ship-it/student-portfolio-cloudflare#readme";
const DEPLOY_URL = "https://deploy.workers.cloudflare.com/?url=https://github.com/q1433031046-ship-it/student-portfolio-cloudflare";

const DEPLOY_PROMPT = `我要部署“学生作品展示”网站。请全程一步一步带我完成，一次只让我做一个主要动作，不要一次发很多步骤。

开始前请先确认：
1. 我使用的模型至少是 GPT-5.6 Sol，思考程度为“高”；复杂故障时提醒我改成“超高”。
2. 当前实际操作浏览器里登录的是哪一个 GitHub 账号、哪一个 Cloudflare 账号。
3. 这是这个 GitHub / Cloudflare 账号里的第几个学生作品网站；如果已经有其他网站，必须为这次网站使用新的仓库、Worker、D1 和 MEDIA_KV，绝不能复用旧网站的数据资源。
4. 如果同一个 GPT 账号正在帮助不同学生，必须以当前浏览器里的 GitHub / Cloudflare 登录身份为准，发现还是上一位学生的账号就先停止并让我切换。

确认账号无误后，再带我打开官方 Deploy to Cloudflare：
${DEPLOY_URL}

部署时请自动完成你能够完成的检查、构建、迁移和验证。只有 GitHub / Cloudflare 官方授权、一次性部署口令、管理员密码、系统恢复码需要我本人操作时再叫我。

不要向我索取或让我发送：GitHub 密码、Cloudflare 密码、管理员密码、INITIAL_ADMIN_CODE、系统恢复码、浏览器 Cookie、长期 API Token。

首次部署完成后继续带我进入 /admin：用一次性部署口令创建管理员密码、保存系统恢复码，然后检查图片上传、MP4 播放、草稿预览、正式发布、二维码访问、网站空间和程序升级中心是否正常。`;

const UPGRADE_PROMPT = `请把我的“学生作品展示”网站升级到模板最新版本。先确认当前要升级的具体网站、Worker、D1 DB 和 MEDIA_KV，再读取 README.md、AGENTS.md、deployment/agent-manifest.json 和 deployment/template-version.json。只更新程序代码和增量数据库迁移，必须保留当前网站地址、D1、MEDIA_KV、管理员账号、Secrets、图片、视频、草稿、已发布内容、二维码和访问记录。不要创建新的 Worker、D1 或 KV，也不要覆盖现有资源 ID。升级完成后检查后台登录、图片、视频、草稿预览、正式发布和网站空间。`;

const styles = `
[data-admin-guide-button]{padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
[data-admin-guide-button]:hover{text-decoration:underline}
[data-admin-guide-overlay]{--ink:#111217;--muted:#676b73;--line:#deded9;--paper:#f4f3ee;--blue:#3159ff;position:fixed;inset:0;z-index:1000;overflow:auto;background:var(--paper);color:var(--ink);font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}
[data-admin-guide-overlay] *{box-sizing:border-box}
[data-admin-guide-overlay] a{color:inherit}
[data-admin-guide-overlay] .top{position:sticky;top:0;z-index:3;min-height:68px;padding:10px clamp(16px,4vw,54px);display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid var(--line);background:rgba(244,243,238,.96);backdrop-filter:blur(16px)}
[data-admin-guide-overlay] .top strong{font-size:15px}
[data-admin-guide-overlay] .top div{display:flex;flex-wrap:wrap;gap:8px}
[data-admin-guide-overlay] .top a,[data-admin-guide-overlay] .top button{min-height:38px;padding:0 13px;border:1px solid var(--line);border-radius:8px;background:#fff;color:inherit;font:inherit;font-size:11px;text-decoration:none;cursor:pointer}
[data-admin-guide-overlay] .top button.primary{border-color:var(--ink);background:var(--ink);color:#fff}
[data-admin-guide-overlay] .hero{padding:clamp(48px,8vw,100px) clamp(18px,5vw,74px) 50px;border-bottom:1px solid var(--line)}
[data-admin-guide-overlay] .eyebrow{margin:0 0 14px;color:var(--blue);font-size:9px;font-weight:800;letter-spacing:.18em}
[data-admin-guide-overlay] .hero h1{max-width:960px;margin:0;font-size:clamp(42px,7vw,90px);line-height:.94;letter-spacing:-.07em}
[data-admin-guide-overlay] .hero p:last-child{max-width:780px;margin:26px 0 0;color:var(--muted);font-size:15px;line-height:1.8}
[data-admin-guide-overlay] .layout{width:min(1480px,100%);margin:0 auto;padding:44px clamp(16px,4vw,54px) 90px;display:grid;grid-template-columns:230px minmax(0,1fr);gap:42px}
[data-admin-guide-overlay] .nav{position:sticky;top:92px;align-self:start;display:grid;gap:3px}
[data-admin-guide-overlay] .nav a{padding:9px 11px;border-radius:7px;color:#545861;font-size:11px;text-decoration:none}
[data-admin-guide-overlay] .nav a:hover{background:#fff;color:var(--ink)}
[data-admin-guide-overlay] .content{min-width:0}
[data-admin-guide-overlay] section.guide{scroll-margin-top:92px;margin:0 0 64px}
[data-admin-guide-overlay] section.guide>header{margin-bottom:22px}
[data-admin-guide-overlay] section.guide h2{margin:0;font-size:clamp(28px,4vw,48px);letter-spacing:-.05em}
[data-admin-guide-overlay] section.guide h3{margin:28px 0 10px;font-size:20px;letter-spacing:-.03em}
[data-admin-guide-overlay] section.guide p,[data-admin-guide-overlay] section.guide li{color:var(--muted);font-size:13px;line-height:1.85}
[data-admin-guide-overlay] section.guide strong{color:var(--ink)}
[data-admin-guide-overlay] section.guide ul,[data-admin-guide-overlay] section.guide ol{padding-left:21px}
[data-admin-guide-overlay] .callout{margin:18px 0;padding:18px 20px;border:1px solid #ccd5ff;border-radius:11px;background:#f6f7ff}
[data-admin-guide-overlay] .callout.warn{border-color:#ead1ab;background:#fffaf1}
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
@media(max-width:900px){[data-admin-guide-overlay] .layout{grid-template-columns:1fr}[data-admin-guide-overlay] .nav{position:static;display:flex;overflow:auto;padding-bottom:8px}[data-admin-guide-overlay] .nav a{white-space:nowrap;border:1px solid var(--line);background:#fff}[data-admin-guide-overlay] .grid{grid-template-columns:1fr}[data-admin-guide-overlay] .flow{grid-template-columns:repeat(2,1fr)}}
@media(max-width:620px){[data-admin-guide-overlay] .top{align-items:flex-start}[data-admin-guide-overlay] .top div{justify-content:flex-end}[data-admin-guide-overlay] .hero{padding-top:42px}[data-admin-guide-overlay] table{display:block;overflow-x:auto}[data-admin-guide-overlay] .flow{grid-template-columns:1fr}[data-admin-guide-overlay] .checks{columns:1}}
`;

function GuideHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <header><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></header>;
}

export function AdminGuideCenter() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [deployCopy, setDeployCopy] = useState("复制部署引导语");
  const [upgradeCopy, setUpgradeCopy] = useState("复制升级指令");

  useEffect(() => {
    const locate = () => {
      const header = Array.from(document.querySelectorAll<HTMLElement>("header")).find((node) =>
        node.textContent?.includes("ONLINE") && node.textContent?.includes("打开已发布前台"),
      );
      const actionHost = header?.querySelector<HTMLElement>("div") ?? null;
      setHost((current) => current === actionHost ? current : actionHost);
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

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

  const button = <button type="button" data-admin-guide-button onClick={() => setOpen(true)}>使用教程</button>;

  const overlay = open ? (
    <div data-admin-guide-overlay role="dialog" aria-modal="true" aria-label="学生作品展示使用教程">
      <style>{styles}</style>
      <header className="top">
        <strong>学生作品展示 · 后台使用教程</strong>
        <div>
          <a href={CENTRAL_GUIDE_URL} target="_blank" rel="noreferrer">打开 GitHub 完整指南 ↗</a>
          <a href={DEPLOY_URL} target="_blank" rel="noreferrer">官方部署入口 ↗</a>
          <button className="primary" type="button" onClick={() => setOpen(false)}>关闭教程</button>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">PASSWORD-PROTECTED GUIDE / V1.0.0</p>
        <h1>从部署到发布，<br/>所有操作都在这里。</h1>
        <p>这份教程只有登录后台后才显示。部署前请阅读 GitHub 仓库首页的中央指南；部署后可随时从后台右上角打开这里。</p>
      </section>

      <div className="layout">
        <nav className="nav" aria-label="教程目录">
          <a href="#admin-guide-logic">整体逻辑</a><a href="#admin-guide-prepare">部署准备</a><a href="#admin-guide-gpt">GPT 设置</a><a href="#admin-guide-deploy">一键部署</a><a href="#admin-guide-first">第一次进后台</a><a href="#admin-guide-sections">后台栏目</a><a href="#admin-guide-sizes">图片 / 视频尺寸</a><a href="#admin-guide-crop">裁切与排版</a><a href="#admin-guide-publish">草稿与发布</a><a href="#admin-guide-qr">二维码</a><a href="#admin-guide-password">密码与恢复</a><a href="#admin-guide-accounts">多账号 / 多网站</a><a href="#admin-guide-upgrade">程序升级</a><a href="#admin-guide-errors">常见问题</a><a href="#admin-guide-checks">验收清单</a>
        </nav>

        <div className="content">
          <section className="guide" id="admin-guide-logic">
            <GuideHeader eyebrow="00 / LOGIC" title="先看懂整个逻辑" />
            <div className="callout"><strong>唯一正确流程</strong><p>GitHub 中央指南 → GPT 核对账号 → Cloudflare 一键部署 → 创建管理员 → 后台编辑 → 快速预览 → 正式发布。</p></div>
            <ul>
              <li>GitHub 仓库首页是部署前的公开指南，不消耗老师网站的 Cloudflare 请求。</li>
              <li>作品前台默认公开，也可以在后台启用二维码限制访问；后台和本教程受管理员密码控制。</li>
              <li>同一个 GPT 可以帮助多人，但实际托管身份由浏览器中的 GitHub / Cloudflare 登录决定。</li>
            </ul>
          </section>

          <section className="guide" id="admin-guide-prepare">
            <GuideHeader eyebrow="01 / PREPARE" title="部署前准备" />
            <p>准备 ChatGPT、GitHub、Cloudflare 三个可正常登录的账号、可接收验证码的邮箱、Chrome 或 Edge，以及手机二步验证。Google / Gmail 不是必须。</p>
            <p>不需要提前创建 OpenAI API Key、Cloudflare API Token、GitHub Personal Access Token 或任何长期密钥。</p>
          </section>

          <section className="guide" id="admin-guide-gpt">
            <GuideHeader eyebrow="02 / GPT" title="先打开 GPT，再部署" />
            <div className="callout"><strong>最低配置</strong><p>GPT-5.6 Sol，思考程度“高”；复杂部署、资源绑定、数据库迁移、账号串号和升级故障使用“超高”。</p></div>
            <div className="prompt"><pre>{DEPLOY_PROMPT}</pre><button type="button" onClick={() => void copy(DEPLOY_PROMPT, "deploy")}>{deployCopy}</button></div>
          </section>

          <section className="guide" id="admin-guide-deploy">
            <GuideHeader eyebrow="03 / DEPLOY" title="Cloudflare 一键部署：逐步操作" />
            <div className="steps">
              <div className="step"><strong>确认 GitHub 和 Cloudflare</strong><p>必须是当前学生自己的账号。看到上一位学生的用户名就停止并切换。</p></div>
              <div className="step"><strong>打开官方部署入口</strong><p><a href={DEPLOY_URL} target="_blank" rel="noreferrer"><b>Deploy to Cloudflare</b></a>。不要先手工创建 Worker、D1 或 KV。</p></div>
              <div className="step"><strong>完成 GitHub 授权</strong><p>确认 GitHub 用户名，点击 Authorize Cloudflare。授权到错误账号就取消。</p></div>
              <div className="step"><strong>按原方式登录 Cloudflare</strong><p>最初用 Google / GitHub / Apple / 邮箱密码中的哪一种创建，就使用哪一种。出现 different login provider 说明方式选错。</p></div>
              <div className="step"><strong>填写项目名称</strong><p>推荐 <code>student-portfolio-姓名拼音-01</code>。只用小写字母、数字和短横线；已有同名资源就改成 <code>-02</code>、<code>-03</code>。</p></div>
              <div className="step"><strong>确认独立资源</strong><p>D1 的绑定必须是 DB，KV 的绑定必须是 MEDIA_KV。界面要求选择时使用 Create new，绝不能复用另一个网站的资源。</p></div>
              <div className="step"><strong>设置 INITIAL_ADMIN_CODE</strong><p>用 Secret 类型，至少 16 位，同时包含英文字母和数字，只在 Cloudflare 官方页面输入。</p></div>
              <div className="step"><strong>保持构建默认值</strong><p>Production branch 为 main；Build command 为 npm run build；Deploy command 为 npm run deploy；Root directory 保持 / 或默认值。</p></div>
              <div className="step"><strong>点击 Deploy 并等待成功</strong><p>不要重复点击。失败时修复当前项目和现有资源，不要立即创建第二套站点。</p></div>
            </div>
            <h3>页面字段对照</h3>
            <table><thead><tr><th>字段</th><th>正确做法</th></tr></thead><tbody>
              <tr><td>Git account</td><td>当前学生自己的 GitHub。</td></tr>
              <tr><td>Project / Repository</td><td>使用唯一名称；同账号第二个网站加 -02。</td></tr>
              <tr><td>D1 / DB</td><td>自动创建或 Create new；不要选择旧站数据库。</td></tr>
              <tr><td>KV / MEDIA_KV</td><td>自动创建或 Create new；不要选择旧站媒体空间。</td></tr>
              <tr><td>INITIAL_ADMIN_CODE</td><td>Secret；至少 16 位字母和数字。</td></tr>
              <tr><td>Build / Deploy</td><td>npm run build / npm run deploy，不随意修改。</td></tr>
            </tbody></table>
          </section>

          <section className="guide" id="admin-guide-first">
            <GuideHeader eyebrow="04 / FIRST LOGIN" title="第一次进入后台" />
            <ol>
              <li>打开部署后网站地址并在末尾加 <code>/admin</code>。</li>
              <li>输入部署时设置的一次性部署口令。</li>
              <li>创建 10 至 128 位、至少包含文字和数字的管理员密码。</li>
              <li>下载系统恢复码并离线保存。</li>
              <li>确认恢复码已保存后再进入后台。</li>
            </ol>
          </section>

          <section className="guide" id="admin-guide-sections">
            <GuideHeader eyebrow="05 / ADMIN" title="后台每一栏怎么用" />
            <div className="grid">
              <article className="card"><h3>概览</h3><p>网站名称、二维码访问、数据统计、网站空间、程序版本和升级中心。</p></article>
              <article className="card"><h3>联系</h3><p>邮箱、电话、联系图片、左右排版和画布文字位置。</p></article>
              <article className="card"><h3>首图与文字</h3><p>多张首图、纯图片 / 系统排版 / 自由排版、主题、字体和个人定位。</p></article>
              <article className="card"><h3>作品分类</h3><p>分类名称、颜色、顺序和 8:1 过渡条。</p></article>
              <article className="card"><h3>作品</h3><p>项目资料、16:9 封面、MP4、封面文字、文字 / 图文 / 图片组 / 通栏内容块。</p></article>
              <article className="card"><h3>发布</h3><p>检查必要媒体并生成公开快照。</p></article>
              <article className="card"><h3>记录</h3><p>访问、播放请求、播放错误和管理操作。</p></article>
              <article className="card"><h3>使用教程</h3><p>只有管理员登录后可打开的本页面。</p></article>
            </div>
          </section>

          <section className="guide" id="admin-guide-sizes">
            <GuideHeader eyebrow="06 / MEDIA" title="图片与视频建议尺寸" />
            <p>图片支持 JPG、PNG、WebP、AVIF。系统会尝试转为 WebP 并把最长边控制在 2560 像素以内；优化后单张仍不能超过 8 MiB。</p>
            <table><thead><tr><th>位置</th><th>比例</th><th>建议尺寸</th><th>建议</th></tr></thead><tbody>
              <tr><td>首页首图</td><td>自由裁切</td><td>2560 × 1440</td><td>主体放中间 60%，四周留裁切空间。</td></tr>
              <tr><td>联系图片</td><td>1:1</td><td>1600 × 1600</td><td>主体居中。</td></tr>
              <tr><td>分类过渡图</td><td>8:1</td><td>2560 × 320</td><td>横向纹理或大留白。</td></tr>
              <tr><td>项目封面</td><td>16:9</td><td>1920 × 1080 / 2560 × 1440</td><td>不要把重要内容贴边。</td></tr>
              <tr><td>图文混排</td><td>4:3</td><td>2000 × 1500</td><td>左右保留空间。</td></tr>
              <tr><td>图片组竖图</td><td>3:4</td><td>1500 × 2000</td><td>同组统一色调和主体比例。</td></tr>
              <tr><td>图片组横图</td><td>4:3</td><td>2000 × 1500</td><td>同组统一视觉风格。</td></tr>
              <tr><td>通栏图片</td><td>16:9</td><td>1920 × 1080 / 2560 × 1440</td><td>关键内容放安全区。</td></tr>
              <tr><td>成稿视频</td><td>推荐 16:9</td><td>1920 × 1080</td><td>MP4、H.264 / AAC、≤ 50 MB。</td></tr>
            </tbody></table>
            <h3>视频压缩参考</h3>
            <ul><li>30 秒：约 8–10 Mbps。</li><li>60 秒：约 5–6 Mbps。</li><li>120 秒：约 2.5–3 Mbps。</li></ul>
            <p>这是近似值，最终以导出文件实际小于 50 MB 为准。推荐 24、25 或 30 fps，不必导出 4K。</p>
          </section>

          <section className="guide" id="admin-guide-crop">
            <GuideHeader eyebrow="07 / CROP" title="裁切、排版与预览" />
            <ul>
              <li>上传后先使用默认裁切，平时预览不显示虚框。</li>
              <li>点击“调整”后才出现裁切框；完成后点击“确认裁切”。</li>
              <li>项目封面、图文、图片组和通栏图按各自比例裁切。</li>
              <li>文字可在真实画布中拖动，双击文字可直接修改。</li>
              <li>封面排版设置会即时反映到真实封面预览。</li>
            </ul>
          </section>

          <section className="guide" id="admin-guide-publish">
            <GuideHeader eyebrow="08 / PUBLISH" title="保存草稿与正式发布" />
            <div className="flow"><div><b>1</b>编辑</div><div><b>2</b>保存草稿</div><div><b>3</b>快速预览</div><div><b>4</b>正式发布</div></div>
            <ul>
              <li>保存草稿只更新后台，公开前台不变。</li>
              <li>快速预览打开管理员草稿版本。</li>
              <li>正式发布后访客才看到新内容。</li>
              <li>左下角显示“有未保存修改”时，离开前必须保存。</li>
            </ul>
          </section>

          <section className="guide" id="admin-guide-qr">
            <GuideHeader eyebrow="09 / QR" title="二维码访问" />
            <p>关闭限制访问时，普通前台链接可直接打开。开启后可为不同对象生成独立二维码，设置名称、使用次数和到期时间，并可暂停、恢复或删除。达到次数、过期或暂停后会失效。</p>
          </section>

          <section className="guide" id="admin-guide-password">
            <GuideHeader eyebrow="10 / PASSWORD" title="密码、12 小时登录与恢复码" />
            <ul>
              <li>输入正确管理员密码后，这台浏览器保持登录 12 小时。</li>
              <li>12 小时内再次点“管理”通常直接进入后台。</li>
              <li>点击“安全退出”后立即失效。</li>
              <li>连续输错 5 次锁定 15 分钟。</li>
              <li>恢复码使用一次后作废，并生成新恢复码。</li>
              <li>密码和最新恢复码都丢失时无法自行找回。</li>
            </ul>
          </section>

          <section className="guide" id="admin-guide-accounts">
            <GuideHeader eyebrow="11 / ACCOUNTS" title="多账号与多网站" />
            <h3>一个 GPT 帮不同学生</h3>
            <p>每次都重新确认当前学生、GitHub 登录身份、Cloudflare 登录身份和目标站点。GPT 账号不是托管身份。</p>
            <h3>同一托管账号部署多个网站</h3>
            <p>每个网站必须有独立仓库、Worker、D1、MEDIA_KV、地址、管理员密码和恢复码。推荐使用 <code>-01</code>、<code>-02</code>、<code>-03</code> 区分。绝不能复用旧站 D1 或 KV。</p>
          </section>

          <section className="guide" id="admin-guide-upgrade">
            <GuideHeader eyebrow="12 / UPGRADE" title="程序升级" />
            <p>升级只更新程序和增量数据库迁移，必须保留 Worker、地址、D1、MEDIA_KV、Secrets、管理员、图片、视频、草稿、发布内容、二维码和记录。</p>
            <div className="prompt"><pre>{UPGRADE_PROMPT}</pre><button type="button" onClick={() => void copy(UPGRADE_PROMPT, "upgrade")}>{upgradeCopy}</button></div>
          </section>

          <section className="guide" id="admin-guide-errors">
            <GuideHeader eyebrow="13 / ERRORS" title="常见问题" />
            <div className="grid">
              <article className="card"><h3>管理不要求密码</h3><p>通常仍在 12 小时登录期内。先安全退出再测试。</p></article>
              <article className="card"><h3>不同登录方式</h3><p>Cloudflare 登录方式选错，改用创建账号时的原始方式。</p></article>
              <article className="card"><h3>资源已存在</h3><p>新站名称加 -02 / -03，不覆盖旧站。</p></article>
              <article className="card"><h3>部署失败</h3><p>查看日志底部，修复当前项目，不重复创建。</p></article>
              <article className="card"><h3>图片失败</h3><p>检查格式和大小，最长边先压到 2560。</p></article>
              <article className="card"><h3>视频失败</h3><p>必须是 H.264 / AAC MP4 且小于 50 MB。</p></article>
              <article className="card"><h3>预览打不开</h3><p>允许当前站点打开新窗口。</p></article>
              <article className="card"><h3>前台没变化</h3><p>保存草稿后还需正式发布，再刷新前台。</p></article>
            </div>
          </section>

          <section className="guide" id="admin-guide-checks">
            <GuideHeader eyebrow="14 / CHECK" title="最终验收清单" />
            <ul className="checks">
              <li>仓库、Worker 属于当前学生。</li><li>D1 / KV 未复用旧站。</li><li>前台和后台可打开。</li><li>恢复码已离线保存。</li><li>安全退出后重新进入要密码。</li><li>首图、联系图、封面裁切正常。</li><li>图片组与通栏图正常。</li><li>MP4 可播放和拖动。</li><li>保存草稿不改变前台。</li><li>快速预览可打开。</li><li>发布后前台更新。</li><li>二维码规则正常。</li><li>网站空间统计正常。</li><li>使用教程可打开。</li><li>升级指令可复制。</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {host ? createPortal(button, host) : null}
      {overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}
