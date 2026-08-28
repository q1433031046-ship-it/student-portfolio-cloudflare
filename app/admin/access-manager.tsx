"use client";

import { useMemo, useState } from "react";
import { createQrMatrix, qrSvg } from "../lib/qr-code";
import styles from "./admin.module.css";

export type AdminAccessPass = {
  id: string;
  label: string;
  enabled: boolean;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  createdBy: string;
  status: "active" | "paused" | "expired" | "exhausted";
  accessUrl: string;
};

export type AccessPayload = {
  restrictionEnabled: boolean;
  updatedAt: string | null;
  passes: AdminAccessPass[];
};

export function AccessManager({ access, onChange, setMessage }: { access: AccessPayload; onChange: (next: AccessPayload) => void; setMessage: (message: string) => void }) {
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const usableCount = access.passes.filter((pass) => pass.status === "active").length;

  async function updatePolicy() {
    if (!access.restrictionEnabled && usableCount === 0) {
      setMessage("请先创建至少一张当前可用的二维码，再开启限制访问");
      return;
    }
    await mutate({ method: "PATCH", body: { restrictionEnabled: !access.restrictionEnabled } }, !access.restrictionEnabled ? "二维码限制访问已开启" : "二维码限制访问已关闭");
  }

  async function createPass() {
    await mutate({
      method: "POST",
      body: {
        label: label.trim() || `访问码 ${String(access.passes.length + 1).padStart(2, "0")}`,
        maxUses: maxUses ? Number(maxUses) : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      },
    }, "二维码已创建");
    setLabel("");
    setMaxUses("");
    setExpiresAt("");
  }

  async function mutate(input: { method: "POST" | "PATCH" | "DELETE"; body?: unknown; id?: string }, success: string) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/access${input.id ? `?id=${encodeURIComponent(input.id)}` : ""}`, {
        method: input.method,
        credentials: "same-origin",
        headers: input.body ? { "Content-Type": "application/json" } : undefined,
        body: input.body ? JSON.stringify(input.body) : undefined,
      });
      const body = await response.json() as AccessPayload & { error?: string };
      if (!response.ok) throw new Error(body.error || "二维码设置更新失败");
      onChange(body);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "二维码设置更新失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.accessManager} aria-labelledby="access-manager-title">
      <div className={styles.accessHeading}>
        <div>
          <span>QR ACCESS</span>
          <h2 id="access-manager-title">二维码访问接口</h2>
          <p>二维码可以单独使用；只有开启限制后，普通链接才会被拦截。</p>
        </div>
        <button className={styles.policySwitch} type="button" role="switch" aria-checked={access.restrictionEnabled} data-on={access.restrictionEnabled} disabled={busy} onClick={() => void updatePolicy()}>
          <i aria-hidden="true" />
          <span>{access.restrictionEnabled ? "限制访问已开启" : "公开访问"}</span>
        </button>
      </div>

      <div className={styles.accessFlow}>
        <span><b>普通链接</b>{access.restrictionEnabled ? "需要有效访问会话" : "直接打开"}</span>
        <i aria-hidden="true">＋</i>
        <span><b>二维码</b>每张都是独立密钥</span>
        <i aria-hidden="true">＋</i>
        <span><b>后台</b>管理员始终可进入</span>
      </div>

      <div className={styles.accessCreate}>
        <label><span>二维码名称</span><input maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={`访问码 ${String(access.passes.length + 1).padStart(2, "0")}`} /></label>
        <label><span>最多使用次数</span><input type="number" min="1" max="1000000" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} placeholder="不限" /></label>
        <label><span>过期时间</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        <button type="button" disabled={busy} onClick={() => void createPass()}>生成二维码密钥</button>
      </div>

      {access.passes.length === 0 ? (
        <div className={styles.accessEmpty}><span>NO ACCESS KEYS</span><strong>还没有二维码</strong><p>先创建一张，再决定是否开启限制访问。</p></div>
      ) : (
        <div className={styles.accessPassList}>
          {access.passes.map((pass) => (
            <AccessPassCard
              key={pass.id}
              pass={pass}
              busy={busy}
              onSave={(body) => mutate({ method: "PATCH", body: { id: pass.id, ...body } }, `“${body.label}”已更新`)}
              onToggle={() => mutate({ method: "PATCH", body: { id: pass.id, enabled: !pass.enabled } }, pass.enabled ? "二维码已停用" : "二维码已启用")}
              onDelete={() => mutate({ method: "DELETE", id: pass.id }, "二维码已删除")}
              setMessage={setMessage}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AccessPassCard({ pass, busy, onSave, onToggle, onDelete, setMessage }: { pass: AdminAccessPass; busy: boolean; onSave: (body: { label: string; maxUses: number | null; expiresAt: string | null }) => Promise<void>; onToggle: () => Promise<void>; onDelete: () => Promise<void>; setMessage: (message: string) => void }) {
  const [label, setLabel] = useState(pass.label);
  const [maxUses, setMaxUses] = useState(pass.maxUses === null ? "" : String(pass.maxUses));
  const [expiresAt, setExpiresAt] = useState(toLocalDateTime(pass.expiresAt));
  const matrix = useMemo(() => createQrMatrix(pass.accessUrl), [pass.accessUrl]);
  const changed = label.trim() !== pass.label || (maxUses ? Number(maxUses) : null) !== pass.maxUses || (expiresAt ? new Date(expiresAt).toISOString() : null) !== pass.expiresAt;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pass.accessUrl);
      setMessage(`“${pass.label}”访问链接已复制`);
    } catch {
      setMessage("复制失败，请使用下载二维码");
    }
  }

  function downloadQr() {
    const blob = new Blob([qrSvg(pass.accessUrl, { title: pass.label })], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFilename(pass.label)}-二维码.svg`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(`“${pass.label}”二维码已下载`);
  }

  return (
    <article className={styles.accessPassCard} data-status={pass.status}>
      <div className={styles.accessQr} aria-label={`${pass.label}二维码`}>
        <svg viewBox="0 0 65 65" role="img" aria-label={`${pass.label}访问二维码`} shapeRendering="crispEdges">
          <rect width="65" height="65" fill="#fff" />
          {matrix.map((row, y) => row.map((dark, x) => dark ? <rect key={`${x}-${y}`} x={x + 4} y={y + 4} width="1" height="1" fill="#111216" /> : null))}
        </svg>
      </div>
      <div className={styles.accessPassBody}>
        <header><span data-status={pass.status}>{statusLabel(pass.status)}</span><small>{pass.usedCount}{pass.maxUses === null ? " 次使用" : ` / ${pass.maxUses} 次`}</small></header>
        <div className={styles.accessPassFields}>
          <label><span>名称</span><input maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
          <label><span>次数上限</span><input type="number" min="1" max="1000000" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} placeholder="不限" /></label>
          <label><span>过期时间</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        </div>
        <p>最近使用：{pass.lastUsedAt ? formatDate(pass.lastUsedAt) : "尚未使用"} · 创建：{formatDate(pass.createdAt)}</p>
        <div className={styles.accessPassActions}>
          <button type="button" disabled={busy} onClick={() => void copyLink()}>复制链接</button>
          <button type="button" disabled={busy} onClick={downloadQr}>下载二维码</button>
          <button type="button" disabled={busy || !changed} onClick={() => void onSave({ label: label.trim(), maxUses: maxUses ? Number(maxUses) : null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null })}>确认修改</button>
          <button type="button" disabled={busy} onClick={() => void onToggle()}>{pass.enabled ? "停用" : "启用"}</button>
          <button type="button" disabled={busy} onClick={() => { if (window.confirm(`确认删除“${pass.label}”？已授权的浏览器也会立即失效。`)) void onDelete(); }}>删除</button>
        </div>
      </div>
    </article>
  );
}

function statusLabel(status: AdminAccessPass["status"]) {
  return status === "active" ? "可用" : status === "paused" ? "已停用" : status === "expired" ? "已过期" : "次数已用完";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/gu, "-").trim() || "访问码";
}
