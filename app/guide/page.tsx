export const dynamic = "force-static";

const deployUrl = "https://deploy.workers.cloudflare.com/?url=https://github.com/q1433031046-ship-it/student-portfolio-cloudflare";

const deployPrompt = `我要部署“学生作品展示”网站。请全程一步一步带我完成，一次只让我做一个主要动作，不要一次发很多步骤。

开始前请先确认：
1. 我使用的模型至少是 GPT-5.6 Sol，思考程度为“高”；复杂故障时提醒我改成“超高”。
2. 当前实际操作浏览器里登录的是哪一个 GitHub 账号、哪一个 Cloudflare 账号。
3. 这是这个 GitHub / Cloudflare 账号里的第几个学生作品网站；如果已经有其他网站，必须为这次网站使用新的仓库、Worker、D1 和 MEDIA_KV，绝不能复用旧网站的数据资源。
4. 如果同一个 GPT 账号正在帮助不同学生，必须以当前浏览器里的 GitHub / Cloudflare 登录身份为准，发现还是上一位学生的账号就先停止并让我切换。

确认账号无误后，再带我打开官方 Deploy to Cloudflare：
${deployUrl}

部署时请自动完成你能够完成的检查、代码、构建、迁移和验证。只有 GitHub / Cloudflare 官方授权、一次性部署口令、管理员密码、系统恢复码需要我本人操作时再叫我。

不要向我索取或让我发送：GitHub 密码、Cloudflare 密码、管理员密码、INITIAL_ADMIN_CODE、系统恢复码、浏览器 Cookie、长期 API Token。

首次部署完成后继续带我进入 /admin：用一次性部署口令创建管理员密码、保存系统恢复码，然后检查图片上传、MP4 播放、草稿预览、正式发布、二维码访问、网站空间和程序升级中心是否正常。`;

const upgradePrompt = `请把我的“学生作品展示”网站升级到模板最新版本。先确认当前要升级的具体网站、Worker、D1 DB 和 MEDIA_KV，再读取 AGENTS.md、deployment/agent-manifest.json、deployment/template-version.json 和 UPGRADE-GUIDE.md。只更新程序代码和增量数据库迁移，必须保留当前网站地址、D1、MEDIA_KV、管理员账号、Secrets、图片、视频、草稿、已发布内容、二维码和访问记录。不要创建新的 Worker、D1 或 KV，也不要覆盖现有资源 ID。升级完成后检查后台登录、图片、视频、草稿预览、正式发布和网站空间。`;

const styles = `
:root{color-scheme:light}.guidePage{--ink:#111217;--muted:#686c74;--line:#deded9;--paper:#f4f3ee;--card:#fff;--blue:#3159ff;min-height:100svh;background:var(--paper);color:var(--ink);font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif}.guidePage *{box-sizing:border-box}.guidePage a{color:inherit}.guideTop{position:sticky;top:0;z-index:20;height:64px;padding:0 clamp(18px,4vw,56px);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);background:rgba(244,243,238,.94);backdrop-filter:blur(16px)}.guideTop strong{font-size:15px}.guideTop nav{display:flex;gap:8px;align-items:center}.guideTop a{padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;text-decoration:none;font-size:12px}.guideTop a.primary{border-color:var(--blue);background:var(--blue);color:#fff}.guideHero{padding:clamp(70px,10vw,128px) clamp(20px,6vw,92px) 62px;border-bottom:1px solid var(--line)}.guideHero .eyebrow,.sectionEyebrow{margin:0 0 15px;color:var(--blue);font-size:10px;font-weight:800;letter-spacing:.18em}.guideHero h1{max-width:980px;margin:0;font-size:clamp(48px,8vw,106px);line-height:.92;letter-spacing:-.075em}.guideHero .lead{max-width:760px;margin:30px 0 0;color:var(--muted);font-size:clamp(16px,2vw,21px);line-height:1.75}.quickStart{margin-top:38px;display:flex;flex-wrap:wrap;gap:10px}.quickStart a{padding:13px 16px;border-radius:9px;text-decoration:none;font-size:13px;font-weight:700}.quickStart .primary{background:var(--blue);color:#fff}.quickStart .secondary{border:1px solid var(--line);background:#fff}.guideLayout{width:min(1500px,100%);margin:0 auto;padding:50px clamp(18px,4vw,56px) 100px;display:grid;grid-template-columns:250px minmax(0,1fr);gap:44px}.guideNav{position:sticky;top:92px;align-self:start;display:grid;gap:4px}.guideNav a{padding:10px 12px;border-radius:7px;color:#555a63;text-decoration:none;font-size:12px}.guideNav a:hover{background:#fff;color:var(--ink)}.guideContent{min-width:0}.guideSection{scroll-margin-top:90px;margin:0 0 72px}.guideSection>header{margin-bottom:24px}.guideSection h2{margin:0;font-size:clamp(30px,4vw,52px);letter-spacing:-.055em}.guideSection h3{margin:28px 0 12px;font-size:21px;letter-spacing:-.035em}.guideSection p,.guideSection li{color:var(--muted);font-size:14px;line-height:1.85}.guideSection strong{color:var(--ink)}.guideSection ul,.guideSection ol{padding-left:22px}.callout{margin:20px 0;padding:20px 22px;border:1px solid #cfd6ff;border-radius:12px;background:#f6f7ff}.callout strong{display:block;margin-bottom:6px}.warn{border-color:#e7d2af;background:#fffaf2}.steps{display:grid;gap:10px;counter-reset:step}.step{position:relative;padding:21px 22px 21px 72px;border:1px solid var(--line);border-radius:11px;background:#fff}.step:before{counter-increment:step;content:counter(step);position:absolute;left:20px;top:19px;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:#111217;color:#fff;font-size:12px;font-weight:800}.step strong{display:block;margin-bottom:5px}.step p{margin:0}.promptBox{padding:20px;border:1px solid var(--line);border-radius:12px;background:#111217;color:#f5f5f3}.promptBox pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.8 ui-monospace,SFMono-Regular,Consolas,monospace}.promptBox .hint{margin:14px 0 0;color:#aeb2bd;font-size:11px}.adminGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.adminCard{padding:22px;border:1px solid var(--line);border-radius:12px;background:#fff}.adminCard span{display:block;margin-bottom:10px;color:var(--blue);font-size:10px;font-weight:800;letter-spacing:.12em}.adminCard h3{margin:0 0 8px;font-size:20px}.adminCard p{margin:0;font-size:13px}.sizeTable{width:100%;border-collapse:collapse;border:1px solid var(--line);background:#fff}.sizeTable th,.sizeTable td{padding:14px 15px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:12px;line-height:1.65}.sizeTable th{background:#ebeae5;font-size:11px}.sizeTable td:nth-child(2),.sizeTable td:nth-child(3){white-space:nowrap}.sizeTable tr:last-child td{border-bottom:0}.mini{font-size:11px!important}.flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:18px 0}.flow div{padding:16px;border:1px solid var(--line);border-radius:9px;background:#fff;font-size:12px;text-align:center}.flow b{display:block;margin-bottom:5px;color:var(--blue)}.footerGuide{padding:40px clamp(20px,6vw,92px) 70px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;line-height:1.8}.footerGuide strong{color:var(--ink)}@media(max-width:900px){.guideLayout{grid-template-columns:1fr}.guideNav{position:static;display:flex;overflow:auto;padding-bottom:8px}.guideNav a{white-space:nowrap;border:1px solid var(--line);background:#fff}.adminGrid{grid-template-columns:1fr}.flow{grid-template-columns:repeat(2,1fr)}}@media(max-width:620px){.guideTop{height:auto;min-height:62px;padding:10px 14px;gap:12px}.guideTop nav{gap:5px}.guideTop a{padding:8px;font-size:10px}.guideHero{padding-top:64px}.sizeTable{display:block;overflow-x:auto}.flow{grid-template-columns:1fr}.guideLayout{padding-top:30px}.guideSection{margin-bottom:56px}}
`;

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <header><p className="sectionEyebrow">{eyebrow}</p><h2>{title}</h2></header>;
}

export default function GuidePage() {
  return <main className="guidePage">
    <style>{styles}</style>
    <header className="guideTop">
      <strong>学生作品展示 · 使用中心</strong>
      <nav>
        <a href="/">查看网站</a>
        <a href="/admin">进入后台</a>
        <a className="primary" href="#gpt">开始部署</a>
      </nav>
    </header>

    <section className="guideHero">
      <p className="eyebrow">ONE PAGE GUIDE / V1.0.0</p>
      <h1>这一页，<br/>从部署教到发布。</h1>
      <p className="lead">不需要看 GitHub 里的多份说明。部署账号怎么准备、GPT 怎么说、Cloudflare 怎么部署、后台每一栏怎么用、图片应该做多大、视频怎么压、密码怎么找回、一个账号怎么放多个网站、以后怎么升级，都在这一页。</p>
      <div className="quickStart">
        <a className="primary" href="#gpt">第一步：先打开 GPT</a>
        <a className="secondary" href="#admin">我已经部署，学后台</a>
        <a className="secondary" href="#sizes">直接看图片尺寸</a>
      </div>
    </section>

    <div className="guideLayout">
      <nav className="guideNav" aria-label="教程目录">
        <a href="#prepare">部署前准备</a><a href="#gpt">GPT 设置</a><a href="#deploy">一键部署</a><a href="#first-login">第一次进后台</a><a href="#admin">后台完整教程</a><a href="#sizes">图片 / 视频尺寸</a><a href="#draft">草稿与发布</a><a href="#qr">二维码访问</a><a href="#password">密码与恢复码</a><a href="#accounts">多账号 / 多网站</a><a href="#upgrade">程序升级</a><a href="#errors">常见问题</a>
      </nav>

      <div className="guideContent">
        <section className="guideSection" id="prepare">
          <SectionHeader eyebrow="01 / PREPARE" title="部署前准备" />
          <div className="callout"><strong>最简单的要求</strong><p>准备好 ChatGPT、GitHub、Cloudflare 三个能正常登录的账号，再准备一个能收验证码的邮箱。Google / Gmail 不是必须。</p></div>
          <ul>
            <li>电脑：推荐 Chrome 或 Edge。</li><li>手机放在旁边：用于邮箱验证码或二步验证。</li><li>尽量让 GitHub、Cloudflare、ChatGPT 使用自己记得住的常用邮箱。</li><li>不要提前创建 API Key、Cloudflare Token、GitHub Personal Access Token，正常部署不需要。</li><li>作品素材提前整理：姓名、职业标题、求职方向、邮箱、电话、图片、作品简介和 MP4 视频。</li>
          </ul>
        </section>

        <section className="guideSection" id="gpt">
          <SectionHeader eyebrow="02 / GPT" title="先打开 GPT，再部署" />
          <div className="callout"><strong>模型要求</strong><p><b>最低：GPT-5.6 Sol；思考程度：高。</b> 遇到 Cloudflare 绑定、数据库迁移、账号串号、部署失败或版本升级时，改成“超高”。</p></div>
          <p>界面里有“工作”时，可以优先使用“工作”；没有也可以使用普通 ChatGPT 对话。关键不是界面名称，而是模型至少使用 GPT-5.6 Sol，并让 GPT 一步一步带着操作。</p>
          <h3>复制下面整段给 GPT</h3>
          <div className="promptBox"><pre>{deployPrompt}</pre><p className="hint">电脑上：点击文字后 Ctrl+A / Ctrl+C，或直接拖选全部复制。</p></div>
        </section>

        <section className="guideSection" id="deploy">
          <SectionHeader eyebrow="03 / DEPLOY" title="Cloudflare 一键部署" />
          <div className="steps">
            <div className="step"><strong>GPT 先确认账号</strong><p>先确认浏览器当前登录的是你自己的 GitHub 和 Cloudflare。不是自己的账号就先退出切换。</p></div>
            <div className="step"><strong>再打开官方一键部署</strong><p><a href={deployUrl} target="_blank" rel="noreferrer"><b>点这里打开 Deploy to Cloudflare</b></a>。不要自己另外创建 D1 或 KV。</p></div>
            <div className="step"><strong>设置一次性部署口令</strong><p><code>INITIAL_ADMIN_CODE</code> 至少 16 位，同时包含英文字母和数字。只在 Cloudflare 官方页面输入，不要发给 GPT。</p></div>
            <div className="step"><strong>等待部署完成</strong><p>完成后会得到一个 <code>workers.dev</code> 网站地址。把这个地址保存下来。</p></div>
          </div>
          <div className="warn callout"><strong>不要做的事</strong><p>不要把管理员密码、一次性部署口令、恢复码、Cloudflare 密码、GitHub 密码、浏览器 Cookie 发到聊天里。</p></div>
        </section>

        <section className="guideSection" id="first-login">
          <SectionHeader eyebrow="04 / FIRST LOGIN" title="第一次进入后台" />
          <div className="flow"><div><b>01</b>打开 网站地址/admin</div><div><b>02</b>输入一次性部署口令</div><div><b>03</b>创建管理员密码</div><div><b>04</b>下载并保存恢复码</div></div>
          <p>管理员密码要求 10–128 位，至少包含文字和数字。初始化完成后，<strong>以后登录只用管理员密码</strong>，一次性部署口令不再当日常密码使用。</p>
          <div className="callout"><strong>为什么有时点“管理”不需要密码？</strong><p>输入正确密码以后，这台浏览器会保持登录 12 小时。所以 12 小时内再次点“管理”通常直接进去，这是正常的。点右上角“安全退出”后会立刻失效；连续输错 5 次密码会锁 15 分钟。</p></div>
        </section>

        <section className="guideSection" id="admin">
          <SectionHeader eyebrow="05 / ADMIN" title="后台完整使用教程" />
          <p>后台左侧一共有 7 个主要页面。最省事的顺序是：<strong>概览 → 联系 → 首图与文字 → 作品分类 → 作品 → 快速预览 → 发布 → 记录</strong>。</p>
          <div className="adminGrid">
            <article className="adminCard"><span>01 / 概览</span><h3>先改网页名称</h3><p>修改浏览器标签与站点名称。这里还能看作品数、分类数、媒体数、修订版本、二维码访问策略、网站空间和程序升级中心。</p></article>
            <article className="adminCard"><span>02 / 联系</span><h3>填写邮箱、电话与联系弹层</h3><p>可以修改眉题、主标题、邮箱、电话、说明，选择“资料在左 / 图片在左”，并拖动联系页文字。联系图片使用 1:1。</p></article>
            <article className="adminCard"><span>03 / 首图与文字</span><h3>做首页第一屏</h3><p>上传一张或多张首图，可以选择“纯图片 / 系统排版 / 自由排版”。填写姓名、职业标题、求职方向、个人定位和状态短句。非纯图片模式可直接拖动文字层。</p></article>
            <article className="adminCard"><span>04 / 作品分类</span><h3>管理作品栏目</h3><p>新建分类、改名称、颜色和顺序。模块过渡条可跟随系统，也可以上传 8:1 的自定义横幅。已有作品的分类不能直接删除，要先移动作品。</p></article>
            <article className="adminCard"><span>05 / 作品</span><h3>封面、视频、图文都在这里</h3><p>新建作品后填写名称、分类、年份、简介、项目难点、解决思路，再上传 16:9 封面和 MP4 成稿。视频时长会自动读取。</p></article>
            <article className="adminCard"><span>05A / 内容块</span><h3>搭建项目详情页</h3><p>可增加“文字 / 图文混排 / 图片组 / 通栏图片”。图片组最多 4 张，可选竖图 3:4 或横图 4:3，排版会随数量自动变化。</p></article>
            <article className="adminCard"><span>06 / 发布</span><h3>最后一步才公开</h3><p>发布页会检查首图、分类自定义过渡图、项目封面和成稿视频是否齐全。没齐时不能正式发布。</p></article>
            <article className="adminCard"><span>07 / 记录</span><h3>查看访问与管理记录</h3><p>可以查看最近访问、播放请求、设备、地区、风险状态，以及保存草稿、发布、上传媒体等管理操作。</p></article>
          </div>
          <h3>最重要的三个按钮</h3>
          <ul><li><strong>保存草稿：</strong>只保存后台修改，不会立即改变公开网站。</li><li><strong>快速预览：</strong>自动保存草稿后打开预览，可以检查当前修改，但访客仍然看到旧的已发布版本。</li><li><strong>发布：</strong>确认没问题后才把当前草稿生成新的公开版本。</li></ul>
        </section>

        <section className="guideSection" id="sizes">
          <SectionHeader eyebrow="06 / MEDIA SIZE" title="图片与视频建议尺寸" />
          <div className="callout"><strong>先记住一句</strong><p>不需要上传 4K / 8K 图片。网站会把普通图片最长边控制在 2560 像素左右并尽量压成 WebP；素材本身清晰、构图留有裁切空间，比盲目做超大图更重要。</p></div>
          <table className="sizeTable"><thead><tr><th>使用位置</th><th>真实比例</th><th>建议尺寸</th><th>制作建议</th></tr></thead><tbody>
            <tr><td><strong>首页首图</strong></td><td>自由裁切</td><td>2560 × 1440</td><td>优先横图。人物、产品或视觉中心放在画面中间约 60% 安全区，手机端裁切时更稳。使用系统/自由排版时，图片里尽量不要提前烤死大段文字。</td></tr>
            <tr><td><strong>联系图片</strong></td><td>1:1</td><td>1600 × 1600</td><td>主体居中，四周留 10%–15% 空间，方便后台裁切。</td></tr>
            <tr><td><strong>分类过渡条</strong></td><td>8:1</td><td>2560 × 320</td><td>非常宽的横幅。主体不要太靠左右边缘，适合纹理、场景横切或简洁视觉。</td></tr>
            <tr><td><strong>项目封面</strong></td><td>16:9</td><td>1920 × 1080<br/>或 2560 × 1440</td><td>这是最重要的作品图。标题文字由网站叠加时，画面左侧/下方最好留出一点干净区域。</td></tr>
            <tr><td><strong>图文混排图片</strong></td><td>4:3</td><td>2000 × 1500</td><td>适合角色、产品、场景、设计过程。主体不要贴边。</td></tr>
            <tr><td><strong>图片组 · 竖图</strong></td><td>3:4</td><td>1500 × 2000</td><td>同一组尽量统一尺寸与色调；后台最多 4 张。</td></tr>
            <tr><td><strong>图片组 · 横图</strong></td><td>4:3</td><td>2000 × 1500</td><td>同一组统一方向，不建议横竖混放后再强行裁切。</td></tr>
            <tr><td><strong>通栏图片</strong></td><td>16:9</td><td>1920 × 1080<br/>或 2560 × 1440</td><td>适合作品最终大图、关键帧和视觉总结。</td></tr>
            <tr><td><strong>成稿视频</strong></td><td>推荐 16:9</td><td>1920 × 1080</td><td>MP4，推荐 H.264 视频 + AAC 音频。<strong>单个必须 ≤ 50 MB</strong>。超出时优先降低码率再导出。</td></tr>
          </tbody></table>
          <h3>文件格式和大小</h3>
          <ul><li>图片：JPG、PNG、WebP、AVIF；优化后的单张不超过 8 MiB。</li><li>视频：MP4；单个不超过 50 MB。</li><li>字体：WOFF、WOFF2、TTF、OTF；单个不超过 10 MiB。</li><li>普通 JPG / PNG / WebP 上传时，浏览器会自动进行图片优化；AVIF 保持原文件。</li></ul>
          <div className="warn callout"><strong>图片容易糊的常见原因</strong><p>不要把微信里被反复转发过的小图直接当封面；不要截图后再截图；不要把 800×450 的小图硬放大到 1920×1080。原图尺寸至少接近上表建议值。</p></div>
        </section>

        <section className="guideSection" id="draft">
          <SectionHeader eyebrow="07 / DRAFT & PUBLISH" title="草稿、预览、发布怎么区分" />
          <div className="flow"><div><b>编辑</b>后台修改内容</div><div><b>保存草稿</b>保存但不公开</div><div><b>快速预览</b>只有管理员看新版本</div><div><b>正式发布</b>访客看到新版本</div></div>
          <p>所以改错东西也不用慌。只要没有点“发布”，公开网站仍然是上一次发布的版本。</p>
        </section>

        <section className="guideSection" id="qr">
          <SectionHeader eyebrow="08 / ACCESS" title="二维码访问怎么用" />
          <p>在“概览”的二维码访问区域可以决定网站是否限制访问，并创建二维码访问凭证。可以做公开访问、限制次数、设置过期时间，也可以暂停或删除二维码。</p>
          <div className="callout"><strong>给客户展示时</strong><p>创建一个专用二维码，比直接把后台或管理链接发出去更安全。二维码限制用尽或过期后，访客不能继续使用原凭证。</p></div>
        </section>

        <section className="guideSection" id="password">
          <SectionHeader eyebrow="09 / SECURITY" title="密码与恢复码" />
          <ul><li>正确登录后，这台浏览器保持管理员登录约 12 小时。</li><li>点击“安全退出”，当前登录立即失效。</li><li>连续输错 5 次密码，锁定 15 分钟。</li><li>忘记密码时使用系统恢复码设置新密码。</li><li>恢复成功后旧密码、旧会话、旧恢复码都会失效，并生成一份新的恢复码。</li><li>管理员密码和恢复码都丢失时，需要维护人员对数据库执行管理员凭证重置。</li></ul>
        </section>

        <section className="guideSection" id="accounts">
          <SectionHeader eyebrow="10 / ACCOUNTS" title="同一个 GPT、多个账号、多个网站" />
          <h3>同一个 GPT 账号帮助很多学生</h3><p>可以。GPT 只是助手。每次部署前都要看<strong>实际浏览器里登录的是谁的 GitHub 和谁的 Cloudflare</strong>。上一位学生没退出时不要继续下一位。</p>
          <h3>同一个 GitHub / Cloudflare 账号部署多个网站</h3><p>也可以。但每一个网站必须有独立的 GitHub 仓库、Worker、D1、MEDIA_KV、网站地址、管理员密码和恢复码。例如使用 <code>student-portfolio-01</code>、<code>student-portfolio-02</code>、<code>student-portfolio-03</code>。第二个网站绝不能复用第一个网站的 D1 或 KV。</p>
        </section>

        <section className="guideSection" id="upgrade">
          <SectionHeader eyebrow="11 / UPGRADE" title="以后怎么升级程序" />
          <p>后台“概览 → 网站空间”下面有“程序升级中心”。以后有新版时，把里面的升级指令复制给 GPT。升级原则是：<strong>只更新程序，不重新建网站，不删除学生自己的数据。</strong></p>
          <div className="promptBox"><pre>{upgradePrompt}</pre></div>
        </section>

        <section className="guideSection" id="errors">
          <SectionHeader eyebrow="12 / TROUBLESHOOTING" title="出问题时先看这里" />
          <div className="adminGrid">
            <article className="adminCard"><span>图片上传失败</span><h3>先看格式和大小</h3><p>使用 JPG / PNG / WebP / AVIF；原图不要严重损坏。优化后仍超过 8 MiB 时先压缩。</p></article>
            <article className="adminCard"><span>视频上传失败</span><h3>重新导出 MP4</h3><p>使用 H.264 / AAC MP4，文件必须不超过 50 MB。无法读取时长通常也是编码问题。</p></article>
            <article className="adminCard"><span>点管理直接进后台</span><h3>通常是 12 小时登录状态</h3><p>点“安全退出”后再从前台进入。如果此时仍不需要密码，再把截图发给 GPT 排查。</p></article>
            <article className="adminCard"><span>快速预览没打开</span><h3>检查浏览器弹窗</h3><p>允许这个网站打开新窗口，然后重新点“快速预览”。</p></article>
            <article className="adminCard"><span>第二个网站部署报重名</span><h3>换新的站点名称</h3><p>先确认是不是已经部署过一个网站；为新站生成独立仓库、Worker、D1、KV 名称。</p></article>
            <article className="adminCard"><span>不知道怎么办</span><h3>截图给 GPT</h3><p>可以发报错截图，但先遮掉密码、一次性口令、恢复码和其他秘密。让 GPT 先确认当前账号和资源归属再修。</p></article>
          </div>
        </section>
      </div>
    </div>

    <footer className="footerGuide"><strong>学生作品展示 · 单页使用中心</strong><br/>教程内容与当前程序版本 v1.0.0 对应。图片建议尺寸是为显示效果和裁切留出的推荐值，不是强制像素限制；真正强制的是文件格式、文件大小和各位置的裁切比例。</footer>
  </main>;
}
