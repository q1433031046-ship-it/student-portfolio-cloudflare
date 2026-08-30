import styles from "./access-gate.module.css";

export function PortfolioAccessGate({ siteTitle, error }: { siteTitle: string; error?: string | null }) {
  return (
    <main className={styles.gate}>
      <section className={styles.panel}>
        <div className={styles.brand}><i>PF</i><span>{siteTitle}</span></div>
        <h1>此作品集已开启限制访问</h1>
        <p>请使用管理员提供的二维码或访问链接。二维码会先打开确认页，确认页本身不会扣除使用次数。</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}><a href="/admin">管理员进入后台</a><span>成功进入后，当前浏览器固定访问 24 小时</span></div>
      </section>
    </main>
  );
}
