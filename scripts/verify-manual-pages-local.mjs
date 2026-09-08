import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, join } from 'node:path';
const output = resolve(process.argv[2]), root = join(output, 'site');
const receipt = JSON.parse(await readFile(join(output, 'package-receipt.json'), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + (new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
    const rel = relative(root, path); if (rel.startsWith('..') || isAbsolute(rel)) throw 0;
    const bytes = await readFile(path); res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream'); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: '管理网站', exact: true }).waitFor();
  const title = await page.title();
  const adminHref = await page.getByRole('link', { name: '管理网站', exact: true }).getAttribute('href');
  if (adminHref !== 'https://student-portfolio.q1433031046.workers.dev/admin' || errors.length) throw new Error('Page rendering/admin link failed');
  const imageFiles = receipt.files.filter(f => f.path.startsWith('media/'));
  for (const file of imageFiles) { const r = await page.request.get(origin + '/' + file.path); if (r.status() !== 200 || (await r.body()).length !== file.bytes) throw new Error('Image readback failed'); }
  await page.screenshot({ path: join(output, 'local-page.png'), fullPage: true });
  const result = { title, pageErrors: errors, renderedRoot: await page.locator('#root').innerText().then(x => x.length > 0), adminHref,
    mediaReadbacks: imageFiles.length, videoReferences: 0, acceptedMissingVideo: true, browser: 'Installed Chrome, isolated headless context', remoteWrites: 0 };
  await writeFile(join(output, 'local-page-validation.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await new Promise(r => server.close(r)); }
