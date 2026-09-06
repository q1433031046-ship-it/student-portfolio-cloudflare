"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { qrSvg } from "../lib/qr-code";
import styles from "./admin.module.css";
import { fetchAdmin } from "./admin-fetch";

type StaticSiteState = {
  configured: boolean;
  status: string;
  productionUrl: string | null;
  publicRevision: number;
  activeJob: { id: string; status: string; phase: string; previewUrl?: string | null } | null;
  retryableJob: { id: string; status: string; phase: string; previewUrl?: string | null } | null;
  lastSuccessAt: string | null;
  lastError: { code: string; summary: string | null } | null;
  mediaTotalBytes: number;
  qrAvailable: boolean;
};

const AUTO_VERIFY_STATUSES = new Set(["FROZEN", "BUILD_TRIGGERED", "DRAFT_DEPLOY_LOCATED", "DRAFT_DEPLOY_READY"]);
const PROMOTION_STATUSES = new Set(["ARTIFACT_VERIFIED", "PUBLISH_REQUESTED", "PRODUCTION_READBACK_VERIFIED"]);
const PROMOTION_RESUME_STATUSES = new Set(["PUBLISH_REQUESTED", "PRODUCTION_READBACK_VERIFIED"]);

export function StaticSiteCard({ revision, disabled, publish }: { revision: number; disabled: boolean; publish: () => Promise<void> }) {
  const [state, setState] = useState<StaticSiteState | null>(null);
  const [loading, setLoading] = useState(true);
  const [operationMessage, setOperationMessage] = useState("");
  const operationInFlightRef = useRef(false);
  const promotionRequestedRef = useRef(false);
  const loadState = useCallback(async (): Promise<StaticSiteState> => {
    const response = await fetchAdmin("/api/admin/static-site");
    const body = await response.json() as StaticSiteState;
    if (!response.ok) throw new Error("静态网站状态读取失败");
    setState(body);
    return body;
  }, []);

  const submit = useCallback(async (action: Record<string, unknown>) => {
    if (operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    const isPromotion = action.action === "promote";
    if (isPromotion) promotionRequestedRef.current = true;
    setOperationMessage(action.action === "retry" ? "正在恢复原静态发布任务…"
      : isPromotion ? "正在发布到静态网站固定网址…" : "正在自动核验静态制品…");
    try {
      const response = await fetchAdmin("/api/admin/static-site", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) }, 150_000);
      const body = await response.json() as { error?: string; waiting?: boolean };
      if (!response.ok) throw new Error(body.error ?? "静态发布操作失败");
      if (isPromotion) {
        if (body.waiting) setOperationMessage("正式发布已请求，正在核验固定网址当前版本。");
        else { promotionRequestedRef.current = false; setOperationMessage("静态网站已发布到固定网址。动态前台仍可单独发布。 "); }
      } else if (action.action === "retry") {
        setOperationMessage("已恢复原静态任务，正在自动核验…");
      } else if (body.waiting) {
        setOperationMessage("当前步骤已受理，系统会继续核验原任务。");
      } else {
        setOperationMessage("静态制品已核验，可以先打开预览测试。");
      }
      await loadState();
    } catch (error) {
      if (isPromotion) promotionRequestedRef.current = false;
      setOperationMessage(error instanceof Error ? error.message : "静态发布操作失败");
    } finally {
      operationInFlightRef.current = false;
    }
  }, [loadState]);

  const autoAdvance = useCallback(async (next: StaticSiteState | null) => {
    const activeJob = next?.activeJob;
    if (!activeJob || operationInFlightRef.current || next?.lastError) return;
    if (AUTO_VERIFY_STATUSES.has(activeJob.status)) {
      await submit({ action: "verify", jobId: activeJob.id });
    } else if ((promotionRequestedRef.current && PROMOTION_STATUSES.has(activeJob.status))
      || PROMOTION_RESUME_STATUSES.has(activeJob.status)) {
      await submit({ action: "promote", jobId: activeJob.id });
    }
  }, [submit]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await loadState();
        if (active) await autoAdvance(next);
      } catch { if (active) setOperationMessage("静态网站状态读取失败"); }
    };
    const initial = window.setTimeout(() => void refresh().finally(() => { if (active) setLoading(false); }), 0);
    const interval = window.setInterval(() => { if (active) void refresh(); }, 15_000);
    return () => { active = false; window.clearTimeout(initial); window.clearInterval(interval); };
  }, [autoAdvance, loadState]);
  const size = useMemo(() => formatBytes(state?.mediaTotalBytes ?? 0), [state?.mediaTotalBytes]);
  const qrMarkup = state?.qrAvailable && state.productionUrl ? qrSvg(state.productionUrl, { title: "静态作品网站" }) : null;

  function downloadQr() {
    if (!state?.qrAvailable || !state.productionUrl) return;
    const url = URL.createObjectURL(new Blob([qrSvg(state.productionUrl, { title: "静态作品网站" })], { type: "image/svg+xml" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "静态作品网站-二维码.svg"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function startPublish() {
    setOperationMessage("正在冻结本次静态候选…");
    await publish();
    try {
      const next = await loadState();
      await autoAdvance(next);
    } catch { /* the next polling cycle will retry the read */ }
  }

  return <section className={styles.staticSiteCard} aria-labelledby="static-site-card-title">
    <header><div><span>CLOUDFLARE PAGES</span><h2 id="static-site-card-title">固定静态作品网站</h2></div><strong data-status={state?.status ?? "loading"}>{loading ? "读取中" : statusLabel(state?.status)}</strong></header>
    <p>点击“生成静态预览”会冻结当前内容并生成预览。检查预览后，再点击“发布到固定网址”更新正式静态网站。保存草稿和动态发布均可独立使用。</p>
    <dl>
      <div><dt>当前草稿</dt><dd>r{revision}</dd></div><div><dt>静态公开序号</dt><dd>{state?.publicRevision ?? 0}</dd></div>
      <div><dt>媒体总量</dt><dd>{size}</dd></div><div><dt>发布状态</dt><dd>{state?.activeJob ? jobStatusLabel(state.activeJob.status) : statusLabel(state?.status)}</dd></div>
    </dl>
    {!state?.configured && !loading && <aside className={styles.warning}><strong>尚未配置 Cloudflare Pages</strong><p>请由发布角色完成既有 Pages 项目的配置与授权。</p></aside>}
    {state?.lastError && <aside className={styles.warning}><strong>{state.lastError.code}</strong><p>{state.lastError.summary ?? "操作未完成，请核验原任务状态。"}</p></aside>}
    {state?.activeJob?.status === "ARTIFACT_VERIFIED" && <aside className={styles.readyNotice}>
      <strong>静态预览已核验，可以测试</strong>
      <p>正式发布使用与此预览相同的冻结文件。测试通过后再点“发布到固定网址”；之后的草稿修改留给下一次预览。</p>
      {state.activeJob.previewUrl && <a href={state.activeJob.previewUrl} target="_blank" rel="noreferrer">打开已核验静态预览 ↗</a>}
    </aside>}
    {operationMessage && <p role="status" aria-live="polite">{operationMessage}</p>}
    <p>静态网站单个文件最大 25 MiB，较大的媒体仍可用于动态网站。</p>
    {qrMarkup && <div className={styles.staticSiteQr} data-static-site-qr aria-label="固定静态网站二维码"
      dangerouslySetInnerHTML={{ __html: qrMarkup }} />}
    <div className={styles.publishActions}>
      <button type="button" disabled={disabled || !state?.configured || Boolean(state?.activeJob) || Boolean(state?.retryableJob)
        || state?.status === "reauthorization_required" || state?.status === "reverification_required"
        || state?.status === "rollback_in_progress"} onClick={() => void startPublish()}>生成静态预览 →</button>
      {state?.activeJob && AUTO_VERIFY_STATUSES.has(state.activeJob.status) && <button type="button" onClick={() => void submit({ action: "verify", jobId: state.activeJob!.id })}>重新核验</button>}
      {state?.activeJob && PROMOTION_STATUSES.has(state.activeJob.status) && <button type="button" onClick={() => void submit({ action: "promote", jobId: state.activeJob!.id })}>{state.activeJob.status === "ARTIFACT_VERIFIED" ? "发布到固定网址 →" : "核验正式发布状态"}</button>}
      {state?.retryableJob && <button type="button" onClick={() => void submit({ action: "retry", jobId: state.retryableJob!.id })}>重试原发布任务</button>}
      {state?.qrAvailable && state.productionUrl && <>
        <a href={state.productionUrl} target="_blank" rel="noreferrer">查看静态网站 ↗</a>
        <button type="button" onClick={() => void navigator.clipboard.writeText(state.productionUrl!)}>复制固定链接</button>
        <button type="button" onClick={downloadQr}>下载二维码</button>
      </>}
    </div>
  </section>;
}

function statusLabel(status?: string) {
  return ({ unconfigured: "未配置", configured: "已配置", publishing: "发布中", published: "已发布", failed: "需要处理",
    reauthorization_required: "需要重新授权", reverification_required: "需要重新核验", rollback_in_progress: "回滚中" } as Record<string, string>)[status ?? ""] ?? "等待发布";
}
function jobStatusLabel(status: string) {
  return ({ FROZEN: "核验冻结文件", BUILD_TRIGGERED: "上传静态文件", DRAFT_DEPLOY_LOCATED: "核验预览创建结果",
    DRAFT_DEPLOY_READY: "核验预览内容", ARTIFACT_VERIFIED: "静态预览已就绪", PUBLISH_REQUESTED: "核验正式发布结果",
    PRODUCTION_READBACK_VERIFIED: "核验正式网站内容", FAILED_RETRYABLE: "需要重试", PUBLISHED: "已发布" } as Record<string,string>)[status] ?? "等待核验";
}
function formatBytes(value: number) { return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MiB` : `${Math.round(value / 1024)} KiB`; }
