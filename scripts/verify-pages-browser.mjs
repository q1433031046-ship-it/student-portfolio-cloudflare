import { register } from "node:module";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { resolve, join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
register(new URL("../tests/cloudflare-workers-loader.mjs", import.meta.url));
const { createDefaultPortfolioDocument } = await import("../app/portfolio/default-document.ts");
const { mediaAssetsInDocument, createDefaultEndCoverConfig, createDefaultEndCoverSlide } = await import("../app/portfolio/model.ts");
const { freezeStaticCandidate } = await import("../app/api/_lib/static-site-contract.ts");
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), output = join(root, ".pages-browser-fixture");
await mkdir(output, { recursive: true });
await cp(join(root, ".pages-template"), output, { recursive: true });
await mkdir(join(output, "media"), { recursive: true }); await mkdir(join(output, "data"), { recursive: true });
const document = createDefaultPortfolioDocument();
document.hero.name = "本地完整功能验收";
document.hero.email = "portfolio@example.test";
document.settings.contact.title = "联系方式";
document.settings.videoWatermarkText = "STATIC QA";
document.settings.customFont.label = "本地字体验证";
for (const slide of document.hero.slides) for (const layer of slide.layers) layer.fontFamily = "custom";
document.endCovers = createDefaultEndCoverConfig(); document.endCovers.enabled = true;
document.endCovers.slides = [createDefaultEndCoverSlide('ending-1'),createDefaultEndCoverSlide('ending-2')];
// Preserve a no-video project alongside real local playable video projects.
document.projects.at(-1).finalVideo = { ...document.projects.at(-1).finalVideo, available: false, key: undefined, src: undefined };
const image = await readFile(join(root, "public/og.png"));
const video = Buffer.from((await readFile(join(root, "tests/fixtures/codec-sample.mp4.base64"), "utf8")).trim(), "base64");
const font = await readFile(join(root, "node_modules/next/dist/next-devtools/server/font/geist-latin.woff2"));
const assets = mediaAssetsInDocument(document), records = [], bytesById = new Map();
for (const [i, asset] of assets.entries()) {
  if (asset === document.projects.at(-1).finalVideo) continue;
  const bytes = asset.kind === "video" ? video : asset.kind === "font" ? font : image;
  const contentType = asset.kind === "video" ? "video/mp4" : asset.kind === "font" ? "font/woff2" : "image/png";
  asset.key = `qa/media-${i}`; asset.src = undefined;
  const id = `fixture-${i}`; bytesById.set(id, bytes);
  records.push({ id, objectKey: asset.key, contentType, byteSize: bytes.length, storageBackend: "kv", sourceEtag: `qa-${i}`, status: "uploaded" });
}
const frozen = await freezeStaticCandidate(document, records);
for (const media of frozen.media) await writeFile(join(output, media.publicPath), bytesById.get(media.id));
await writeFile(join(output, "data/portfolio.json"), frozen.canonicalJson);
const html = (await readFile(join(output, "index.html"), "utf8")).replace("__STATIC_SITE_TITLE__", "本地完整功能验收").replace("__WORKER_ADMIN_URL__", "https://worker.example.test/admin");
await writeFile(join(output, "index.html"), html);
const requests = [];
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  requests.push(pathname);
  const target = resolve(output, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!target.startsWith(output + "/") && !target.startsWith(output + "\\")) { res.writeHead(403); res.end(); return; }
  try {
    const b = await readFile(target); const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".mp4": "video/mp4", ".woff2": "font/woff2", ".json": "application/json" };
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    res.setHeader("Content-Type", types[extname(target)] ?? "application/octet-stream");
    if (range) { const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), b.length - 1) : b.length - 1; res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${b.length}`, "Accept-Ranges": "bytes", "Content-Length": end-start+1 }); res.end(b.subarray(start, end+1)); }
    else { res.writeHead(200, { "Content-Length": b.length }); res.end(b); }
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const width of [1280,320,360,390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 600, isMobile: width < 600 });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(origin); await page.locator("[data-hero-slide-index='0']").waitFor();
    if (width < 600) await page.getByRole("button", { name: "下一张首图" }).click();
    else await page.locator("[data-hero-slide-index='1']").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "查看作品" }).last().click();
    const first = page.locator("[data-project-id]").first();
    await first.getByRole("button", { name: /展开.*项目详情/u }).click();
    assert.equal(await first.getAttribute("data-open"), "true");
    await first.locator("[data-cover-overlay]").hover();
    const play = first.locator("[data-playback-trigger]").last(); await play.click();
    const player = page.locator("video"); await player.waitFor();
    await player.evaluate(async v => { v.muted = true; await v.play(); });
    await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0);
    const videoEvidence = await player.evaluate(v => ({ duration:v.duration, currentTime:v.currentTime, src:v.currentSrc }));
    assert(videoEvidence.duration > 0 && videoEvidence.src.includes("/media/"));
    await player.evaluate(v => { v.pause(); v.currentTime=Math.min(0.2,v.duration/2); });
    await player.dispatchEvent('error');
    await page.waitForTimeout(150);
    await player.dispatchEvent('error');
    await page.getByRole('button',{name:'重新连接'}).waitFor();
    await page.getByRole('button',{name:'重新连接'}).click();
    await page.locator('video').waitFor();
    await page.keyboard.press("Escape"); await page.locator("video").waitFor({ state:"detached" });
    await page.getByRole("button", { name:/联系/u }).first().click();
    await page.getByRole("dialog", { name:"联系方式" }).waitFor();
    await page.getByRole("button", { name:"关闭联系方式" }).click();
    assert.equal(await page.locator('[data-end-cover-id]').count(),2);
    await page.evaluate(() => document.fonts.load('16px PortfolioCustom'));
    const overflow = await page.evaluate(() => ({ width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,font:document.fonts.check('16px PortfolioCustom') }));
    assert.equal(overflow.scroll,overflow.width);assert(overflow.font);
    assert.equal(await page.locator("[data-project-id]").last().locator("[data-playback-trigger]").count(),0);
    assert.equal(errors.length,0,errors.join(";"));
    await page.screenshot({ path:join(output,`qa-${width}.png`),fullPage:false });
    results.push({width,heroSwitch:true,projectExpansion:true,video:videoEvidence,boundedErrorRecovery:true,manualReconnect:true,twoEndCovers:true,contact:true,noVideo:true,font:true,noOverflow:true,pageErrors:errors});
    await page.close();
  }
  const qrDoc=structuredClone(frozen.candidate);delete qrDoc.settings.contact.image.src;delete qrDoc.settings.contact.image.available;
  await writeFile(join(output,'data/portfolio.json'),JSON.stringify(qrDoc));
  const qrPage=await browser.newPage();await qrPage.goto(origin);await qrPage.getByRole('button',{name:/联系/u}).first().click();
  await qrPage.getByRole('img',{name:'联系方式二维码'}).waitFor();await qrPage.close();
  await writeFile(join(output,'data/portfolio.json'),frozen.canonicalJson);
  assert(!requests.some(p=>p.startsWith("/api/")||p.startsWith("/admin")));
  await writeFile(join(output,"browser-verification.json"),JSON.stringify({fixture:'Frozen synthetic document with local image/video/font; not claimed to be current user content',candidateSha256:frozen.candidateSha256,mediaCount:frozen.media.length,results,contactQr:true,apiRequests:0},null,2));
  console.log(JSON.stringify({results:results.map(r=>({width:r.width,passed:true})),apiRequests:0}));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
