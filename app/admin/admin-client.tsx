"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import type {
  CategoryConfig,
  CoverTextStyle,
  HeroSlide,
  MediaAsset,
  MediaCrop,
  PortfolioDocument,
  Project,
  ProjectBlock,
} from "../portfolio/model";
import { createDefaultCoverPresentation, createDefaultHeroLayers } from "../portfolio/model";
import { HeroLayoutEditor } from "./hero-layout-editor";
import { MediaCropEditor } from "./media-crop-editor";
import styles from "./admin.module.css";
import { createClientId } from "../lib/client-id";
import { formatVideoDuration } from "../lib/video-duration";
import { resolveWatermarkText } from "../portfolio/watermark";
import { croppedImageStyle, fitCropToAspect, fullMediaCrop, mediaCropAspect, validAspect } from "../portfolio/media-crop";
import { AccessManager, type AccessPayload } from "./access-manager";

type View = "overview" | "identity" | "categories" | "projects" | "contact" | "publish" | "records";
type Operation = "idle" | "saving" | "previewing" | "publishing";
type OperationError = { title: string; reason: string; solution: string };
type SetupPayload = {
  state: "unbound" | "email_pending" | "ready";
  email: string;
  boundAt: string | null;
  onboardingEmailSentAt: string | null;
};
type AdminPayload = {
  identity: { email: string; provider: string };
  portfolio: PortfolioDocument;
  revision: number;
  updatedAt: string;
  publishedAt: string | null;
};
type EventItem = {
  id: string;
  occurredAt: string;
  eventType: string;
  path: string;
  projectId: string | null;
  mediaVersion: string | null;
  referrer: string | null;
  deviceType: string | null;
  browser: string | null;
  operatingSystem: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  asOrganization: string | null;
  networkHash: string | null;
  riskLevel: string;
  riskReason: string | null;
  action: string;
  eventCount: number;
  lastSeenAt: string | null;
};
type AuditItem = {
  id: string;
  occurredAt: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
};

const views: Array<{ id: View; label: string; index: string }> = [
  { id: "overview", label: "概览", index: "01" },
  { id: "contact", label: "联系", index: "02" },
  { id: "identity", label: "首图与文字", index: "03" },
  { id: "categories", label: "作品分类", index: "04" },
  { id: "projects", label: "作品", index: "05" },
  { id: "publish", label: "发布", index: "06" },
  { id: "records", label: "记录", index: "07" },
];

export function AdminClient({ initialEmail, signInHref, signOutHref }: { initialEmail: string | null; signInHref: string | null; signOutHref: string }) {
  const [view, setView] = useState<View>("overview");
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [data, setData] = useState<AdminPayload | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioDocument | null>(null);
  const [access, setAccess] = useState<AccessPayload | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "setup" | "ready" | "unauthenticated" | "error">("loading");
  const [message, setMessage] = useState("正在读取管理数据…");
  const [dirty, setDirty] = useState(false);
  const [operation, setOperation] = useState<Operation>("idle");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [audits, setAudits] = useState<AuditItem[]>([]);
  const [operationError, setOperationError] = useState<OperationError | null>(null);
  const changeVersionRef = useRef(0);
  const busy = operation !== "idle" || setupBusy;

  const notify = useCallback((nextMessage: string) => {
    setMessage(nextMessage);
    if (isFailureMessage(nextMessage)) setOperationError(failureGuidance(nextMessage));
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const setupResponse = await fetch("/api/admin/setup", { credentials: "same-origin", cache: "no-store" });
      if (setupResponse.status === 401) {
        setState("unauthenticated");
        setMessage("请先使用管理员邮箱完成验证码验证");
        return;
      }
      const setupBody = await setupResponse.json() as SetupPayload & { error?: string };
      if (!setupResponse.ok) throw new Error(setupBody.error || "管理员绑定状态读取失败");
      setSetup(setupBody);
      if (setupBody.state !== "ready") {
        setState("setup");
        setMessage(setupBody.state === "unbound" ? "请确认绑定当前验证邮箱" : "请完成后台入口邮件发送");
        return;
      }

      const [response, accessResponse] = await Promise.all([
        fetch("/api/admin/portfolio", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/admin/access", { credentials: "same-origin", cache: "no-store" }),
      ]);
      if (response.status === 401) {
        setState("unauthenticated");
        setMessage("登录后才可以编辑与发布作品集");
        return;
      }
      const body = await response.json() as AdminPayload & { error?: string };
      const accessBody = await accessResponse.json() as AccessPayload & { error?: string };
      if (!response.ok) throw new Error(body.error || "管理数据读取失败");
      if (!accessResponse.ok) throw new Error(accessBody.error || "二维码访问设置读取失败");
      setData(body);
      setPortfolio(body.portfolio);
      setAccess(accessBody);
      setSelectedProjectId(body.portfolio.projects[0]?.id ?? null);
      setDirty(false);
      setState("ready");
      setMessage("草稿已同步");
    } catch (error) {
      setState("error");
      notify(errorMessage(error));
    }
  }, [notify]);

  async function completeSetup() {
    if (setupBusy) return;
    setSetupBusy(true);
    setMessage(setup?.state === "email_pending" ? "正在重新发送后台入口邮件…" : "正在绑定邮箱并发送后台入口…");
    try {
      const response = await fetch("/api/admin/setup", { method: "POST", credentials: "same-origin", cache: "no-store" });
      const body = await response.json() as SetupPayload & { error?: string };
      if (body.email) setSetup(body);
      if (!response.ok) throw new Error(body.error || "管理员邮箱绑定暂时无法完成");
      if (body.state !== "ready") throw new Error("后台入口邮件尚未发送成功");
      setMessage("管理员邮箱已绑定，后台入口已发送至邮箱");
      await load();
    } catch (error) {
      setState("setup");
      notify(errorMessage(error));
    } finally {
      setSetupBusy(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    if (view !== "records" || state !== "ready") return;
    void Promise.all([
      api<{ events: EventItem[] }>("/api/admin/events?limit=100").then((value) => setEvents(value.events)),
      api<{ logs: AuditItem[] }>("/api/admin/audit?limit=60").then((value) => setAudits(value.logs)),
    ]).catch((error) => notify(errorMessage(error)));
  }, [view, state, notify]);

  useEffect(() => {
    if (!dirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [dirty]);

  const selectedProject = useMemo(
    () => portfolio?.projects.find((project) => project.id === selectedProjectId) ?? null,
    [portfolio, selectedProjectId],
  );

  function change(mutator: (document: PortfolioDocument) => PortfolioDocument) {
    changeVersionRef.current += 1;
    setPortfolio((current) => current ? mutator(current) : current);
    setDirty(true);
  }

  async function persistDraft() {
    if (!portfolio || !data) throw new Error("管理数据尚未就绪");
    const snapshot = portfolio;
    const startVersion = changeVersionRef.current;
    const result = await api<{ revision: number; updatedAt: string }>("/api/admin/portfolio", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: data.revision, portfolio: snapshot }),
    });
    const hasNewChanges = changeVersionRef.current !== startVersion;
    setData((current) => current ? { ...current, revision: result.revision, updatedAt: result.updatedAt, portfolio: snapshot } : current);
    setDirty(hasNewChanges);
    setMessage(hasNewChanges ? `r${result.revision} 已保存，仍有新修改待保存` : `草稿已保存 · r${result.revision}`);
    return result.revision;
  }

  async function saveDraft() {
    if (busy) return;
    setOperation("saving");
    setMessage("正在保存草稿…");
    try {
      return await persistDraft();
    } catch (error) {
      notify(errorMessage(error));
      throw error;
    } finally {
      setOperation("idle");
    }
  }

  async function publish() {
    if (!data || busy) return;
    setOperation("publishing");
    try {
      setMessage(dirty ? "正在保存并发布…" : "正在发布…");
      const revision = dirty ? await persistDraft() : data.revision;
      setMessage("正在发布…");
      const result = await api<{ revision: number; publishedAt: string }>("/api/admin/portfolio/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision }),
      });
      setData((current) => current ? { ...current, revision: result.revision, publishedAt: result.publishedAt } : current);
      localStorage.setItem("portfolio-published-revision", String(result.revision));
      setMessage(`已发布 · ${formatDate(result.publishedAt)}`);
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setOperation("idle");
    }
  }

  async function openQuickPreview() {
    if (busy) return;
    const previewWindow = window.open("about:blank", "portfolio-draft-preview");
    if (!previewWindow) {
      notify("浏览器拦截了快速预览窗口，请允许本站打开新窗口");
      return;
    }
    previewWindow.document.title = "正在准备快速预览…";
    setOperation("previewing");
    setMessage(dirty ? "正在保存草稿并打开预览…" : "正在打开草稿预览…");
    try {
      if (dirty) await persistDraft();
      previewWindow.location.replace("/preview");
      setMessage("快速预览已打开");
    } catch (error) {
      previewWindow.close();
      notify(errorMessage(error));
    } finally {
      setOperation("idle");
    }
  }

  if (state === "loading") return <StatePanel label="LOADING" title="正在打开控制台" detail={message} />;
  if (state === "unauthenticated") {
    return (
      <StatePanel label="ADMIN ACCESS" title="使用邮箱验证码进入后台" detail="只有通过验证的管理员邮箱才能读取或修改网站内容。">
        {signInHref
          ? <a className={styles.primaryAction} href={signInHref} target="_top">验证邮箱并继续 →</a>
          : <button className={styles.primaryAction} type="button" onClick={() => window.location.reload()}>重新验证 →</button>}
      </StatePanel>
    );
  }
  if (state === "setup" && setup) {
    const pending = setup.state === "email_pending";
    return (
      <StatePanel
        label="FIRST SETUP"
        title={pending ? "发送后台入口" : "绑定管理员邮箱"}
        detail={pending ? "邮箱已经锁定。入口邮件发送成功后，网站编辑、上传和发布功能才会开放。" : "以下邮箱来自刚刚完成的身份验证。确认后将永久绑定为这个网站的唯一管理员，之后不能在后台更改。"}
      >
        <div className={styles.setupEmailCard}>
          <span>{pending ? "已绑定管理员" : "当前验证邮箱"}</span>
          <strong>{setup.email}</strong>
          <small>{pending ? "等待发送后台入口邮件" : "绑定后不可更改"}</small>
        </div>
        <button className={styles.primaryAction} type="button" disabled={setupBusy} onClick={() => void completeSetup()}>
          {setupBusy ? "正在处理…" : pending ? "重新发送并完成绑定" : "绑定当前邮箱"}
        </button>
      </StatePanel>
    );
  }
  if (state === "error" || !portfolio || !data || !access) {
    return <StatePanel label="SERVICE STATUS" title="管理台暂时没有连上" detail={message}><button className={styles.primaryAction} onClick={() => void load()}>重新连接</button></StatePanel>;
  }

  return (
    <>
      <header className={styles.adminHeader}>
        <button type="button" className={styles.headerPreview} disabled={busy} onClick={() => void openQuickPreview()}>
          <span aria-hidden="true">↗</span><strong>快速预览</strong><small>保存草稿后打开</small>
        </button>
        <div><span className={styles.systemState}><i /> ONLINE</span><a href="/" target="_blank" rel="noreferrer">打开已发布前台 ↗</a><a href={signOutHref} target="_top">安全退出</a></div>
      </header>
      <div className={styles.workspace}>
      {portfolio.settings.customFont.src?.startsWith("/api/media/") && <style>{`@font-face{font-family:PortfolioCustom;src:url("${portfolio.settings.customFont.src}");font-display:swap;}`}</style>}
      <aside className={styles.sidebar}>
        <div className={styles.ownerCard}>
          <span>ADMIN</span>
          <strong>{portfolio.hero.name}</strong>
          <small>{data.identity.email || initialEmail}</small>
        </div>
        <nav aria-label="后台功能">
          {views.map((item) => (
            <button key={item.id} type="button" data-active={view === item.id} onClick={() => setView(item.id)}>
              <span>{item.index}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className={styles.saveState} data-dirty={dirty} role="status" aria-live="polite">
          <i />
          <span>{dirty && operation === "idle" ? `有未保存修改 · ${message}` : message}</span>
        </div>
        <button className={styles.saveButton} type="button" disabled={!dirty || busy} onClick={() => void saveDraft()}>
          {busy ? "处理中…" : "保存草稿"}
        </button>
      </aside>

      <section className={styles.content}>
        {view === "overview" && <Overview data={data} portfolio={portfolio} access={access} setAccess={setAccess} change={change} onNavigate={setView} setMessage={notify} />}
        {view === "identity" && <IdentityEditor portfolio={portfolio} change={change} setMessage={notify} />}
        {view === "categories" && <CategoryEditor portfolio={portfolio} change={change} setMessage={notify} />}
        {view === "projects" && (
          <ProjectEditor
            portfolio={portfolio}
            selectedProject={selectedProject}
            selectedProjectId={selectedProjectId}
            setSelectedProjectId={setSelectedProjectId}
            change={change}
            setMessage={notify}
          />
        )}
        {view === "contact" && <ContactEditor portfolio={portfolio} change={change} setMessage={notify} />}
        {view === "publish" && <PublishPanel portfolio={portfolio} data={data} dirty={dirty} busy={busy} publish={publish} />}
        {view === "records" && <RecordsPanel events={events} audits={audits} />}
      </section>
      {operationError && <OperationErrorDialog error={operationError} onClose={() => setOperationError(null)} />}
      </div>
    </>
  );
}

function Overview({ data, portfolio, access, setAccess, change, onNavigate, setMessage }: { data: AdminPayload; portfolio: PortfolioDocument; access: AccessPayload; setAccess: (next: AccessPayload) => void; change: (mutator: (document: PortfolioDocument) => PortfolioDocument) => void; onNavigate: (view: View) => void; setMessage: (message: string) => void }) {
  const mediaCount = portfolio.hero.slides.length
    + (portfolio.settings.customFont.key ? 1 : 0)
    + (portfolio.settings.contact.image.key ? 1 : 0)
    + portfolio.categories.filter((category) => category.transition.mode === "image").length
    + portfolio.projects.reduce((total, project) => total + 2 + project.detailBlocks.reduce((count, block) => count + (block.type === "gallery" ? block.items.length : block.type === "text" ? 0 : 1), 0), 0);
  return (
    <>
      <ViewHeader eyebrow="01 / OVERVIEW" title={`你好，${portfolio.hero.name}`} detail="从网页名称开始，按前台顺序管理首图、作品和联系信息。" />
      <div className={styles.formSection}>
        <SectionTitle index="SITE" title="网页名称" />
        <Field label="浏览器标签与站点名称" wide><input maxLength={80} value={portfolio.settings.siteTitle} onChange={(event) => change((document) => ({ ...document, settings: { ...document.settings, siteTitle: event.target.value } }))} /></Field>
      </div>
      <AccessManager access={access} onChange={setAccess} setMessage={setMessage} />
      <div className={styles.metricGrid}>
        <Metric value={portfolio.projects.length} label="作品" />
        <Metric value={portfolio.categories.length} label="分类" />
        <Metric value={mediaCount} label="图片与视频" />
        <Metric value={`r${data.revision}`} label="当前修订" />
      </div>
      <section className={styles.overviewSplit}>
        <div>
          <p className={styles.sectionLabel}>PUBLISH STATUS</p>
          <h2>{data.publishedAt ? "作品集已上线" : "等待第一次发布"}</h2>
          <p>{data.publishedAt ? `最近发布：${formatDate(data.publishedAt)}` : "完成内容和媒体后，在发布页生成公开快照。"}</p>
          <button type="button" onClick={() => onNavigate("publish")}>前往发布 →</button>
        </div>
        <div>
          <p className={styles.sectionLabel}>NEXT STEP</p>
          <h2>先从个人首图开始</h2>
          <p>姓名、求职方向与一句定位决定访客看到的第一印象。</p>
          <button type="button" onClick={() => onNavigate("identity")}>编辑首图 →</button>
        </div>
      </section>
    </>
  );
}

function IdentityEditor({ portfolio, change, setMessage }: { portfolio: PortfolioDocument; change: (mutator: (document: PortfolioDocument) => PortfolioDocument) => void; setMessage: (message: string) => void }) {
  function heroField(field: keyof PortfolioDocument["hero"], value: string) {
    change((document) => ({ ...document, hero: { ...document.hero, [field]: value } }));
  }
  function updateSlide(id: string, updater: (slide: HeroSlide) => HeroSlide) {
    change((document) => ({ ...document, hero: { ...document.hero, slides: document.hero.slides.map((slide) => slide.id === id ? updater(slide) : slide) } }));
  }
  function addSlide() {
    const slide: HeroSlide = {
      id: `hero-slide-${createClientId()}`,
      media: emptyMedia("image"),
      contentMode: "image-only",
      effect: "halo",
      animationEnabled: false,
      layers: createDefaultHeroLayers(),
    };
    change((document) => ({ ...document, hero: { ...document.hero, slides: [...document.hero.slides, slide] } }));
  }
  function duplicateSlide(slide: HeroSlide) {
    const copy: HeroSlide = {
      ...slide,
      id: `hero-slide-${createClientId()}`,
      media: { ...slide.media, id: `hero-media-${createClientId()}`, key: undefined, src: undefined, label: "" },
      layers: slide.layers.map((layer) => ({ ...layer })),
    };
    change((document) => ({ ...document, hero: { ...document.hero, slides: [...document.hero.slides, copy] } }));
  }
  function removeSlide(id: string) {
    if (portfolio.hero.slides.length === 1) {
      setMessage("至少需要保留一张首图");
      return;
    }
    change((document) => ({ ...document, hero: { ...document.hero, slides: document.hero.slides.filter((slide) => slide.id !== id) } }));
  }
  return (
    <>
      <ViewHeader eyebrow="03 / IDENTITY" title="个人首图与页面基调" detail="图片裁切和文字排版共用同一块真实画布。" />
      <div className={styles.formSection}>
        <div className={styles.editorSectionHeader}>
          <SectionTitle index="01" title="多张首图与自由排版" />
          <button type="button" onClick={addSlide}>＋ 增加首图</button>
        </div>
        <div className={styles.heroSlideList}>
          {portfolio.hero.slides.map((slide, index) => (
            <article className={styles.heroSlideCard} key={slide.id}>
              <header>
                <div><span>首图 {String(index + 1).padStart(2, "0")}</span><strong>{slide.media.label || "等待上传图片"}</strong></div>
                <div>
                  <button type="button" disabled={index === 0} onClick={() => change((document) => ({ ...document, hero: { ...document.hero, slides: moveItem(document.hero.slides, slide.id, -1) } }))}>↑</button>
                  <button type="button" disabled={index === portfolio.hero.slides.length - 1} onClick={() => change((document) => ({ ...document, hero: { ...document.hero, slides: moveItem(document.hero.slides, slide.id, 1) } }))}>↓</button>
                  <button type="button" onClick={() => duplicateSlide(slide)}>复制</button>
                  <button type="button" onClick={() => removeSlide(slide.id)}>删除</button>
                </div>
              </header>
              <MediaUpload projectId="site" slot="hero" title="首图图片" asset={slide.media} freeCrop setMessage={setMessage} onUploaded={(asset) => updateSlide(slide.id, (current) => ({ ...current, media: asset }))} onCropChange={(crop, sourceAspectRatio) => updateSlide(slide.id, (current) => ({ ...current, media: { ...current.media, crop, sourceAspectRatio } }))} />
              <div className={styles.inlineChoices}>
                <Field label="显示模式"><select value={slide.contentMode} onChange={(event) => updateSlide(slide.id, (current) => ({ ...current, contentMode: event.target.value as HeroSlide["contentMode"] }))}><option value="image-only">纯图片</option><option value="system">系统排版</option><option value="free">自由排版</option></select></Field>
                <Field label="首图效果"><select value={slide.effect} onChange={(event) => updateSlide(slide.id, (current) => ({ ...current, effect: event.target.value as HeroSlide["effect"] }))}><option value="halo">柔光</option><option value="signal">信号</option></select></Field>
                <Field label="系统动画"><select value={slide.animationEnabled ? "on" : "off"} onChange={(event) => updateSlide(slide.id, (current) => ({ ...current, animationEnabled: event.target.value === "on" }))}><option value="on">开启</option><option value="off">关闭</option></select></Field>
              </div>
              {slide.contentMode !== "image-only" && <HeroLayoutEditor hero={portfolio.hero} slide={slide} customFontReady={Boolean(portfolio.settings.customFont.key)} onChange={(next) => updateSlide(slide.id, () => next)} onHeroChange={(patch) => change((document) => ({ ...document, hero: { ...document.hero, ...patch } }))} />}
            </article>
          ))}
        </div>
      </div>
      <div className={styles.formSection}>
        <SectionTitle index="02" title="首图文字" />
        <div className={styles.formGrid}>
          <Field label="姓名"><input value={portfolio.hero.name} onChange={(event) => heroField("name", event.target.value)} /></Field>
          <Field label="职业标题"><input value={portfolio.hero.role} onChange={(event) => heroField("role", event.target.value)} /></Field>
          <Field label="求职方向"><input value={portfolio.hero.targetRole} onChange={(event) => heroField("targetRole", event.target.value)} /></Field>
          <Field label="个人定位" wide><textarea rows={4} value={portfolio.hero.statement} onChange={(event) => heroField("statement", event.target.value)} /></Field>
          <Field label="状态短句" wide><input value={portfolio.hero.availability} onChange={(event) => heroField("availability", event.target.value)} /></Field>
        </div>
      </div>
      <div className={styles.formSection}>
        <SectionTitle index="03" title="字体与四套页面主题" />
        <div className={styles.choiceGrid}>
          {portfolio.themes.map((theme) => (
            <button key={theme.id} type="button" data-selected={portfolio.settings.activeTheme === theme.id} onClick={() => change((document) => ({ ...document, settings: { ...document.settings, activeTheme: theme.id } }))}>
              <span>{theme.swatches.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span>
              <strong>{theme.label}</strong>
            </button>
          ))}
        </div>
        <div className={styles.inlineChoices}>
          <Field label="作品展开"><select value={portfolio.settings.expansionMode} onChange={(event) => change((document) => ({ ...document, settings: { ...document.settings, expansionMode: event.target.value as "single" | "multiple" } }))}><option value="single">同时展开一个</option><option value="multiple">允许多个展开</option></select></Field>
          <MediaUpload projectId="site" slot="font" title="自定义字体" asset={portfolio.settings.customFont} setMessage={setMessage} onUploaded={(asset) => change((document) => ({ ...document, settings: { ...document.settings, customFont: asset } }))} />
        </div>
      </div>
      <div className={styles.formSection}>
        <SectionTitle index="04" title="作品区大标题" />
        <div className={styles.formGrid}>
          <Field label="第一行"><input maxLength={100} value={portfolio.settings.workHeading.lead} onChange={(event) => change((document) => ({ ...document, settings: { ...document.settings, workHeading: { ...document.settings.workHeading, lead: event.target.value } } }))} /></Field>
          <Field label="第二行（主题弱化色）"><input maxLength={100} value={portfolio.settings.workHeading.accent} onChange={(event) => change((document) => ({ ...document, settings: { ...document.settings, workHeading: { ...document.settings.workHeading, accent: event.target.value } } }))} /></Field>
        </div>
      </div>
    </>
  );
}

function ContactEditor({ portfolio, change, setMessage }: { portfolio: PortfolioDocument; change: (mutator: (document: PortfolioDocument) => PortfolioDocument) => void; setMessage: (message: string) => void }) {
  const contact = portfolio.settings.contact;
  function updateContact(patch: Partial<typeof contact>) {
    change((document) => ({ ...document, settings: { ...document.settings, contact: { ...document.settings.contact, ...patch } } }));
  }
  function updateHero(field: "email" | "phone", value: string) {
    change((document) => ({ ...document, hero: { ...document.hero, [field]: value } }));
  }
  function updateStyle(key: "eyebrowStyle" | "titleStyle" | "detailsStyle" | "noteStyle", patch: Partial<CoverTextStyle>) {
    updateContact({ [key]: { ...contact[key], ...patch } });
  }
  return (
    <>
      <ViewHeader eyebrow="02 / CONTACT" title="联系资料与弹层" detail="直接在右侧画布拖动排版，双击文字即可修改内容。" />
      <div className={styles.contactEditorGrid}>
        <div className={styles.formSection}>
          <SectionTitle index="01" title="联系内容" />
          <div className={styles.formGrid}>
            <Field label="眉题"><input maxLength={60} value={contact.eyebrow} onChange={(event) => updateContact({ eyebrow: event.target.value })} /></Field>
            <Field label="主标题"><input maxLength={100} value={contact.title} onChange={(event) => updateContact({ title: event.target.value })} /></Field>
            <Field label="联系邮箱"><input type="email" value={portfolio.hero.email} onChange={(event) => updateHero("email", event.target.value)} /></Field>
            <Field label="电话号码"><input value={portfolio.hero.phone} onChange={(event) => updateHero("phone", event.target.value)} /></Field>
            <Field label="排版"><select value={contact.layout} onChange={(event) => {
              const layout = event.target.value as typeof contact.layout;
              const textX = layout === "image-left" ? 50 : 6;
              updateContact({
                layout,
                eyebrowStyle: { ...contact.eyebrowStyle, x: textX, width: 44 },
                titleStyle: { ...contact.titleStyle, x: textX, width: 44 },
                detailsStyle: { ...contact.detailsStyle, x: textX, width: 44 },
                noteStyle: { ...contact.noteStyle, x: textX, width: 44 },
              });
            }}><option value="details-left">资料在左</option><option value="image-left">图片在左</option></select></Field>
            <Field label="说明" wide><textarea rows={4} maxLength={300} value={contact.note} onChange={(event) => updateContact({ note: event.target.value })} /></Field>
          </div>
          <MediaUpload projectId="site" slot="contact" title="联系图片" asset={contact.image} cropAspect={1} setMessage={setMessage} onUploaded={(image) => updateContact({ image })} onCropChange={(crop, sourceAspectRatio) => updateContact({ image: { ...contact.image, crop, sourceAspectRatio } })} />
          <div className={styles.coverStyleEditor}>
            <div className={styles.coverStyleHeader}><span>联系文字排版</span><small>拖动右侧画布更直观，也可以在这里精确调整。</small></div>
            {([
              ["eyebrowStyle", "眉题"],
              ["titleStyle", "主标题"],
              ["detailsStyle", "联系方式"],
              ["noteStyle", "说明"],
            ] as const).map(([key, label]) => <CoverStyleControls key={key} label={label} style={contact[key]} customFontReady={Boolean(portfolio.settings.customFont.key)} onChange={(patch) => updateStyle(key, patch)} />)}
          </div>
        </div>
        <ContactLayoutPreview portfolio={portfolio} updateContact={updateContact} updateHero={updateHero} updateStyle={updateStyle} />
      </div>
    </>
  );
}

function ContactLayoutPreview({ portfolio, updateContact, updateHero, updateStyle }: { portfolio: PortfolioDocument; updateContact: (patch: Partial<PortfolioDocument["settings"]["contact"]>) => void; updateHero: (field: "email" | "phone", value: string) => void; updateStyle: (key: "eyebrowStyle" | "titleStyle" | "detailsStyle" | "noteStyle", patch: Partial<CoverTextStyle>) => void }) {
  const contact = portfolio.settings.contact;
  const [selected, setSelected] = useState<"eyebrowStyle" | "titleStyle" | "detailsStyle" | "noteStyle">("titleStyle");
  const [drag, setDrag] = useState<{ key: "eyebrowStyle" | "titleStyle" | "detailsStyle" | "noteStyle"; mode: "move" | "resize"; startX: number; startY: number; width: number; height: number; style: CoverTextStyle } | null>(null);
  function start(event: React.PointerEvent<HTMLElement>, key: typeof selected, mode: "move" | "resize") {
    event.preventDefault(); event.stopPropagation();
    const canvas = event.currentTarget.closest<HTMLElement>("[data-contact-canvas]");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ key, mode, startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height, style: contact[key] });
    setSelected(key);
  }
  function move(event: React.PointerEvent<HTMLElement>) {
    if (!drag) return;
    const dx = ((event.clientX - drag.startX) / drag.width) * 100;
    const dy = ((event.clientY - drag.startY) / drag.height) * 100;
    updateStyle(drag.key, drag.mode === "move"
      ? { x: clamp(drag.style.x + dx, 0, 100 - drag.style.width), y: clamp(drag.style.y + dy, 0, 100) }
      : { width: clamp(drag.style.width + dx, 10, 100 - drag.style.x), scale: clamp(drag.style.scale + dy / 18, .5, 2.5) });
  }
  function stop(event: React.PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  }
  const styleFor = (style: CoverTextStyle, key: typeof selected): React.CSSProperties => ({ left: `${style.x}%`, top: `${style.y}%`, width: `${style.width}%`, transform: `translateY(-50%) scale(${style.scale})`, transformOrigin: "left center", textAlign: style.align, color: style.color === "system" ? key === "eyebrowStyle" ? "#8da4ff" : key === "noteStyle" ? "#aeb3bf" : "#ffffff" : style.color, fontFamily: style.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined });
  function layerProps(key: typeof selected) {
    return { "data-selected": selected === key, onPointerDown: (event: React.PointerEvent<HTMLElement>) => start(event, key, "move"), onPointerMove: move, onPointerUp: stop, onPointerCancel: stop };
  }
  return (
    <section className={styles.contactAdminPreview} data-layout={contact.layout} data-contact-canvas aria-label="联系弹层预览">
      <div className={styles.contactAdminVisual}>
        {contact.image.src
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={contact.image.src} alt="" style={croppedImageStyle(contact.image)} />
          : <span>联系图片预览</span>}
      </div>
      <section {...layerProps("eyebrowStyle")} className={styles.contactTextLayer} style={styleFor(contact.eyebrowStyle, "eyebrowStyle")}><DirectText tag="p" value={contact.eyebrow} label="联系眉题" onCommit={(eyebrow) => updateContact({ eyebrow })} /><i className={styles.resizeHandle} onPointerDown={(event) => start(event, "eyebrowStyle", "resize")} onPointerMove={move} onPointerUp={stop} /></section>
      <section {...layerProps("titleStyle")} className={styles.contactTextLayer} data-kind="title" style={styleFor(contact.titleStyle, "titleStyle")}><DirectText tag="strong" value={contact.title} label="联系标题" onCommit={(title) => updateContact({ title })} /><i className={styles.resizeHandle} onPointerDown={(event) => start(event, "titleStyle", "resize")} onPointerMove={move} onPointerUp={stop} /></section>
      <section {...layerProps("detailsStyle")} className={styles.contactTextLayer} style={styleFor(contact.detailsStyle, "detailsStyle")}><DirectText value={portfolio.hero.email} label="联系邮箱" onCommit={(email) => updateHero("email", email)} />{portfolio.hero.phone && <DirectText value={portfolio.hero.phone} label="联系电话" onCommit={(phone) => updateHero("phone", phone)} />}<i className={styles.resizeHandle} onPointerDown={(event) => start(event, "detailsStyle", "resize")} onPointerMove={move} onPointerUp={stop} /></section>
      <section {...layerProps("noteStyle")} className={styles.contactTextLayer} style={styleFor(contact.noteStyle, "noteStyle")}><DirectText tag="small" value={contact.note} label="联系说明" onCommit={(note) => updateContact({ note })} /><i className={styles.resizeHandle} onPointerDown={(event) => start(event, "noteStyle", "resize")} onPointerMove={move} onPointerUp={stop} /></section>
    </section>
  );
}

function CategoryEditor({ portfolio, change, setMessage }: { portfolio: PortfolioDocument; change: (mutator: (document: PortfolioDocument) => PortfolioDocument) => void; setMessage: (message: string) => void }) {
  function updateCategory(id: string, patch: Partial<CategoryConfig>) {
    change((document) => ({ ...document, categories: document.categories.map((category) => category.id === id ? { ...category, ...patch } : category) }));
  }
  function move(id: string, direction: -1 | 1) {
    change((document) => ({ ...document, categories: moveItem(document.categories, id, direction) }));
  }
  function remove(id: string) {
    if (portfolio.categories.length === 1) {
      setMessage("作品集至少需要保留一个分类");
      return;
    }
    if (portfolio.projects.some((project) => project.categoryId === id)) {
      setMessage("这个分类仍有作品，请先移动作品再删除");
      return;
    }
    if (window.confirm("确认删除这个分类？")) {
      change((document) => ({ ...document, categories: document.categories.filter((category) => category.id !== id) }));
    }
  }
  function add() {
    const category: CategoryConfig = {
      id: `category-${createClientId()}`,
      label: "新分类",
      accent: "#9fb4ff",
      transition: { mode: "default", visible: true, media: emptyMedia("image") },
    };
    change((document) => ({ ...document, categories: [...document.categories, category] }));
  }
  return (
    <>
      <ViewHeader eyebrow="04 / CATEGORIES" title="自定义作品分类" detail="名称、颜色和顺序都可以调整；前台会自动计算每类数量。" action={<button onClick={add}>＋ 新建分类</button>} />
      <div className={styles.listEditor}>
        {portfolio.categories.map((category, index) => (
          <article className={styles.categoryCard} key={category.id}>
            <div className={styles.categoryRow}>
              <span className={styles.dragIndex}>{String(index + 1).padStart(2, "0")}</span>
              <input className={styles.colorInput} type="color" value={category.accent} aria-label={`${category.label}颜色`} onChange={(event) => updateCategory(category.id, { accent: event.target.value })} />
              <input value={category.label} aria-label="分类名称" onChange={(event) => updateCategory(category.id, { label: event.target.value })} />
              <code>{category.id}</code>
              <div><button type="button" onClick={() => move(category.id, -1)} disabled={index === 0}>↑</button><button type="button" onClick={() => move(category.id, 1)} disabled={index === portfolio.categories.length - 1}>↓</button><button type="button" onClick={() => remove(category.id)}>删除</button></div>
            </div>
            <div className={styles.transitionEditor}>
              <div className={styles.transitionOptions}>
                <Field label="模块过渡条"><select value={category.transition.mode} onChange={(event) => updateCategory(category.id, { transition: { ...category.transition, mode: event.target.value as "default" | "image" } })}><option value="default">跟随系统主题并保留跳转</option><option value="image">上传自定义图片，不生成跳转</option></select></Field>
                <label className={styles.checkControl}><input type="checkbox" checked={category.transition.visible} onChange={(event) => updateCategory(category.id, { transition: { ...category.transition, visible: event.target.checked } })} /><span>前台显示这条过渡条</span></label>
              </div>
              {category.transition.mode === "image" && (
                <MediaUpload projectId={category.id} slot="transition" title="过渡条图片" asset={category.transition.media} cropAspect={8} setMessage={setMessage} onUploaded={(asset) => updateCategory(category.id, { transition: { ...category.transition, media: asset } })} onCropChange={(crop, sourceAspectRatio) => updateCategory(category.id, { transition: { ...category.transition, media: { ...category.transition.media, crop, sourceAspectRatio } } })} />
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function ProjectEditor({
  portfolio, selectedProject, selectedProjectId, setSelectedProjectId, change, setMessage,
}: {
  portfolio: PortfolioDocument;
  selectedProject: Project | null;
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  change: (mutator: (document: PortfolioDocument) => PortfolioDocument) => void;
  setMessage: (message: string) => void;
}) {
  function updateProject(projectId: string, updater: (project: Project) => Project) {
    change((document) => ({ ...document, projects: document.projects.map((project) => project.id === projectId ? updater(project) : project) }));
  }
  function addProject() {
    const project = createProject(portfolio.categories[0]?.id ?? "uncategorized", portfolio.projects.length + 1);
    change((document) => ({ ...document, projects: [...document.projects, project] }));
    setSelectedProjectId(project.id);
  }
  function removeProject(id: string) {
    if (!window.confirm("确认删除这个作品及其页面结构？已上传媒体会在后续清理。")) return;
    change((document) => ({ ...document, projects: document.projects.filter((project) => project.id !== id).map((project, index) => ({ ...project, order: index + 1 })) }));
    const next = portfolio.projects.find((project) => project.id !== id);
    setSelectedProjectId(next?.id ?? null);
  }
  function moveProject(id: string, direction: -1 | 1) {
    change((document) => ({ ...document, projects: moveItem(document.projects, id, direction).map((project, index) => ({ ...project, order: index + 1 })) }));
  }

  return (
    <>
      <ViewHeader eyebrow="05 / PROJECTS" title="作品与项目过程" detail="封面保持单列，展开后按内容块顺序展示简介、制作流程、角色和单帧。" action={<button onClick={addProject}>＋ 新建作品</button>} />
      <div className={styles.formSection}>
        <SectionTitle index="PLAYER" title="作品封面与视频水印" />
        <div className={styles.formGrid}>
          <Field label="视频水印文字"><input maxLength={80} value={portfolio.settings.videoWatermarkText} onChange={(event) => change((document) => ({ ...document, settings: { ...document.settings, videoWatermarkText: event.target.value } }))} placeholder={`留空时使用姓名：${portfolio.hero.name}`} /></Field>
          <Field label={`水印字号 · ${portfolio.settings.videoWatermarkStyle.fontSize}px`}><input type="range" min="10" max="72" step="1" value={portfolio.settings.videoWatermarkStyle.fontSize} onChange={(event) => change((document) => ({ ...document, settings: { ...document.settings, videoWatermarkStyle: { ...document.settings.videoWatermarkStyle, fontSize: Number(event.target.value) } } }))} /></Field>
          <Field label="水印颜色"><input className={styles.wideColorInput} type="color" value={portfolio.settings.videoWatermarkStyle.color} onChange={(event) => change((document) => ({ ...document, settings: { ...document.settings, videoWatermarkStyle: { ...document.settings.videoWatermarkStyle, color: event.target.value as `#${string}` } } }))} /></Field>
          <Field label="水印字体"><select value={portfolio.settings.videoWatermarkStyle.fontFamily} onChange={(event) => change((document) => ({ ...document, settings: { ...document.settings, videoWatermarkStyle: { ...document.settings.videoWatermarkStyle, fontFamily: event.target.value as "system" | "custom" } } }))}><option value="system">系统字体</option><option value="custom" disabled={!portfolio.settings.customFont.key}>自定义字体</option></select></Field>
          <div className={styles.watermarkPreview} aria-label="水印大小预览">
            <span style={{ color: portfolio.settings.videoWatermarkStyle.color, fontSize: `${portfolio.settings.videoWatermarkStyle.fontSize}px`, fontFamily: portfolio.settings.videoWatermarkStyle.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined }}>{resolveWatermarkText(portfolio.settings.videoWatermarkText, portfolio.hero.name)}</span>
            <small>视频画面中的实际比例参考 · {portfolio.settings.videoWatermarkStyle.fontSize}px</small>
          </div>
        </div>
      </div>
      <div className={styles.projectWorkspace}>
        <aside className={styles.projectList}>
          {portfolio.projects.map((project, index) => (
            <button key={project.id} type="button" data-selected={selectedProjectId === project.id} onClick={() => setSelectedProjectId(project.id)}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{project.title}</strong>
              <small>{portfolio.categories.find((category) => category.id === project.categoryId)?.label}</small>
            </button>
          ))}
        </aside>
        <div className={styles.projectForm}>
          {!selectedProject ? <p className={styles.emptyState}>新建一个作品后开始编辑。</p> : (
            <ProjectForm
              project={selectedProject}
              categories={portfolio.categories}
              update={(updater) => updateProject(selectedProject.id, updater)}
              remove={() => removeProject(selectedProject.id)}
              move={(direction) => moveProject(selectedProject.id, direction)}
              setMessage={setMessage}
              customFontReady={Boolean(portfolio.settings.customFont.key)}
            />
          )}
        </div>
      </div>
    </>
  );
}

function ProjectForm({ project, categories, update, remove, move, setMessage, customFontReady }: { project: Project; categories: CategoryConfig[]; update: (updater: (project: Project) => Project) => void; remove: () => void; move: (direction: -1 | 1) => void; setMessage: (message: string) => void; customFontReady: boolean }) {
  function field(name: keyof Project, value: string) { update((current) => ({ ...current, [name]: value })); }
  function setAsset(slot: "cover" | "finalVideo", asset: MediaAsset) { update((current) => ({ ...current, [slot]: asset })); }
  function setAssetCrop(slot: "cover" | "finalVideo", crop: MediaCrop, sourceAspectRatio: number) { update((current) => ({ ...current, [slot]: { ...current[slot], crop, sourceAspectRatio } })); }
  function updateBlock(blockId: string, updater: (block: ProjectBlock) => ProjectBlock) {
    update((current) => ({ ...current, detailBlocks: current.detailBlocks.map((block) => block.id === blockId ? updater(block) : block) }));
  }
  function addBlock(type: ProjectBlock["type"]) {
    update((current) => ({ ...current, detailBlocks: [...current.detailBlocks, createBlock(type)] }));
  }
  function updateCoverStyle(key: "titleStyle" | "synopsisStyle" | "factsStyle", patch: Partial<CoverTextStyle>) {
    const defaults = createDefaultCoverPresentation();
    update((current) => ({
      ...current,
      coverPresentation: { ...current.coverPresentation, [key]: { ...(current.coverPresentation[key] ?? defaults[key]), ...patch } },
    }));
  }
  return (
    <>
      <div className={styles.projectTools}><button type="button" onClick={() => move(-1)}>↑ 前移</button><button type="button" onClick={() => move(1)}>↓ 后移</button><button type="button" className={styles.danger} onClick={remove}>删除作品</button></div>
      <div className={styles.formGrid}>
        <Field label="作品名称" wide><input value={project.title} onChange={(event) => field("title", event.target.value)} /></Field>
        <Field label="分类"><select value={project.categoryId} onChange={(event) => field("categoryId", event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></Field>
        <Field label="年份"><input value={project.year} onChange={(event) => field("year", event.target.value)} /></Field>
        <Field label="作品简介" wide><textarea rows={4} value={project.synopsis} onChange={(event) => field("synopsis", event.target.value)} /></Field>
        <Field label="项目难点" wide><textarea rows={3} value={project.challenge} onChange={(event) => field("challenge", event.target.value)} /></Field>
        <Field label="解决思路" wide><textarea rows={3} value={project.solution} onChange={(event) => field("solution", event.target.value)} /></Field>
      </div>
      <SectionTitle index="MEDIA" title="封面与成稿视频" />
      <div className={styles.mediaGrid}>
        <MediaUpload projectId={project.id} slot="cover" title="项目封面" asset={project.cover} cropAspect={16 / 9} setMessage={setMessage} onUploaded={(asset) => setAsset("cover", asset)} onCropChange={(crop, sourceAspectRatio) => setAssetCrop("cover", crop, sourceAspectRatio)} />
        <div className={styles.videoUploadColumn}>
          <MediaUpload projectId={project.id} slot="final" title="成稿视频" asset={project.finalVideo} setMessage={setMessage} onUploaded={(asset, metadata) => { setAsset("finalVideo", asset); if (metadata?.durationSeconds) update((current) => ({ ...current, duration: formatVideoDuration(metadata.durationSeconds as number) })); }} />
          <p className={styles.durationReadout}><span>视频时长</span><strong>{project.duration}</strong></p>
        </div>
      </div>
      <div className={styles.presentationToggles}>
        <span>封面悬浮信息</span>
        <label className={styles.overlayPinControl}>
          <input
            type="checkbox"
            role="switch"
            checked={project.coverPresentation.overlayMode === "fixed"}
            onChange={(event) => update((current) => ({
              ...current,
              coverPresentation: { ...current.coverPresentation, overlayMode: event.target.checked ? "fixed" : "hover" },
            }))}
          />
          <i aria-hidden="true" />
          <span><strong>悬浮窗常驻</strong><small>开启后，封面信息与渐变层保持显示</small></span>
        </label>
        {([
          ["showTitle", "作品名与分类"],
          ["showSynopsis", "项目介绍"],
          ["showFacts", "年份、难点与解决思路"],
        ] as const).map(([key, label]) => (
          <label key={key} className={styles.checkControl}>
            <input
              type="checkbox"
              checked={project.coverPresentation[key]}
              onChange={(event) => update((current) => ({
                ...current,
                coverPresentation: { ...current.coverPresentation, [key]: event.target.checked },
              }))}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div className={styles.coverStyleEditor}>
        <div className={styles.coverStyleHeader}><span>封面文字排版</span><small>下方设置会立即显示在真实封面预览中。</small></div>
        <CoverLayoutPreview project={project} categoryLabel={categories.find((category) => category.id === project.categoryId)?.label ?? "作品"} update={update} updateStyle={updateCoverStyle} />
        {([
          ["titleStyle", "标题"],
          ["synopsisStyle", "项目介绍"],
          ["factsStyle", "项目信息"],
        ] as const).map(([key, label]) => {
          const defaults = createDefaultCoverPresentation();
          const style = project.coverPresentation[key] ?? defaults[key];
          return <CoverStyleControls key={key} label={label} style={style} customFontReady={customFontReady} onChange={(patch) => updateCoverStyle(key, patch)} />;
        })}
      </div>
      <div className={styles.blockHeader}>
        <SectionTitle index="BLOCKS" title="项目内容块" />
        <div>{(["text", "media-text", "gallery", "full-media"] as const).map((type) => <button key={type} onClick={() => addBlock(type)}>＋ {blockLabel(type)}</button>)}</div>
      </div>
      <div className={styles.blockList}>
        {project.detailBlocks.map((block, index) => (
          <BlockEditor
            key={block.id}
            block={block}
            index={index}
            projectId={project.id}
            setMessage={setMessage}
            update={(updater) => updateBlock(block.id, updater)}
            move={(direction) => update((current) => ({ ...current, detailBlocks: moveItem(current.detailBlocks, block.id, direction) }))}
            remove={() => {
              if (window.confirm("确认删除这个内容块？")) {
                update((current) => ({ ...current, detailBlocks: current.detailBlocks.filter((item) => item.id !== block.id) }));
              }
            }}
          />
        ))}
      </div>
    </>
  );
}

function BlockEditor({ block, index, projectId, setMessage, update, move, remove }: { block: ProjectBlock; index: number; projectId: string; setMessage: (value: string) => void; update: (updater: (block: ProjectBlock) => ProjectBlock) => void; move: (direction: -1 | 1) => void; remove: () => void }) {
  return (
    <article className={styles.blockCard}>
      <header><span>{String(index + 1).padStart(2, "0")} · {blockLabel(block.type)}</span><div><button onClick={() => move(-1)}>↑</button><button onClick={() => move(1)}>↓</button><button onClick={remove}>删除</button></div></header>
      {block.type !== "full-media" && <Field label="眉题"><input value={block.eyebrow} onChange={(event) => update((current) => ({ ...current, eyebrow: event.target.value }))} /></Field>}
      {block.type !== "full-media" && <Field label="标题"><input value={block.title} onChange={(event) => update((current) => ({ ...current, title: event.target.value }))} /></Field>}
      {(block.type === "text" || block.type === "media-text") && <Field label="正文"><textarea rows={4} value={block.body} onChange={(event) => update((current) => ({ ...current, body: event.target.value }))} /></Field>}
      {block.type === "media-text" && (
        <><Field label="图片位置"><select value={block.side} onChange={(event) => update((current) => current.type === "media-text" ? { ...current, side: event.target.value as "left" | "right" } : current)}><option value="left">左侧</option><option value="right">右侧</option></select></Field><MediaUpload projectId={projectId} slot="detail" title="混排图片" asset={block.media} cropAspect={4 / 3} setMessage={setMessage} onUploaded={(asset) => update((current) => current.type === "media-text" ? { ...current, media: asset } : current)} onCropChange={(crop, sourceAspectRatio) => update((current) => current.type === "media-text" ? { ...current, media: { ...current.media, crop, sourceAspectRatio } } : current)} /></>
      )}
      {block.type === "full-media" && (
        <><Field label="图注"><input value={block.caption} onChange={(event) => update((current) => current.type === "full-media" ? { ...current, caption: event.target.value } : current)} /></Field><MediaUpload projectId={projectId} slot="detail" title="通栏图片" asset={block.media} cropAspect={16 / 9} setMessage={setMessage} onUploaded={(asset) => update((current) => current.type === "full-media" ? { ...current, media: asset } : current)} onCropChange={(crop, sourceAspectRatio) => update((current) => current.type === "full-media" ? { ...current, media: { ...current.media, crop, sourceAspectRatio } } : current)} /></>
      )}
      {block.type === "gallery" && (
        <>
          <div className={styles.gallerySettings}>
            <Field label="图片方向"><select value={block.orientation} onChange={(event) => {
              const orientation = event.target.value as "portrait" | "landscape";
              const targetAspect = orientation === "landscape" ? 4 / 3 : 3 / 4;
              update((current) => current.type === "gallery" ? {
                ...current,
                orientation,
                items: current.items.map((item) => ({
                  ...item,
                  crop: fitCropToAspect(validAspect(item.sourceAspectRatio, targetAspect), targetAspect),
                })),
              } : current);
            }}><option value="portrait">竖图</option><option value="landscape">横图</option></select></Field>
            <span>{block.items.length} / 4 张 · 排版随数量自动变化</span>
          </div>
          <div className={styles.galleryLayoutGuide} data-count={block.items.length} data-orientation={block.orientation} aria-label="前台图片组排版预览">
            {block.items.map((asset, assetIndex) => <i key={asset.id}>{assetIndex + 1}</i>)}
          </div>
          <div className={styles.galleryEditor}>
            {block.items.map((asset, assetIndex) => (
              <div className={styles.galleryItem} key={asset.id}>
                <MediaUpload projectId={projectId} slot="detail" title={`图片 ${assetIndex + 1}`} asset={asset} cropAspect={block.orientation === "landscape" ? 4 / 3 : 3 / 4} setMessage={setMessage} onUploaded={(next) => update((current) => current.type === "gallery" ? { ...current, items: current.items.map((item) => item.id === asset.id ? next : item) } : current)} onCropChange={(crop, sourceAspectRatio) => update((current) => current.type === "gallery" ? { ...current, items: current.items.map((item) => item.id === asset.id ? { ...item, crop, sourceAspectRatio } : item) } : current)} />
                <div>
                  <button type="button" disabled={assetIndex === 0} onClick={() => update((current) => current.type === "gallery" ? { ...current, items: moveItem(current.items, asset.id, -1) } : current)}>↑</button>
                  <button type="button" disabled={assetIndex === block.items.length - 1} onClick={() => update((current) => current.type === "gallery" ? { ...current, items: moveItem(current.items, asset.id, 1) } : current)}>↓</button>
                  <button type="button" disabled={block.items.length === 1} onClick={() => update((current) => current.type === "gallery" ? { ...current, items: current.items.filter((item) => item.id !== asset.id) } : current)}>删除</button>
                </div>
              </div>
            ))}
            <button type="button" disabled={block.items.length >= 4} onClick={() => update((current) => current.type === "gallery" && current.items.length < 4 ? { ...current, items: [...current.items, emptyMedia("image")] } : current)}>{block.items.length >= 4 ? "最多四张图片" : "＋ 增加图片"}</button>
          </div>
        </>
      )}
    </article>
  );
}

function CoverLayoutPreview({ project, categoryLabel, update, updateStyle }: { project: Project; categoryLabel: string; update: (updater: (project: Project) => Project) => void; updateStyle: (key: "titleStyle" | "synopsisStyle" | "factsStyle", patch: Partial<CoverTextStyle>) => void }) {
  const defaults = createDefaultCoverPresentation();
  const [selected, setSelected] = useState<"titleStyle" | "synopsisStyle" | "factsStyle">("titleStyle");
  const [drag, setDrag] = useState<{ key: "titleStyle" | "synopsisStyle" | "factsStyle"; mode: "move" | "resize"; startX: number; startY: number; width: number; height: number; style: CoverTextStyle } | null>(null);
  const styleFor = (style: CoverTextStyle): React.CSSProperties => ({
    left: `${style.x}%`,
    top: `${style.y}%`,
    width: `${style.width}%`,
    transform: `translateY(-50%) scale(${style.scale})`,
    transformOrigin: "left center",
    textAlign: style.align,
    color: style.color === "system" ? undefined : style.color,
    fontFamily: style.fontFamily === "custom" ? "PortfolioCustom, sans-serif" : undefined,
  });
  function start(event: React.PointerEvent<HTMLElement>, key: "titleStyle" | "synopsisStyle" | "factsStyle", mode: "move" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    const canvas = event.currentTarget.closest<HTMLElement>("[data-cover-canvas]");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const style = project.coverPresentation[key] ?? defaults[key];
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ key, mode, startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height, style });
    setSelected(key);
  }
  function movePointer(event: React.PointerEvent<HTMLElement>) {
    if (!drag) return;
    const dx = ((event.clientX - drag.startX) / drag.width) * 100;
    const dy = ((event.clientY - drag.startY) / drag.height) * 100;
    if (drag.mode === "move") {
      updateStyle(drag.key, { x: clamp(drag.style.x + dx, 0, 100 - drag.style.width), y: clamp(drag.style.y + dy, 0, 100) });
    } else {
      updateStyle(drag.key, { width: clamp(drag.style.width + dx, 10, 100 - drag.style.x), scale: clamp(drag.style.scale + dy / 18, .5, 2.5) });
    }
  }
  function stopPointer(event: React.PointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  }
  function layerProps(key: "titleStyle" | "synopsisStyle" | "factsStyle") {
    return {
      "data-selected": selected === key,
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => start(event, key, "move"),
      onPointerMove: movePointer,
      onPointerUp: stopPointer,
      onPointerCancel: stopPointer,
    };
  }
  return (
    <div className={styles.coverLayoutPreview} data-cover-canvas style={{ aspectRatio: mediaCropAspect(project.cover, 16 / 9) }}>
      {project.cover.src
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={project.cover.src} alt="" style={croppedImageStyle(project.cover)} />
        : <span className={styles.coverPreviewPlaceholder}>上传项目封面后在这里排版</span>}
      <i aria-hidden="true" />
      {project.coverPresentation.showTitle && <section {...layerProps("titleStyle")} className={styles.coverPreviewTitle} style={styleFor(project.coverPresentation.titleStyle ?? defaults.titleStyle)}><small>{categoryLabel}</small><DirectText tag="strong" value={project.title} label="作品名称" onCommit={(title) => update((current) => ({ ...current, title }))} /><i className={styles.resizeHandle} onPointerDown={(event) => start(event, "titleStyle", "resize")} onPointerMove={movePointer} onPointerUp={stopPointer} /></section>}
      {project.coverPresentation.showSynopsis && <section {...layerProps("synopsisStyle")} className={styles.coverPreviewSynopsis} style={styleFor(project.coverPresentation.synopsisStyle ?? defaults.synopsisStyle)}><small>项目介绍</small><DirectText tag="p" value={project.synopsis} label="作品简介" onCommit={(synopsis) => update((current) => ({ ...current, synopsis }))} /><i className={styles.resizeHandle} onPointerDown={(event) => start(event, "synopsisStyle", "resize")} onPointerMove={movePointer} onPointerUp={stopPointer} /></section>}
      {project.coverPresentation.showFacts && <section {...layerProps("factsStyle")} className={styles.coverPreviewFacts} style={styleFor(project.coverPresentation.factsStyle ?? defaults.factsStyle)}><span><DirectText value={project.year} label="年份" onCommit={(year) => update((current) => ({ ...current, year }))} /> · {project.duration}</span><DirectText value={project.challenge || "项目难点"} label="项目难点" onCommit={(challenge) => update((current) => ({ ...current, challenge }))} /><DirectText value={project.solution || "解决思路"} label="解决思路" onCommit={(solution) => update((current) => ({ ...current, solution }))} /><i className={styles.resizeHandle} onPointerDown={(event) => start(event, "factsStyle", "resize")} onPointerMove={movePointer} onPointerUp={stopPointer} /></section>}
    </div>
  );
}

function DirectText({ value, label, onCommit, tag = "span" }: { value: string; label: string; onCommit: (value: string) => void; tag?: "span" | "strong" | "p" | "small" }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.focus();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editing]);
  const props = {
    ref: (node: HTMLElement | null) => { ref.current = node; },
    contentEditable: editing,
    suppressContentEditableWarning: true,
    role: "textbox",
    "aria-label": `双击修改${label}`,
    "data-editing": editing,
    onDoubleClick: (event: React.MouseEvent<HTMLElement>) => { event.preventDefault(); event.stopPropagation(); setEditing(true); },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => { if (editing) event.stopPropagation(); },
    onBlur: (event: React.FocusEvent<HTMLElement>) => { setEditing(false); onCommit(event.currentTarget.textContent?.trim() ?? ""); },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (editing && event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (editing) event.stopPropagation(); },
    children: value,
  };
  if (tag === "strong") return <strong {...props} />;
  if (tag === "p") return <p {...props} />;
  if (tag === "small") return <small {...props} />;
  return <span {...props} />;
}

function CoverStyleControls({ label, style, customFontReady, onChange }: { label: string; style: CoverTextStyle; customFontReady: boolean; onChange: (patch: Partial<CoverTextStyle>) => void }) {
  return (
    <article className={styles.coverStyleRow}>
      <strong>{label}</strong>
      <label><span>字号</span><input type="range" min="0.5" max="2.5" step="0.1" value={style.scale} onChange={(event) => onChange({ scale: Number(event.target.value) })} /></label>
      <label><span>横向位置</span><input type="range" min="0" max="100" step="1" value={style.x} onChange={(event) => onChange({ x: Number(event.target.value) })} /></label>
      <label><span>纵向位置</span><input type="range" min="0" max="100" step="1" value={style.y} onChange={(event) => onChange({ y: Number(event.target.value) })} /></label>
      <label><span>宽度</span><input type="range" min="10" max="100" step="1" value={style.width} onChange={(event) => onChange({ width: Number(event.target.value) })} /></label>
      <select aria-label={`${label}对齐`} value={style.align} onChange={(event) => onChange({ align: event.target.value as CoverTextStyle["align"] })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select>
      <select aria-label={`${label}字体`} value={style.fontFamily} onChange={(event) => onChange({ fontFamily: event.target.value as CoverTextStyle["fontFamily"] })}><option value="system">系统字体</option><option value="custom" disabled={!customFontReady}>自定义字体</option></select>
      <div className={styles.layerColor}><select aria-label={`${label}颜色模式`} value={style.color === "system" ? "system" : "custom"} onChange={(event) => onChange({ color: event.target.value === "system" ? "system" : style.color === "system" ? "#ffffff" : style.color })}><option value="system">主题色</option><option value="custom">自选色</option></select>{style.color !== "system" && <input type="color" aria-label={`${label}自选颜色`} value={style.color} onChange={(event) => onChange({ color: event.target.value as `#${string}` })} />}</div>
    </article>
  );
}

function MediaUpload({ projectId, slot, title, asset, cropAspect = 16 / 9, freeCrop = false, setMessage, onUploaded, onCropChange }: { projectId: string; slot: "hero" | "transition" | "cover" | "final" | "detail" | "font" | "contact"; title: string; asset: MediaAsset; cropAspect?: number; freeCrop?: boolean; setMessage: (message: string) => void; onUploaded: (asset: MediaAsset, metadata?: { durationSeconds?: number }) => void; onCropChange?: (crop: MediaCrop, sourceAspectRatio: number) => void }) {
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | undefined>(asset.src);
  async function upload(file: File) {
    setUploading(true);
    setMessage(`正在上传 ${file.name}…`);
    try {
      const uploadFile = await prepareUploadFile(file, asset.kind);
      const durationSeconds = asset.kind === "video" ? await readVideoDuration(uploadFile) : undefined;
      const sourceAspectRatio = asset.kind === "image" ? await readImageAspectRatio(uploadFile) : undefined;
      if (asset.kind === "video" && durationSeconds === undefined) {
        throw new Error("无法读取视频时长，请改用可播放的 MP4、WebM 或 MOV 文件");
      }
      const limit = asset.kind === "video" ? 90 * 1024 * 1024 : asset.kind === "font" ? 10 * 1024 * 1024 : 8 * 1024 * 1024;
      if (uploadFile.size > limit) {
        throw new Error(asset.kind === "video" ? "视频不能超过 90 MiB" : asset.kind === "font" ? "字体不能超过 10 MiB" : "优化后的图片不能超过 8 MiB");
      }
      const result = await api<{ asset: MediaAsset }>(`/api/admin/media/${projectId}/${slot}?assetId=${encodeURIComponent(asset.id)}`, {
        method: "PUT",
        headers: { "Content-Type": uploadFile.type, "X-File-Name": encodeURIComponent(uploadFile.name) },
        body: uploadFile,
      });
      if (asset.kind === "image") setPreviewSrc(URL.createObjectURL(uploadFile));
      const nextCrop = sourceAspectRatio
        ? freeCrop ? fullMediaCrop() : fitCropToAspect(sourceAspectRatio, cropAspect)
        : asset.crop;
      onUploaded({ ...result.asset, label: file.name, alt: asset.alt, objectPosition: asset.objectPosition, sourceAspectRatio, crop: nextCrop }, { durationSeconds });
      setMessage(`${file.name} 已上传，请保存草稿`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setUploading(false);
    }
  }
  function onInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
    event.target.value = "";
  }
  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    if (uploading) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
  }
  const accept = asset.kind === "video"
    ? "video/mp4,video/webm,video/quicktime"
    : asset.kind === "font"
      ? ".woff,.woff2,.ttf,.otf,font/woff,font/woff2,font/ttf,font/otf"
      : "image/jpeg,image/png,image/webp,image/avif";
  const formatHint = asset.kind === "video"
    ? "MP4 / WebM / MOV · 90 MiB"
    : asset.kind === "font"
      ? "WOFF / WOFF2 / TTF / OTF · 10 MiB"
      : "JPG / PNG / WebP / AVIF · 自动优化";
  return (
    <div className={styles.mediaUploadGroup}>
      <label
        className={styles.mediaUpload}
        data-ready={Boolean(asset.key)}
        data-drag={dragActive}
        onDragEnter={(event) => { event.preventDefault(); if (!uploading) setDragActive(true); }}
        onDragOver={(event) => { event.preventDefault(); if (!uploading) setDragActive(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
        onDrop={onDrop}
      >
        <span>{title}</span><strong>{asset.key ? asset.label || "已上传" : "拖动文件到这里"}</strong><small>{uploading ? "正在优化并上传…" : formatHint}</small>
        <input type="file" disabled={uploading} accept={accept} onChange={onInput} />
        <i>{asset.key ? "拖入替换或点击选择" : "拖入上传或点击选择"}</i>
      </label>
      {asset.kind === "image" && onCropChange && <MediaCropEditor key={`${asset.key ?? asset.id}:${asset.sourceAspectRatio ?? "unknown"}`} asset={asset} previewSrc={previewSrc} fixedAspect={freeCrop ? undefined : cropAspect} onConfirm={onCropChange} />}
    </div>
  );
}

function PublishPanel({ portfolio, data, dirty, busy, publish }: { portfolio: PortfolioDocument; data: AdminPayload; dirty: boolean; busy: boolean; publish: () => Promise<void> }) {
  const missing = [
    ...portfolio.hero.slides.flatMap((slide, index) => !slide.media.key ? [`首图 ${index + 1}：图片`] : []),
    ...portfolio.categories.flatMap((category) => category.transition.mode === "image" && !category.transition.media.key ? [`${category.label}：过渡条图片`] : []),
    ...portfolio.projects.flatMap((project) => [!project.cover.key ? `${project.title}：封面` : null, !project.finalVideo.key ? `${project.title}：成稿` : null].filter(Boolean)),
  ];
  return (
    <>
      <ViewHeader eyebrow="06 / PUBLISH" title="检查并发布作品集" detail="发布会生成独立快照；之后继续编辑草稿，不会改变访客正在看的版本。" />
      <section className={styles.publishCard}>
        <div><span>REVISION</span><strong>r{data.revision}</strong><small>{dirty ? "包含未保存修改" : "草稿已保存"}</small></div>
        <div><span>PROJECTS</span><strong>{portfolio.projects.length}</strong><small>{missing.length ? `${missing.length} 个必要媒体待补充` : "必要媒体完整"}</small></div>
        <div><span>LAST PUBLISHED</span><strong>{data.publishedAt ? formatDate(data.publishedAt) : "—"}</strong><small>公开快照</small></div>
      </section>
      {missing.length > 0 && <div className={styles.warning}><strong>发布前检查</strong><p>{missing.slice(0, 8).join("、")}</p></div>}
      <div className={styles.publishActions}><a href={`/?revision=${data.revision}`} target="_blank" rel="noreferrer">打开已发布前台 ↗</a><button type="button" disabled={busy || missing.length > 0} onClick={() => void publish()}>{busy ? "处理中…" : dirty ? "保存并发布 →" : "发布当前草稿 →"}</button></div>
    </>
  );
}

function RecordsPanel({ events, audits }: { events: EventItem[]; audits: AuditItem[] }) {
  return (
    <>
      <ViewHeader eyebrow="07 / RECORDS" title="访问与安全记录" detail="定位异常来源与播放请求；网络标识已做不可逆散列。" />
      <SectionTitle index="VISITS" title="最近访问" />
      <div className={styles.tableWrap}><table><thead><tr><th>时间</th><th>事件</th><th>作品</th><th>地区</th><th>设备</th><th>来源 / 网络</th><th>风险</th></tr></thead><tbody>{events.length ? events.map((event) => <tr key={event.id}><td>{formatDate(event.lastSeenAt ?? event.occurredAt)}</td><td>{eventLabel(event.eventType)}{event.mediaVersion ? ` · ${event.mediaVersion}` : ""}{event.eventCount > 1 ? ` ×${event.eventCount}` : ""}</td><td>{event.projectId ?? "—"}</td><td>{[event.country, event.region, event.city].filter(Boolean).join(" · ") || "未知"}</td><td>{[event.deviceType, event.browser, event.operatingSystem].filter(Boolean).join(" · ")}</td><td>{event.referrer ?? event.asOrganization ?? (event.networkHash ? `网络 ${event.networkHash.slice(0, 8)}` : "未知")}</td><td><span className={styles.risk} data-risk={event.riskLevel}>{event.action === "block" ? "已拦截" : event.riskLevel}</span>{event.riskReason && <small>{event.riskReason}</small>}</td></tr>) : <tr><td colSpan={7}>暂无访问记录。前台接入事件接口后会显示在这里。</td></tr>}</tbody></table></div>
      <SectionTitle index="AUDIT" title="管理操作" />
      <div className={styles.auditList}>{audits.length ? audits.map((item) => <div key={item.id}><span>{formatDate(item.occurredAt)}</span><strong>{auditLabel(item.action)}</strong><small>{item.actorEmail}</small></div>) : <p>暂无管理操作记录。</p>}</div>
    </>
  );
}

function ViewHeader({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) { return <header className={styles.viewHeader}><div><p>{eyebrow}</p><h1>{title}</h1><span>{detail}</span></div>{action}</header>; }
function SectionTitle({ index, title }: { index: string; title: string }) { return <div className={styles.sectionTitle}><span>{index}</span><h2>{title}</h2></div>; }
function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) { return <label className={wide ? styles.wideField : undefined}><span>{label}</span>{children}</label>; }
function Metric({ value, label }: { value: string | number; label: string }) { return <div className={styles.metric}><strong>{value}</strong><span>{label}</span></div>; }
function StatePanel({ label, title, detail, children }: { label: string; title: string; detail: string; children?: ReactNode }) { return <section className={styles.statePanel}><p>{label}</p><h1>{title}</h1><span>{detail}</span>{children}</section>; }

function OperationErrorDialog({ error, onClose }: { error: OperationError; onClose: () => void }) {
  return (
    <div className={styles.operationDialog} role="dialog" aria-modal="true" aria-labelledby="operation-error-title" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section>
        <span>OPERATION FAILED</span>
        <h2 id="operation-error-title">{error.title}</h2>
        <dl>
          <div><dt>失败原因</dt><dd>{error.reason}</dd></div>
          <div><dt>解决方法</dt><dd>{error.solution}</dd></div>
        </dl>
        <button type="button" autoFocus onClick={onClose}>返回继续处理</button>
      </section>
    </div>
  );
}

function createProject(categoryId: string, order: number): Project {
  return { id: `project-${createClientId()}`, order, categoryId, title: "未命名作品", year: String(new Date().getFullYear()), duration: "00:30", synopsis: "填写作品简介。", challenge: "", solution: "", cover: emptyMedia("image"), finalVideo: emptyMedia("video"), coverPresentation: createDefaultCoverPresentation(), detailBlocks: [] };
}
function emptyMedia(kind: "image" | "video" | "font"): MediaAsset { return { id: `media-${createClientId()}`, label: "", alt: "", kind, visualKey: "frame" }; }

function readVideoDuration(file: File): Promise<number | undefined> {
  if (typeof document === "undefined") return Promise.resolve(undefined);
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.preload = "metadata";
  video.muted = true;
  video.src = url;
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => finish(), 8000);
    const finish = (value?: number) => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(value && Number.isFinite(value) && value > 0 ? value : undefined);
    };
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish();
  });
}

async function readImageAspectRatio(file: File): Promise<number | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    const aspect = bitmap.width / bitmap.height;
    bitmap.close();
    return Number.isFinite(aspect) && aspect > 0 ? aspect : undefined;
  } catch {
    return undefined;
  }
}

function createBlock(type: ProjectBlock["type"]): ProjectBlock {
  const id = `block-${createClientId()}`;
  if (type === "text") return { id, type, eyebrow: "PROCESS", title: "新内容", body: "填写内容。" };
  if (type === "media-text") return { id, type, eyebrow: "PROCESS", title: "图文内容", body: "填写内容。", side: "left", media: emptyMedia("image") };
  if (type === "gallery") return { id, type, eyebrow: "GALLERY", title: "图片组", orientation: "portrait", items: [emptyMedia("image")] };
  return { id, type, caption: "图片说明", media: emptyMedia("image") };
}
function moveItem<T extends { id: string }>(items: T[], id: string, direction: -1 | 1) { const index = items.findIndex((item) => item.id === id); const target = index + direction; if (index < 0 || target < 0 || target >= items.length) return items; const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; return next; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, Math.round(value * 10) / 10)); }
function blockLabel(type: ProjectBlock["type"]) { return ({ text: "文字", "media-text": "图文混排", gallery: "图片组", "full-media": "通栏图片" } as const)[type]; }
function eventLabel(type: string) { return ({ page_view: "访问页面", project_open: "展开作品", play_request: "申请播放", play_error: "播放失败" } as Record<string, string>)[type] ?? type; }
function auditLabel(action: string) { return ({ "portfolio.draft.saved": "保存草稿", "portfolio.published": "发布作品集", "media.uploaded": "上传媒体" } as Record<string, string>)[action] ?? action; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "操作失败"; }
function isFailureMessage(message: string) { return /失败|不能|无法|无效|超过|不存在|请先|至少需要|暂时|中断|冲突|权限/u.test(message); }
function failureGuidance(message: string): OperationError {
  if (/超过|过大|90 MiB|10 MiB|8 MiB/u.test(message)) return { title: "文件没有上传", reason: message, solution: "压缩文件或重新选择更小的文件，再拖入上传框。" };
  if (/登录|身份|权限/u.test(message)) return { title: "当前操作没有完成", reason: message, solution: "重新登录后台，确认使用已授权邮箱后再试。" };
  if (/草稿已|冲突|修订/u.test(message)) return { title: "版本已经变化", reason: message, solution: "刷新后台读取最新草稿，再重新应用并保存本次修改。" };
  if (/格式|JPG|MP4|WOFF|字体|视频|图片/u.test(message)) return { title: "文件格式不符合要求", reason: message, solution: "按上传框标注的格式重新导出文件，然后再次拖入。" };
  return { title: "操作没有完成", reason: message, solution: "检查网络后重试；如果仍失败，返回对应编辑项并重新提交。" };
}
async function prepareUploadFile(file: File, kind: MediaAsset["kind"]) {
  if (kind !== "image" || file.type === "image/avif") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const maxSide = 2560;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
    if (!blob || blob.size >= file.size) return file;
    const basename = file.name.replace(/\.[^.]+$/u, "") || "image";
    return new File([blob], `${basename}.webp`, { type: "image/webp", lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
async function api<T>(input: string, init?: RequestInit): Promise<T> { const response = await fetch(input, { ...init, credentials: "same-origin", cache: "no-store" }); const body = await response.json().catch(() => ({})) as T & { error?: string; details?: string[] }; if (!response.ok) throw new Error(body.details?.[0] || body.error || `请求失败（${response.status}）`); return body; }
