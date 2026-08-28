import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

async function render(pathname = "/") {
  const workerUrl = new URL("../cloudflare/worker-entry.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the published single-column portfolio homepage without private media keys", async () => {
  const response = await render();
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(html, /<title>中科云领学生作品展示<\/title>/i);
  assert.match(html, /作品不是结果/);
  assert.match(html, /点击展开作品/);
  assert.match(html, /播放视频/);
  assert.match(html, /mailto:/);
  assert.match(html, /href="\/admin"/);
  assert.doesNotMatch(html, /按模块连续浏览；点击封面展开项目；右下角播放视频。/);
  assert.doesNotMatch(html, /继续向下查看完整图文、分镜、角色与过程记录。/);
  assert.doesNotMatch(html, /portfolio\/[a-zA-Z0-9/_-]+\.(?:mp4|webm|mov)/i);
  assert.doesNotMatch(html, /成稿 \/ 02:48/);
  assert.match(html, /<span>联系<\/span><strong>[^<]+@[^<]+<\/strong>/);
  assert.match(html, /data-hero-slide-index="1"/);
  assert.match(html, /data-enter-target="true"/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
});

test("never caches the public portfolio API response", async () => {
  const response = await render("/api/portfolio");

  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  assert.equal(response.headers.get("pragma"), "no-cache");
});

test("renders the extensible single-column portfolio demo", async () => {
  const response = await render("/demo");
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(html, /林予安/);
  assert.match(html, /AI 影像创作者/);
  assert.match(html, /点击展开作品/);
  assert.match(html, /播放视频/);
  assert.doesNotMatch(html, /模板预览设置|PREVIEW SETTINGS/);
  assert.match(html, /项目详情/);
  assert.match(html, /AI 剧情短片/);
  assert.match(html, /AI 广告片/);
  assert.match(html, /AI 漫剧/);
  assert.match(html, /mailto:/);
  assert.match(html, /tel:/);
  assert.match(html, /href="\/admin"/);
});

test("renders the portfolio management console shell", async () => {
  const response = await render("/admin");
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(html, /正在打开控制台/);
});

test("keeps draft preview separate from publishing and uses plain Chinese admin labels", async () => {
  const [adminSource, previewSource, accessSource] = await Promise.all([
    readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/preview/draft-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/access-manager.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(adminSource, /快速预览/);
  assert.match(adminSource, /\/preview/);
  assert.match(previewSource, /\/api\/admin\/portfolio/);
  assert.match(adminSource, /durationReadout/);
  assert.match(adminSource, /formatVideoDuration/);
  assert.match(adminSource, /悬浮窗常驻/);
  assert.match(adminSource, /作品名与分类/);
  assert.match(accessSource, /二维码访问接口/);
  assert.match(accessSource, /限制访问已开启/);
  assert.match(accessSource, /下载二维码/);
});

test("keeps hover cover text off the poster after the pointer leaves", async () => {
  const [css, coverSource] = await Promise.all([
    readFile(new URL("../app/demo/portfolio-demo.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/portfolio/project-cover.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(css, /\.projectCover:hover \.projectCoverInfo/);
  assert.match(css, /\.projectCover\[data-cover-overlay="fixed"\]/);
  assert.match(coverSource, /data-cover-overlay=\{presentation\.overlayMode\}/);
  assert.match(coverSource, /presentation\.showTitle/);
  assert.doesNotMatch(css, /\.project\[data-open="true"\] \.projectCoverInfo \{ opacity: 1[^}]+\}\s*\.demo/u);
});
