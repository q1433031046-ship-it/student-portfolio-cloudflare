"use client";

import { useState } from "react";
import styles from "./access-page.module.css";

export function AccessPageActions() {
  const [label, setLabel] = useState("复制当前访问链接");
  const [fallbackUrl, setFallbackUrl] = useState("");

  async function copyLink() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      await navigator.clipboard.writeText(url.toString());
      setFallbackUrl("");
      setLabel("访问链接已复制");
      window.setTimeout(() => setLabel("复制当前访问链接"), 1800);
    } catch {
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      setFallbackUrl(url.toString());
      setLabel("复制失败，请使用下方链接");
    }
  }

  return <>
    <button className={styles.secondary} type="button" onClick={() => void copyLink()}>{label}</button>
    {fallbackUrl && <label className={styles.copyFallback}>
      <span>手动复制访问链接</span>
      <input value={fallbackUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
    </label>}
  </>;
}
