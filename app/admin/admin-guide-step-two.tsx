"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function AdminGuideStepTwo() {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const locate = () => {
      const section = document.getElementById("admin-guide-gpt");
      if (!section) {
        setHost(null);
        return;
      }
      let mount = section.querySelector<HTMLElement>("[data-admin-gpt-step-host]");
      if (!mount) {
        mount = document.createElement("div");
        mount.setAttribute("data-admin-gpt-step-host", "");
        const prompt = section.querySelector(".prompt");
        section.insertBefore(mount, prompt ?? null);
      }
      setHost((current) => current === mount ? current : mount);
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!host) return null;

  return createPortal(
    <div data-admin-gpt-step-detail>
      <style>{`
        [data-admin-gpt-step-detail]{margin:24px 0}
        [data-admin-gpt-step-detail] h3{margin:0 0 14px;font-size:20px;letter-spacing:-.03em}
        [data-admin-gpt-step-detail] .warning{margin-top:12px;padding:16px 18px;border:1px solid #ead1ab;border-radius:10px;background:#fffaf1}
        [data-admin-gpt-step-detail] .warning strong{display:block;margin-bottom:5px}
        [data-admin-gpt-step-detail] .warning p{margin:0}
      `}</style>
      <h3>在 ChatGPT 里具体怎么点</h3>
      <div className="steps">
        <div className="step">
          <strong>打开 ChatGPT 并新建对话</strong>
          <p>在电脑浏览器登录自己的 ChatGPT，点击“新建对话”。不要进入图片生成、语音或其他无关工具页。</p>
        </div>
        <div className="step">
          <strong>选择“工作”或普通对话</strong>
          <p>界面有“工作”时优先使用；没有就用普通 ChatGPT。后续 GPT 需要 Codex 检查代码时可以允许，但秘密仍由本人输入。</p>
        </div>
        <div className="step">
          <strong>选择 GPT-5.6 Sol</strong>
          <p>点击顶部或输入框附近的模型选择器，选择 GPT-5.6 Sol。看不到该模型时先不要正式部署。</p>
        </div>
        <div className="step">
          <strong>思考程度选择“高”</strong>
          <p>正常部署使用“高”；只有部署失败、资源绑定、数据库迁移、账号串号、版本冲突或升级时改成“超高”。</p>
        </div>
        <div className="step">
          <strong>完整复制下方部署引导语</strong>
          <p>不要删减账号核对、资源隔离和秘密保护规则。发送后先等 GPT 核对账号。</p>
        </div>
        <div className="step">
          <strong>先核对 GitHub 和 Cloudflare</strong>
          <p>GPT 应先问清当前学生、GitHub 登录身份、Cloudflare 登录身份，以及这是该账号里的第几个网站。</p>
        </div>
        <div className="step">
          <strong>不要提前点击 Cloudflare</strong>
          <p>只有 GPT 确认账号正确、站点名称不冲突、D1 和 MEDIA_KV 会独立创建后，才进入部署页面。</p>
        </div>
        <div className="step">
          <strong>截图时遮住秘密</strong>
          <p>页面、按钮、项目名和错误日志可以发；密码、INITIAL_ADMIN_CODE、恢复码、Token 和 Cookie 不能发。</p>
        </div>
      </div>
      <div className="warning">
        <strong>GPT 如果一开始就让你直接部署</strong>
        <p>回复：“先不要部署。请先确认当前浏览器里的 GitHub 和 Cloudflare 登录账号，以及这是该账号里的第几个网站。”</p>
      </div>
    </div>,
    host,
  );
}
