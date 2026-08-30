"use client";

import { useState } from "react";
import styles from "./access-page.module.css";

export function AccessPageActions() {
  const [label, setLabel] = useState("复制当前访问链接");

  async function copyLink() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      await navigator.clipboard.writeText(url.toString());
      setLabel("访问链接已复制");
      window.setTimeout(() => setLabel("复制当前访问链接"), 1800);
    } catch {
      setLabel("复制失败，请使用地址栏复制");
    }
  }

  return <button className={styles.secondary} type="button" onClick={() => void copyLink()}>{label}</button>;
}
