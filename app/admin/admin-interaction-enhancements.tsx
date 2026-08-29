"use client";

import { useEffect } from "react";
import { PROGRAM_VERSION, UPGRADE_PROMPT } from "./admin-upgrade-content";

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

type SelectLike = Element & { value: string };

export function AdminInteractionEnhancements() {
  useEffect(() => {
    let lastUploadGroup: Element | null = null;
    let lastProblemTarget: Element | null = null;

    const rememberUploadTarget = (event: Event) => {
      const element = event.target instanceof Element ? event.target : null;
      const uploadLabel = element?.closest("label");
      if (!uploadLabel || !isUploadLabel(uploadLabel)) return;
      lastUploadGroup = uploadLabel.parentElement;
    };

    const handleModeChange = (event: Event) => {
      const select = event.target instanceof Element && event.target.tagName === "SELECT"
        ? event.target as unknown as SelectLike
        : null;
      if (!select) return;
      const field = select.closest("label");
      if (!field || !fieldText(field).includes("显示模式")) return;
      applyHeroMode(select, true);
    };

    const enhance = () => {
      ensureUpgradeCenter();

      document.querySelectorAll("select").forEach((node) => {
        if (!(node instanceof Element)) return;
        const select = node as unknown as SelectLike;
        const field = select.closest("label");
        if (field && fieldText(field).includes("显示模式")) applyHeroMode(select, false);
      });

      const dialog = Array.from(document.querySelectorAll("[role='dialog']"))
        .find((node) => node.textContent?.includes("OPERATION FAILED"));
      if (!dialog || getData(dialog, "autoLocated") === "true") return;
      setData(dialog, "autoLocated", "true");
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
      const button = event.target instanceof Element && event.target.tagName === "BUTTON" ? event.target : null;
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
    [data-program-upgrade-center] {
      margin-top: 22px;
      padding: 26px;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 18px;
      background: linear-gradient(135deg, rgba(255,255,255,.055), rgba(255,255,255,.018));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
    }
    [data-program-upgrade-center] .upgrade-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 22px;
    }
    [data-program-upgrade-center] .upgrade-kicker {
      margin: 0 0 7px;
      color: #8891a5;
      font: 600 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: .14em;
    }
    [data-program-upgrade-center] h2 {
      margin: 0;
      font-size: clamp(22px, 2vw, 32px);
      line-height: 1.08;
      letter-spacing: -.03em;
    }
    [data-program-upgrade-center] .upgrade-version {
      display: grid;
      gap: 4px;
      min-width: 132px;
      text-align: right;
    }
    [data-program-upgrade-center] .upgrade-version span {
      color: #8a93a6;
      font-size: 12px;
    }
    [data-program-upgrade-center] .upgrade-version strong {
      font-size: 24px;
      letter-spacing: -.03em;
    }
    [data-program-upgrade-center] .upgrade-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }
    [data-program-upgrade-center] .upgrade-grid > div {
      padding: 14px 16px;
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 12px;
      background: rgba(0,0,0,.16);
    }
    [data-program-upgrade-center] .upgrade-grid strong,
    [data-program-upgrade-center] .upgrade-grid small { display: block; }
    [data-program-upgrade-center] .upgrade-grid strong { margin-bottom: 4px; font-size: 14px; }
    [data-program-upgrade-center] .upgrade-grid small { color: #929aad; line-height: 1.45; }
    [data-program-upgrade-center] .upgrade-note {
      margin: 0 0 18px;
      color: #b7bdca;
      line-height: 1.7;
    }
    [data-program-upgrade-center] .upgrade-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    [data-program-upgrade-center] button,
    [data-program-upgrade-center] summary {
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 10px;
      background: rgba(255,255,255,.055);
      color: inherit;
      padding: 10px 14px;
      font: inherit;
      cursor: pointer;
    }
    [data-program-upgrade-center] button:hover,
    [data-program-upgrade-center] summary:hover { background: rgba(255,255,255,.09); }
    [data-program-upgrade-center] details { width: 100%; }
    [data-program-upgrade-center] details[open] summary { margin-bottom: 12px; }
    [data-program-upgrade-center] .upgrade-detail {
      padding: 14px 16px;
      border-radius: 12px;
      background: rgba(0,0,0,.18);
      color: #aab1c0;
      line-height: 1.65;
    }
    [data-program-upgrade-center] .upgrade-detail p { margin: 0 0 10px; }
    [data-program-upgrade-center] .upgrade-detail p:last-child { margin-bottom: 0; }
    @media (max-width: 760px) {
      [data-program-upgrade-center] { padding: 20px; }
      [data-program-upgrade-center] .upgrade-head { display: grid; }
      [data-program-upgrade-center] .upgrade-version { text-align: left; }
      [data-program-upgrade-center] .upgrade-grid { grid-template-columns: 1fr; }
    }
  `}</style>;
}

function ensureUpgradeCenter() {
  if (document.querySelector("[data-program-upgrade-center]")) return;
  const storagePanel = Array.from(document.querySelectorAll("section"))
    .find((section) => section.textContent?.includes("WEBSITE STORAGE") && section.textContent?.includes("网站空间"));
  const host = storagePanel?.parentElement;
  if (!host) return;

  const panel = document.createElement("section");
  panel.setAttribute("data-program-upgrade-center", "true");
  panel.innerHTML = `
    <div class="upgrade-head">
      <div>
        <p class="upgrade-kicker">PROGRAM / UPGRADE</p>
        <h2>程序升级中心</h2>
      </div>
      <div class="upgrade-version"><span>当前程序版本</span><strong>v${PROGRAM_VERSION}</strong></div>
    </div>
    <div class="upgrade-grid">
      <div><strong>升级机制已启用</strong><small>后续可以只升级程序，不重新部署整个网站。</small></div>
      <div><strong>D1 / KV 保留</strong><small>升级不得替换数据库、媒体空间和已有资源 ID。</small></div>
      <div><strong>内容与账号保留</strong><small>管理员、草稿、发布内容、图片、视频和二维码全部保留。</small></div>
    </div>
    <p class="upgrade-note">以后发布新版本时，把“升级指令”交给 GPT/Codex。升级流程必须先确认当前 Worker、DB 和 MEDIA_KV，再只更新程序代码与增量迁移。</p>
    <div class="upgrade-actions">
      <button type="button" data-upgrade-copy>复制给 GPT 的升级指令</button>
      <details>
        <summary>查看升级说明</summary>
        <div class="upgrade-detail">
          <p><strong>标准要求：</strong>最低使用 GPT-5.6 Sol，默认思考程度为“高”；遇到部署失败、资源绑定、数据库迁移或版本冲突时改为“超高”。</p>
          <p><strong>绝对禁止：</strong>升级时新建第二套 Worker、D1、KV 或 R2，使用付费套餐，或用模板仓库的资源 ID 覆盖当前站点。</p>
          <p><strong>升级完成后：</strong>验证账号与恢复、媒体、草稿与发布隔离、二维码、网站空间、并发播放和大陆网络访问。</p>
        </div>
      </details>
    </div>
  `;
  host.appendChild(panel);

  const copyButton = panel.querySelector("[data-upgrade-copy]");
  copyButton?.addEventListener("click", () => {
    const clipboard = (navigator as unknown as { clipboard?: { writeText?: (value: string) => Promise<void> } }).clipboard;
    if (!clipboard?.writeText) {
      copyButton.textContent = "浏览器不支持自动复制";
      return;
    }
    void clipboard.writeText(UPGRADE_PROMPT)
      .then(() => {
        copyButton.textContent = "已复制升级指令";
        window.setTimeout(() => { copyButton.textContent = "复制给 GPT 的升级指令"; }, 1800);
      })
      .catch(() => { copyButton.textContent = "复制失败，请重试"; });
  });
}

function applyHeroMode(select: SelectLike, shouldScroll: boolean) {
  const slideCard = select.closest("article");
  if (!slideCard) return;
  const uploadLabel = Array.from(slideCard.querySelectorAll("label"))
    .find((label) => fieldText(label).includes("首图图片"));
  const uploadGroup = uploadLabel?.parentElement;
  if (uploadGroup) setData(uploadGroup, "adminHeroMediaCollapsed", select.value === "image-only" ? "false" : "true");
  if (!shouldScroll || select.value === "image-only") return;
  window.requestAnimationFrame(() => {
    const hint = Array.from(slideCard.querySelectorAll("p, small"))
      .find((node) => node.textContent?.includes("拖动文字改变位置"));
    revealTarget(hint?.parentElement ?? select, true);
  });
}

function locateValidationProblem(reason: string): Element | null {
  const view = validationView(reason);
  if (view) {
    const navButton = Array.from(document.querySelectorAll("nav button"))
      .find((button) => button.textContent?.includes(view));
    clickElement(navButton);
  }

  const projectIndexMatch = reason.match(/projects\[(\d+)\]/u);
  if (projectIndexMatch) {
    const index = Number(projectIndexMatch[1]);
    window.requestAnimationFrame(() => {
      const contentButtons = Array.from(document.querySelectorAll("button"))
        .filter((button) => /^\d{2}/u.test(button.textContent?.trim() ?? "") && button.querySelector("strong"));
      clickElement(contentButtons[index]);
    });
  }

  let fieldLabel = "";
  for (const [pattern, label] of fieldLabels) {
    if (pattern.test(reason)) {
      fieldLabel = label;
      break;
    }
  }
  if (!fieldLabel) return document.querySelector("section");

  const findField = () => Array.from(document.querySelectorAll("label"))
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

function revealTarget(target: Element, focus = false) {
  document.querySelectorAll("[data-admin-problem='true']").forEach((node) => node.removeAttribute("data-admin-problem"));
  target.setAttribute("data-admin-problem", "true");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  if (!focus) return;
  const control = target.matches("input, textarea, select, button")
    ? target
    : target.querySelector("input, textarea, select, button");
  focusElement(control);
}

function clickElement(element: Element | undefined) {
  if (!element) return;
  const clickable = element as unknown as { click?: () => void };
  clickable.click?.();
}

function focusElement(element: Element | null) {
  if (!element) return;
  const focusable = element as unknown as { focus?: (options?: { preventScroll?: boolean }) => void };
  focusable.focus?.({ preventScroll: true });
}

function getData(element: Element, key: string) {
  return element.getAttribute(`data-${camelToKebab(key)}`);
}

function setData(element: Element, key: string, value: string) {
  element.setAttribute(`data-${camelToKebab(key)}`, value);
}

function camelToKebab(value: string) {
  return value.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function isUploadLabel(label: Element) {
  return Boolean(label.querySelector("input[type='file']"));
}

function fieldText(label: Element) {
  return label.textContent?.replace(/\s+/gu, " ").trim() ?? "";
}
