import { headers } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import {
  checkPortfolioAccess,
  inspectAccessPassToken,
  type AccessPassInspection,
} from "../api/_lib/portfolio-access";
import { getPortfolioRecord } from "../api/_lib/portfolio-store";
import { AccessPageActions } from "./access-actions";
import styles from "./access-page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "访问作品集",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

const SAFE_ERRORS = new Set([
  "二维码无效",
  "二维码已停用",
  "二维码已过期",
  "二维码使用次数已用完",
  "二维码暂时不可用",
]);

type AccessSearchParams = { key?: string; error?: string };

export default async function AccessPage({ searchParams }: { searchParams?: Promise<AccessSearchParams> }) {
  const params = await searchParams;
  const token = typeof params?.key === "string" ? params.key.slice(0, 300) : "";
  const redirectedError = typeof params?.error === "string" && SAFE_ERRORS.has(params.error) ? params.error : null;
  let inspection: AccessPassInspection = { validToken: false, reason: "二维码无效" };
  let currentPassId: string | null = null;
  let administratorAccess = false;
  let unrestrictedAccess = false;
  let siteTitle = "学生作品展示";
  let systemError: string | null = null;

  try {
    if (token.length >= 20) inspection = await inspectAccessPassToken(token);
  } catch {
    systemError = "二维码暂时不可用";
  }

  try {
    const requestHeaders = await headers();
    const decision = await checkPortfolioAccess(new Request("https://portfolio.local/access", { headers: requestHeaders }));
    currentPassId = decision.allowed && decision.reason === "session" ? decision.passId ?? null : null;
    administratorAccess = decision.allowed && decision.reason === "admin";
    unrestrictedAccess = decision.allowed && decision.reason === "open";
  } catch {
    systemError = "二维码暂时不可用";
  }

  try {
    const record = await getPortfolioRecord();
    siteTitle = record?.published?.settings.siteTitle ?? record?.draft.settings.siteTitle ?? siteTitle;
  } catch {
    // The access decision above remains authoritative if the display title cannot be read.
  }

  const canOpenDirectly = unrestrictedAccess || administratorAccess || currentPassId !== null;
  const canRedeem = inspection.validToken && inspection.redeemable;
  const accessError = canOpenDirectly
    ? null
    : redirectedError ?? systemError ?? inspection.reason;

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="access-page-title">
        <header className={styles.brand}><i>PF</i><span>{siteTitle}</span></header>
        <div className={styles.kicker}>PRIVATE PORTFOLIO / ACCESS</div>
        <h1 id="access-page-title">{unrestrictedAccess ? "当前作品集为公开访问" : canOpenDirectly ? "当前浏览器已获得访问权限" : "确认后打开作品集"}</h1>
        {inspection.validToken ? <p className={styles.passName}>访问链接：<strong>{inspection.pass.label}</strong></p> : null}

        {unrestrictedAccess ? (
          <div className={styles.rules} aria-label="公开访问规则">
            <article><b>01</b><strong>无需兑换二维码</strong><span>当前作品集已公开，可以直接打开。</span></article>
            <article><b>02</b><strong>不会扣除次数</strong><span>公开访问时不会扣除这张二维码的使用次数。</span></article>
            <article><b>03</b><strong>不会写入 Cookie</strong><span>系统不会创建二维码访问会话。</span></article>
          </div>
        ) : accessError ? (
          <div className={styles.error} role="alert"><strong>{accessError}</strong><span>请联系管理员获取新的二维码或访问链接。</span></div>
        ) : (
          <div className={styles.rules} aria-label="二维码使用规则">
            <article><b>01</b><strong>确认页不扣次数</strong><span>打开此确认页不会扣除次数。</span></article>
            <article><b>02</b><strong>成功进入计一次</strong><span>点击“打开作品集”后计为 1 次成功使用。</span></article>
            <article><b>03</b><strong>固定 24 小时</strong><span>当前浏览器随后保持 24 小时访问；重复打开不扣次数，也不会延长到期时间。</span></article>
          </div>
        )}

        <div className={styles.actions}>
          {canOpenDirectly ? (
            <Link className={styles.primary} href="/">打开作品集</Link>
          ) : canRedeem ? (
            <form action="/access/redeem" method="post">
              <input type="hidden" name="key" value={token} />
              <button className={styles.primary} type="submit">打开作品集</button>
            </form>
          ) : (
            <Link className={styles.primary} href="/">返回作品集入口</Link>
          )}
          {inspection.validToken ? <AccessPageActions /> : null}
        </div>

        <p className={styles.browserNote}>{unrestrictedAccess ? "网站恢复限制访问后，再使用管理员提供的二维码或访问链接。" : "请在实际观看作品的浏览器中点击打开。更换浏览器、使用无痕窗口或清除 Cookie，会被视为新的访问。"}</p>
      </section>
    </main>
  );
}
