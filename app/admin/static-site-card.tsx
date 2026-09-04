"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { qrSvg } from "../lib/qr-code";
import styles from "./admin.module.css";

type StaticSiteState = {
  configured: boolean;
  status: string;
  productionUrl: string | null;
  publicRevision: number;
  activeJob: { id: string; status: string; phase: string; previewUrl?: string | null } | null;
  retryableJob: { id: string; status: string; phase: string } | null;
  lastSuccessAt: string | null;
  lastError: { code: string; summary: string | null } | null;
  mediaTotalBytes: number;
  qrAvailable: boolean;
};

const PROMOTION_READY_STATUS = "ARTIFACT_VERIFIED";

export function StaticSiteCard({ revision, disabled, publish }: { revision: number; disabled: boolean; publish: () => Promise<void> }) {
  const [state, setState] = useState<StaticSiteState | null>(null);
  const [loading, setLoading] = useState(true);
  const [operationMessage, setOperationMessage] = useState("");
  const loadState = useCallback(async () => {
    const response = await fetch("/api/admin/static-site", { credentials: "same-origin", cache: "no-store" });
    const body = await response.json() as StaticSiteState;
    if (!response.ok) throw new Error("静态网站状态读取失败");
    setState(body);
  }, []);
  useEffect(() => {
    let active = true;
    const initial = window.setTimeout(() => void loadState()
      .catch(() => { if (active) setOperationMessage("静态网站状态读取失败"); })
      .finally(() => { if (active) setLoading(false); }), 0);
    const interval = window.setInterval(() => { if (active) void loadState().catch(() => undefined); }, 15_000);
    return () => { active = false; window.clearTimeout(initial); window.clearInterval(interval); };
  }, [loadState]);
  const size = useMemo(() => formatBytes(state?.mediaTotalBytes ?? 0), [state?.mediaTotalBytes]);
  const qrMarkup = state?.qrAvailable && state.productionUrl ? qrSvg(state.productionUrl, { title: "静态作品网站" }) : null;

  function downloadQr() {
    if (!state?.qrAvailable || !state.productionUrl) return;
    const url = URL.createObjectURL(new Blob([qrSvg(state.productionUrl, { title: "静态作品网站" })], { type: "image/svg+xml" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "静态作品网站-二维码.svg"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function submit(action: Record<string, unknown>) {
    setOperationMessage("正在核对静态发布状态…");
    try {
      const response = await fetch("/api/admin/static-site", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const body = await response.json() as { error?: string; waiting?: boolean };
      if (!response.ok) throw new Error(body.error ?? "静态发布操作失败");
      setOperationMessage(body.waiting ? "远端仍在处理，上一正式网站保持不变。" : "核验已完成。");
      await loadState();
    } catch (error) { setOperationMessage(error instanceof Error ? error.message : "静态发布操作失败"); }
  }

  async function startPublish() {
    setOperationMessage("正在冻结本次静态候选…");
    await publish();
    await loadState().catch(() => undefined);
  }

  return <section className={styles.staticSiteCard} aria-labelledby="static-site-card-title">
    <header><div><span>NETLIFY STATIC SITE</span><h2 id="static-site-card-title">固定静态作品网站</h2></div><strong data-status={state?.status ?? "loading"}>{loading ? "读取中" : statusLabel(state?.status)}</strong></header>
    <p>保存草稿不会产生 Deploy；只有明确发布才会生成一个 draft Deploy。系统验证后提升同一个 Deploy，固定链接和二维码不会因重新发布改变。</p>
    <dl>
      <div><dt>当前草稿</dt><dd>r{revision}</dd></div><div><dt>静态公开序号</dt><dd>{state?.publicRevision ?? 0}</dd></div>
      <div><dt>媒体总量</dt><dd>{size}</dd></div><div><dt>发布状态</dt><dd>{state?.activeJob ? `${state.activeJob.status} · ${state.activeJob.phase}` : statusLabel(state?.status)}</dd></div>
    </dl>
    {!state?.configured && !loading && <aside className={styles.warning}><strong>尚未绑定 Netlify Site</strong><p>Site 创建和账号确认由发布角色人工完成；这里不会自动创建 Site。</p></aside>}
    {state?.lastError && <aside className={styles.warning}><strong>{state.lastError.code}</strong><p>{state.lastError.summary ?? "操作未完成，上一正式版本保持不变。"}</p></aside>}
    {operationMessage && <p role="status" aria-live="polite">{operationMessage}</p>}
    <p><strong>发布前请先检查 Netlify 用量。</strong>免费额度并非无限，本页面不伪造实时剩余额度。</p>
    {qrMarkup && <div className={styles.staticSiteQr} data-static-site-qr aria-label="固定静态网站二维码"
      dangerouslySetInnerHTML={{ __html: qrMarkup }} />}
    <div className={styles.publishActions}>
      <button type="button" disabled={disabled || !state?.configured || Boolean(state?.activeJob) || Boolean(state?.retryableJob)
        || state?.status === "reauthorization_required" || state?.status === "reverification_required"
        || state?.status === "rollback_in_progress"} onClick={() => void startPublish()}>发布静态网站 →</button>
      {state?.activeJob && <button type="button" onClick={() => void submit({ action: "verify" })}>重新核验</button>}
      {state?.activeJob?.status === PROMOTION_READY_STATUS && <>
        {state.activeJob.previewUrl && <a href={state.activeJob.previewUrl} target="_blank" rel="noreferrer">查看已核验草稿 ↗</a>}
        <button type="button" onClick={() => void submit({ action: "promote", jobId: state.activeJob!.id })}>明确发布到固定网址 →</button>
      </>}
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
function formatBytes(value: number) { return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MiB` : `${Math.round(value / 1024)} KiB`; }
