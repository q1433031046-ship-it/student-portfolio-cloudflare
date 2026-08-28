"use client";

import { useEffect } from "react";

const fieldLabels: Array<[RegExp, string]> = [
  [/hero\.name/u, "姓名"],
  [/hero\.role/u, "职业标题"],
  [/hero\.targetRole/u, "求职方向"],
  [/hero\.email/u, "联系邮箱"],
  [/hero\.phone/u, "电话号码"],
  [/hero\.statement/u, "个人定位"],
  [/settings\.siteTitle/u, "浏览器标签与站点名称"],
  [/settings\.contact\.title/u, "主标题"],
  [/settings\.contact\.note/u, "说明"],
  [/\.year/u, "年份"],
  [/\.synopsis/u, "作品简介"],
  [/\.challenge/u, "项目难点"],
  [/\.solution/u, "解决思路"],
];

export function AdminInteractionEnhancements() {
  useEffect(() => {
    let lastUploadGroup: HTMLElement | null = null;
    let lastProblemTarget: HTMLElement | null = null;

    const rememberUploadTarget = (event: Event) => {
      const element = event.target instanceof Element ? event.target : null;
      const uploadLabel = element?.closest("label");
      if (!uploadLabel || !isUploadLabel(uploadLabel)) return;
      lastUploadGroup = uploadLabel.parentElement;
    };

    const handleModeChange = (event: Event) => {
      const select = event.target instanceof HTMLSelectElement ? event.target : null;
      if (!select) return;
      const field = select.closest("label");
      if (!field || !fieldText(field).includes("显示模式")) return;
      applyHeroMode(select, true);
    };

    const enhance = () => {
      document.querySelectorAll<HTMLSelectElement>("select").forEach((select) => {
        const field = select.closest("label");
        if (field && fieldText(field).includes("显示模式")) applyHeroMode(select, false);
      });

      const dialog = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"))
        .find((node) => node.textContent?.includes("OPERATION FAILED"));
      if (!dialog || dialog.dataset.autoLocated === "true") return;
      dialog.dataset.autoLocated = "true";
      const reason = dialog.textContent ?? "";
      const uploadFailure = /上传|文件|MP4|JPG|PNG|WebP|AVIF|WOFF|TTF|OTF|50 MB|8 MiB|10 MiB/u.test(reason);
      if (uploadFailure && lastUploadGroup?.isConnected) {
        lastProblemTarget = lastUploadGroup;
        revealTarget(lastUploadGroup);
        return;
      }
      const target = locateValidationProblem(reason);
      if (target) {
        lastProblemTarget = target;
        revealTarget(target);
      }
    };

    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("pointerdown", rememberUploadTarget, true);
    document.addEventListener("drop", rememberUploadTarget, true);
    document.addEventListener("change", rememberUploadTarget, true);
    document.addEventListener("change", handleModeChange, true);

    const focusAfterDialog = (event: Event) => {
      const button = event.target instanceof HTMLButtonElement ? event.target : null;
      if (!button || button.textContent?.trim() !== "返回继续处理" || !lastProblemTarget) return;
      const target = lastProblemTarget;
      window.setTimeout(() => revealTarget(target, true), 30);
    };
    document.addEventListener("click", focusAfterDialog, true);

    enhance();
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", rememberUploadTarget, true);
      document.removeEventListener("drop", rememberUploadTarget, true);
      document.removeEventListener("change", rememberUploadTarget, true);
      document.removeEventListener("change", handleModeChange, true);
      document.removeEventListener("click", focusAfterDialog, true);
    };
  }, []);

  return <style>{`
    [data-admin-hero-media-collapsed="true"] {
      max-height: 88px;
      overflow: hidden;
      opacity: .78;
      transition: max-height 180ms ease, opacity 180ms ease;
    }
    [data-admin-hero-media-collapsed="true"] > :not(:first-child) { display: none !important; }
    [data-admin-problem="true"] {
      outline: 2px solid #d64b40 !important;
      outline-offset: 5px;
      border-radius: 8px;
    }
  `}</style>;
}

function applyHeroMode(select: HTMLSelectElement, shouldScroll: boolean) {
  const slideCard = select.closest<HTMLElement>("article");
  if (!slideCard) return;
  const uploadLabel = Array.from(slideCard.querySelectorAll<HTMLLabelElement>("label"))
    .find((label) => fieldText(label).includes("首图图片"));
  const uploadGroup = uploadLabel?.parentElement;
  if (uploadGroup) uploadGroup.dataset.adminHeroMediaCollapsed = select.value === "image-only" ? "false" : "true";
  if (!shouldScroll || select.value === "image-only") return;
  window.requestAnimationFrame(() => {
    const hint = Array.from(slideCard.querySelectorAll<HTMLElement>("p, small"))
      .find((node) => node.textContent?.includes("拖动文字改变位置"));
    revealTarget(hint?.parentElement ?? select, true);
  });
}

function locateValidationProblem(reason: string): HTMLElement | null {
  const view = validationView(reason);
  if (view) {
    const navButton = Array.from(document.querySelectorAll<HTMLButtonElement>("nav button"))
      .find((button) => button.textContent?.includes(view));
    navButton?.click();
  }

  const projectIndexMatch = reason.match(/projects\[(\d+)\]/u);
  if (projectIndexMatch) {
    const index = Number(projectIndexMatch[1]);
    window.requestAnimationFrame(() => {
      const contentButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .filter((button) => /^\d{2}/u.test(button.textContent?.trim() ?? "") && button.querySelector("strong"));
      contentButtons[index]?.click();
    });
  }

  let fieldLabel = "";
  for (const [pattern, label] of fieldLabels) {
    if (pattern.test(reason)) {
      fieldLabel = label;
      break;
    }
  }
  if (!fieldLabel) return document.querySelector<HTMLElement>("section");

  const findField = () => Array.from(document.querySelectorAll<HTMLLabelElement>("label"))
    .find((label) => fieldText(label).includes(fieldLabel));
  const immediate = findField();
  if (immediate) return immediate;

  window.setTimeout(() => {
    const delayed = findField();
    if (delayed) revealTarget(delayed, true);
  }, 40);
  return null;
}

function validationView(reason: string) {
  if (/settings\.contact/u.test(reason)) return "联系";
  if (/hero\.(?:email|phone)/u.test(reason)) return "联系";
  if (/hero\./u.test(reason)) return "首图与文字";
  if (/categories\[/u.test(reason)) return "作品分类";
  if (/projects\[/u.test(reason)) return "作品";
  if (/settings\.siteTitle/u.test(reason)) return "概览";
  return "";
}

function revealTarget(target: HTMLElement, focus = false) {
  document.querySelectorAll<HTMLElement>("[data-admin-problem='true']").forEach((node) => delete node.dataset.adminProblem);
  target.dataset.adminProblem = "true";
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  if (!focus) return;
  const control = target.matches("input, textarea, select, button")
    ? target
    : target.querySelector<HTMLElement>("input, textarea, select, button");
  control?.focus({ preventScroll: true });
}

function isUploadLabel(label: Element) {
  return Boolean(label.querySelector("input[type='file']"));
}

function fieldText(label: Element) {
  return label.textContent?.replace(/\s+/gu, " ").trim() ?? "";
}
