export function UnpublishedState({ siteTitle }: { siteTitle: string }) {
  return (
    <main style={{ minHeight: "100svh", padding: "8vw", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f5f4ef", color: "#101114", fontFamily: "Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>{siteTitle}</strong>
        <a href="/admin" style={{ color: "inherit", fontSize: 12 }}>进入后台 →</a>
      </header>
      <section>
        <p style={{ margin: "0 0 18px", color: "#3258ff", fontSize: 10, fontWeight: 800, letterSpacing: ".16em" }}>READY TO PUBLISH</p>
        <h1 style={{ maxWidth: 900, margin: 0, fontSize: "clamp(52px, 10vw, 140px)", lineHeight: ".88", letterSpacing: "-.075em" }}>网站尚未发布</h1>
        <p style={{ maxWidth: 520, margin: "28px 0 0", color: "#6d7077", lineHeight: 1.7 }}>管理员完成内容编辑并首次发布后，作品页面会在这里开放。</p>
      </section>
    </main>
  );
}
