import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(projectRoot, "cloudflare-pages-dist");
const clientDir = join(projectRoot, "dist", "client");
const workerPath = join(projectRoot, "dist", "server", "index.js");
const frameworkPath = join(projectRoot, "docs", "specs", "2026-08-26-extensible-portfolio-frontend.md");

register(new URL("../tests/cloudflare-workers-loader.mjs", import.meta.url));

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("static-export", Date.now().toString());
const { default: worker } = await import(workerUrl.href);
const response = await worker.fetch(
  new Request("http://localhost/demo", { headers: { accept: "text/html" } }),
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

if (!response.ok) {
  throw new Error(`Unable to render /demo: ${response.status}`);
}

const demoHtml = await response.text();
const framework = await readFile(frameworkPath, "utf8");
const rootHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="0;url=/demo/">
  <title>学生个人作品集 Demo</title>
</head>
<body><a href="/demo/">打开学生个人作品集 Demo</a></body>
</html>`;

await rm(outputDir, { recursive: true, force: true });
await mkdir(join(outputDir, "demo"), { recursive: true });
await cp(clientDir, outputDir, { recursive: true });

await Promise.all([
  writeFile(join(outputDir, "index.html"), rootHtml),
  writeFile(join(outputDir, "demo", "index.html"), demoHtml),
  writeFile(join(outputDir, "DESIGN-FRAMEWORK.md"), framework),
  writeFile(join(outputDir, "robots.txt"), "User-agent: *\nDisallow: /\n"),
  writeFile(
    join(outputDir, "_headers"),
    "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/demo/*\n  Cache-Control: public, max-age=300\n",
  ),
]);

console.log(`Cloudflare Pages demo output: ${outputDir}`);
