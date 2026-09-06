const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const BASE_HASH = '8d0fc2b08777af56d43139412327c0a8702b469919bb7428d54cfeca7f3351d8';
const HEADER_HASH = '9e55124bccd40b43dbc6e002daa777fa8f32a230420152910784ca65501d9e0f';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const definitions = [
  ['readJsonEvidence', 'async function readJsonEvidence(baseUrl, file)', '\nfunction parseArtifactManifest', 1972529],
  ['triggerDraftBuild', 'async triggerDraftBuild(hookUrl, input, providerRequestKey)', 'async getDeploy(siteId, deployId)', 2387044],
];
function unique(buffer, needle) {
  const at = buffer.indexOf(needle);
  assert.ok(at >= 0, 'Missing exact anchor');
  assert.equal(buffer.indexOf(needle, at + 1), -1, 'Ambiguous anchor');
  return at;
}
function patchModule(original) {
  assert.equal(original.length, 2485822);
  assert.equal(hash(original), BASE_HASH);
  const edits = definitions.map(([name, start, end, expectedOffset]) => {
    const from = unique(original, Buffer.from(start));
    const to = original.indexOf(Buffer.from(end), from);
    assert.ok(to > from);
    const body = original.subarray(from, to);
    const relative = unique(body, Buffer.from('redirect: "error"'));
    const offset = from + relative + Buffer.byteLength('redirect: "');
    assert.equal(offset, expectedOffset);
    return { name, offset, before: 'error', after: 'manual', context: original.subarray(offset - 11, offset + 7).toString('utf8') };
  });
  const chunks = []; let cursor = 0;
  for (const edit of edits) {
    chunks.push(original.subarray(cursor, edit.offset), Buffer.from(edit.after));
    cursor = edit.offset + edit.before.length;
  }
  chunks.push(original.subarray(cursor));
  const patched = Buffer.concat(chunks);
  assert.equal(patched.length, original.length + 2);
  let restored = patched;
  for (let index = edits.length - 1; index >= 0; index--) {
    const edit = edits[index]; const at = edit.offset + index;
    assert.equal(restored.subarray(at, at + edit.after.length).toString(), edit.after);
    restored = Buffer.concat([restored.subarray(0, at), Buffer.from(edit.before), restored.subarray(at + edit.after.length)]);
  }
  assert.deepEqual(restored, original, 'Reverse patch must reproduce every original byte');
  // Compare every unaffected region separately as well as the reverse reconstruction.
  let beforeCursor = 0, afterCursor = 0;
  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index], afterOffset = edit.offset + index;
    assert.deepEqual(original.subarray(beforeCursor, edit.offset), patched.subarray(afterCursor, afterOffset));
    beforeCursor = edit.offset + 5; afterCursor = afterOffset + 6;
  }
  assert.deepEqual(original.subarray(beforeCursor), patched.subarray(afterCursor));
  return { patched, manifest: { originalBytes: original.length, originalSha256: hash(original), patchedBytes: patched.length,
    patchedSha256: hash(patched), edits, reverseIdentical: true, unaffectedSegmentsIdentical: true } };
}
function main(source, headers) {
  assert.ok(source && headers, 'Provide exact downloaded module and _headers paths');
  const original = fs.readFileSync(source), headerBytes = fs.readFileSync(headers);
  assert.equal(headerBytes.length, 125); assert.equal(hash(headerBytes), HEADER_HASH);
  const { patched, manifest } = patchModule(original);
  const output = path.join(__dirname, 'artifact');
  assert.ok(!fs.existsSync(output), 'Artifact target already exists');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'worker-entry.js'), patched, { flag: 'wx' });
  fs.writeFileSync(path.join(output, '_headers'), headerBytes, { flag: 'wx' });
  manifest.headers = { bytes: headerBytes.length, sha256: hash(headerBytes), unchanged: true };
  manifest.inputPaths = { module: path.resolve(source), headers: path.resolve(headers) };
  fs.writeFileSync(path.join(__dirname, 'patch-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(manifest, null, 2));
}
module.exports = { patchModule, hash };
if (require.main === module) main(process.argv[2], process.argv[3]);
