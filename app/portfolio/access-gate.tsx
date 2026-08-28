import styles from "./access-gate.module.css";

export function PortfolioAccessGate({ siteTitle, error }: { siteTitle: string; error?: string | null }) {
  return (
    <main className={styles.gate}>
      <section className={styles.panel}>
        <div className={styles.brand}><i>PF</i><span>{siteTitle}</span></div>
        <h1>此作品集需要访问二维码。</h1>
        <p>请使用管理员提供的二维码打开。每张二维码都有独立的使用次数与有效期。</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}><a href="/admin">管理员进入后台</a><span>扫码成功后会自动返回作品集</span></div>
      </section>
    </main>
  );
}
