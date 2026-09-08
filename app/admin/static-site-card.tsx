"use client";

import { useEffect, useState } from 'react';
import { qrSvg } from '../lib/qr-code';
import { fetchAdmin } from './admin-fetch';
import { downloadManualPackage } from './manual-static-package';
import { PAGES_UPLOAD_URL, STATIC_SITE_URL } from '../lib/site-entrances';
import styles from './admin.module.css';

type StaticState = { productionUrl: string | null; publicRevision: number; lastSuccessAt: string | null };
export function StaticSiteCard({ revision, disabled }: { revision: number; disabled: boolean; publish: () => Promise<void> }) {
  const [state, setState] = useState<StaticState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    fetchAdmin('/api/admin/static-site').then(async response => {
      if (response.ok && active) setState(await response.json());
    }).catch(() => { if (active) setMessage('历史发布记录暂时无法读取，仍可下载当前内容。'); });
    return () => { active = false; };
  }, []);
  async function download() {
    if (busy || disabled) return;
    setBusy(true); setMessage('正在读取当前已保存内容…');
    try {
      const result = await downloadManualPackage(revision, setMessage);
      setMessage(`可上传的网站包（ZIP）已生成（${result.fileCount} 个文件）。请等下载完成，再上传整个 ZIP；网站尚未因下载而更新。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '下载未完成，请检查后再试'); }
    finally { setBusy(false); }
  }
  const fixedUrl = STATIC_SITE_URL;
  return <section className={styles.staticSiteCard} aria-labelledby="static-site-card-title">
    <header><div><span>CLOUDFLARE PAGES</span><h2 id="static-site-card-title">固定静态作品网站</h2></div><strong>手动上传</strong></header>
    <p>推荐先等待媒体上传完成、保存草稿，点击“发布动态前台 →”并等待成功，再下载已保存页面、图片和视频的 ZIP。整个 ZIP 可直接上传原 Cloudflare Pages 项目，无需解压。</p>
    <dl><div><dt>当前已保存草稿</dt><dd>r{revision}</dd></div><div><dt>发布方式</dt><dd>Cloudflare 手动上传</dd></div></dl>
    <p>自动静态发布暂时停用，原实现和历史记录保留。下载完成不代表静态网站已更新，请上传后打开固定网址确认。</p>
    {state?.lastSuccessAt && <p>历史自动发布记录：r{state.publicRevision}（{state.lastSuccessAt}）。此记录不代表最近一次手动上传。</p>}
    <p>单个文件最大 25 MiB。下载期间请勿编辑内容或清理媒体；较大的完整包需要足够的浏览器内存。</p>
    <div className={styles.publishActions}>
      <button type="button" disabled={disabled || busy} onClick={() => void download()}>{busy ? '正在打包网站…' : '下载可上传的网站包（ZIP）'}</button>
      <a href={PAGES_UPLOAD_URL} target="_blank" rel="noreferrer">打开上传页面 ↗</a>
      <a href={fixedUrl} target="_blank" rel="noreferrer">查看静态网站 ↗</a>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('portfolio:open-guide', { detail: { sectionId: 'admin-guide-publish' } }))}>打开主教程：静态网站手动上传</button>
    </div>
    <details>
      <summary>手动上传教程：从保存内容到正式更新</summary>
      <p>内容编辑与下载请进入<a href="https://student-portfolio.q1433031046.workers.dev/admin" target="_blank" rel="noreferrer">原 Worker 管理后台 ↗</a>。静态网站用于展示作品，上传页面需要登录原 Cloudflare 账号。</p>
      <ol>
        <li>等待图片和视频上传完成，在原管理后台保存草稿并确认版本已更新。</li>
        <li>点击“发布动态前台 →”，等待“动态前台已更新”；失败时先处理该步骤。</li>
        <li>点击“下载可上传的网站包（ZIP）”，等待浏览器完成 ZIP 下载。</li>
        <li>点击“打开上传页面”，进入原 Cloudflare Pages 项目。</li>
        <li>确认项目为 zkyl-student-showcase，发布环境选择 Production。</li>
        <li>选择刚下载的整个 ZIP，无需解压，也无需创建新项目。</li>
        <li>等待全部文件上传完成，再点击“Save and deploy”。</li>
        <li>看到“Success”后，打开“查看静态网站”，确认最新内容和图片。</li>
      </ol>
      <p>以上为双站同步的推荐顺序。ZIP 直接读取已保存草稿，动态发布不是打包的技术前置；动态成功或 ZIP 下载完成都不表示静态网站已更新，须完成 Cloudflare 发布。以后修改内容时重复以上步骤。若出现失败或状态不明，先查看本次部署记录与状态，避免连续重复提交。</p>
    </details>
    {message && <p role="status" aria-live="polite">{message}</p>}
    <h3>静态网站访问二维码</h3>
    <p><a href={fixedUrl} target="_blank" rel="noreferrer">{fixedUrl}</a></p>
    <p>扫码查看已上传的网站；上传或下载请使用上方按钮。二维码指向固定地址，每次更新无需重新生成。出现二维码不代表本次上传已成功。</p>
    <div className={styles.staticSiteQr} aria-label="固定静态网站二维码" dangerouslySetInnerHTML={{ __html: qrSvg(fixedUrl, { title: '静态作品网站' }) }} />
  </section>;
}
