import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { PagesClient, digestPagesFile, preflightPagesFiles } from '../.pages-workerd/runner-lib.mjs';
const stream = bytes => { let at = 0; return new ReadableStream({ pull(c) { if (at >= bytes.length) { c.close(); return; } const end = Math.min(at + 4194304, bytes.length); c.enqueue(bytes.subarray(at, end)); at = end; } }); };
const results = [];
for (const size of [0, 1, 2, 3, 1293044, 25 * 1024 * 1024]) {
  const bytes = Buffer.alloc(size, 83); const digest = await digestPagesFile('media/fixture.mp4', stream(bytes), size);
  assert.equal(digest.sha256, createHash('sha256').update(bytes).digest('hex'));
  let sends = 0;
  const client = new PagesClient('a'.repeat(32), 'zkyl-student-showcase', 'local-only', async (input, init) => {
    assert.equal(String(input), 'https://api.cloudflare.com/client/v4/pages/assets/upload'); sends++;
    const rows = await new Response(init.body).json(); assert.equal(rows[0].key, digest.key); assert.deepEqual(Buffer.from(rows[0].value, 'base64'), bytes);
    return Response.json({ success: true, result: null });
  });
  await client.upload({ path: 'media/fixture.mp4', byteSize: size, contentType: 'video/mp4', ...digest }, stream(bytes), 'local-fixture-jwt'); assert.equal(sends, 1);
  results.push({ bytes: size, rawSourceBlockBytes: 4194304, sha256AndBase64Exact: true, uploadAttempts: sends });
}
assert.throws(() => preflightPagesFiles([{ path: 'large.mp4', byteSize: 25 * 1024 * 1024 + 1 }]));
let attempts = 0; const reject = new PagesClient('a'.repeat(32), 'zkyl-student-showcase', 'local-only', async () => { attempts++; return Response.json({ success: false }, { status: 503 }); });
await assert.rejects(reject.createDeployment([], 'preview', 'fixture', '/*\n X-Content-Type-Options: nosniff')); assert.equal(attempts, 1);
await writeFile('audit/pages-free/node-protocol-verification.json', JSON.stringify({ runtime: process.version, results, over25MiBRejectedBeforeSend: true, failedDeploymentNotRetried: true }, null, 2));
console.log(JSON.stringify({ sizes: results.length, largestBytes: results.at(-1).bytes, over25MiBRejectedBeforeSend: true, failedDeploymentAttempts: attempts }));
