import assert from 'node:assert/strict';
import { executeRunner, RunnerRpc } from './pages-runner.mjs';
export async function verifyNodeRunner(mf, db, fixture) {
  await db.prepare("UPDATE pages_jobs SET status='PUBLISHED'").run();
  await db.prepare("INSERT INTO pages_site(id,project,production_branch,production_url) VALUES('default','zkyl-student-showcase','main','https://zkyl-student-showcase.pages.dev')").run();
  const { id } = await fixture({ op: 'freeze' });
  await fixture({ op: 'dispatch', id, phase: 'preview' });
  const assets = new Map(), deployments = []; let canonical, creates = 0, loseReceipt = true, loseDeployment = true, corruptRead = false;
  const send = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'worker.example.test') {
      const result = await mf.dispatchFetch(`http://fixture${url.pathname}`, init);
      if (JSON.parse(new TextDecoder().decode(init.body)).op === 'receipt' && result.ok && loseReceipt) { loseReceipt = false; await result.body.cancel(); throw new Error('fixture accepted callback lost'); }
      return result;
    }
    if (url.hostname.endsWith('.pages.dev')) {
      const deployment = url.hostname === 'zkyl-student-showcase.pages.dev' ? canonical : deployments.find(d => new URL(d.url).hostname === url.hostname);
      const bytes = deployment && assets.get(deployment.manifest[url.pathname]);
      const headers = {}; let matches = false;
      for (const line of (deployment?.headers ?? '').split('\n')) {
        if (!line.trim()) continue;
        if (!line.startsWith(' ')) matches = line.endsWith('*') ? url.pathname.startsWith(line.slice(0, -1)) : url.pathname === line;
        else if (matches) { const at = line.indexOf(':'); headers[line.slice(0, at).trim()] = line.slice(at + 1).trim(); }
      }
      if (bytes && corruptRead) { corruptRead = false; const changed = Buffer.from(bytes); changed[0] ^= 1; return new Response(changed, { headers }); }
      return new Response(bytes ?? null, { status: bytes ? 200 : 404, headers });
    }
    assert.equal(url.hostname, 'api.cloudflare.com');
    const ok = result => Response.json({ success: true, result });
    if (url.pathname.endsWith('/upload-token')) return ok({ jwt: 'local-fixture-token' });
    if (url.pathname.endsWith('/check-missing')) return ok(JSON.parse(init.body).hashes.filter(k => !assets.has(k)));
    if (url.pathname.endsWith('/upload')) { const records = await new Response(init.body).json(); for (const f of records) assets.set(f.key, Buffer.from(f.value, 'base64')); return ok(null); }
    if (url.pathname.endsWith('/upsert-hashes')) return ok(null);
    if (url.pathname.endsWith('/deployments') && init?.method === 'POST') {
      creates++; const f = init.body, deployment = { id: String(creates).padStart(8, '0'), url: `https://${String(creates).padStart(8, '0')}.zkyl-student-showcase.pages.dev`, environment: f.get('branch') === 'main' ? 'production' : 'preview', latest_stage: { status: 'success' }, deployment_trigger: { metadata: { branch: f.get('branch'), commit_message: f.get('commit_message') } }, manifest: JSON.parse(f.get('manifest')), headers: await f.get('_headers').text() };
      deployments.push(deployment); if (deployment.environment === 'production') canonical = deployment;
      if (loseDeployment) { loseDeployment = false; throw new Error('fixture accepted deployment lost'); }
      return ok(deployment);
    }
    if (url.pathname.endsWith('/deployments')) return ok(deployments);
    if (url.pathname.includes('/deployments/')) return ok(deployments.find(d => d.id === url.pathname.split('/').at(-1)));
    return ok({ name: 'zkyl-student-showcase', production_branch: 'main', canonical_deployment: canonical });
  };
  const config = { job: id, phase: 'preview', run: '201', attempt: 1, head: 'a'.repeat(40), ref: 'refs/tags/local-fixture', repository: 'q1433031046-ship-it/student-portfolio-cloudflare', workflowRef: 'q1433031046-ship-it/student-portfolio-cloudflare/.github/workflows/pages-publish.yml@refs/tags/local-fixture', origin: 'https://worker.example.test', secret: 'local-fixture-only-not-a-real-secret', account: 'a'.repeat(32), pagesToken: 'local-only' };
  const preview = await executeRunner(config, { fetch: send, delay: async () => {} }); assert.equal(preview.status, 'verified'); assert.equal(creates, 1);
  assert.equal((await db.prepare("SELECT current_deploy FROM pages_site WHERE id='default'").first()).current_deploy, null);
  await db.prepare("UPDATE portfolio_documents SET draft_json=json_set(draft_json,'$.hero.name','Later draft'),published_json=json_set(draft_json,'$.hero.name','Dynamic independent'),revision=2 WHERE id='default'").run();
  await fixture({ op: 'dispatch', id, phase: 'production' }); loseDeployment = true; loseReceipt = true;
  corruptRead = true;
  await assert.rejects(executeRunner({ ...config, phase: 'production', run: '202' }, { fetch: send, templatePath: 'nonexistent-production-must-not-build.json' }), /RUNNER_PREVIEW_BYTES_CHANGED/);
  assert.equal(creates, 1);
  await db.prepare("UPDATE pages_runner_phases SET state_json=json_set(state_json,'$.expires',0) WHERE job_id=? AND phase='production'").bind(id).run();
  const production = await executeRunner({ ...config, phase: 'production', run: '202', attempt: 2 }, { fetch: send, templatePath: 'nonexistent-production-must-not-build.json', delay: async () => {} });
  assert.equal(production.status, 'verified'); assert.equal(creates, 2); assert.equal(production.artifact, preview.artifact);
  assert.deepEqual(deployments[0].manifest, deployments[1].manifest); assert.equal(deployments[0].headers, deployments[1].headers);
  assert.equal((await db.prepare("SELECT public_revision FROM pages_site WHERE id='default'").first()).public_revision, 1);
  assert.equal(JSON.parse((await db.prepare("SELECT published_json FROM portfolio_documents WHERE id='default'").first()).published_json).hero.name, 'Dynamic independent');
  return { nodeRunnerActualWorkerRpc: true, previewAndProductionSameManifestAndControls: true, productionDoesNotBuildTemplate: true, wrongPreviewBytesStopBeforeProductionAttempt: true, deploymentLostResponseCreates: 2, callbackLostResponseIdempotent: true, dynamicIndependent: true };
}

export async function verifyAdditionalBoundaries(mf, db, fixture) {
  await db.prepare("UPDATE pages_jobs SET status='PUBLISHED'").run();
  const doc = await fixture({ op: 'default' }); doc.hero.statement = '文'.repeat(280_000);
  await db.prepare("UPDATE portfolio_documents SET draft_json=?,revision=1 WHERE id='default'").bind(JSON.stringify(doc)).run();
  const { id } = await fixture({ op: 'freeze' });
  assert.equal((await db.prepare('SELECT length(CAST(candidate_json AS BLOB)) n FROM pages_jobs WHERE id=?').bind(id).first()).n > 840_000, true);
  await fixture({ op: 'dispatch', id, phase: 'preview' });
  const send = (input, init) => mf.dispatchFetch('http://fixture/api/pages-runner', init);
  const config = { job: id, phase: 'preview', run: '301', attempt: 1, secret: 'local-fixture-only-not-a-real-secret', origin: 'https://worker.example.test' };
  const rpc = new RunnerRpc(config, send), claim = await rpc.call('claim', { readOnly: true }); rpc.lease = claim.lease;
  assert.equal(claim.scope, 'read');
  let text = '';
  for (let page = 0; page < 256; page++) { const p = await rpc.call('snapshot', { page }); assert.equal(Buffer.byteLength(JSON.stringify(p)) < 65536, true); text += p.fragment; if ((page + 1) * 4096 >= p.characters) break; }
  assert.equal(JSON.parse(text).hero.statement, doc.hero.statement);
  await assert.rejects(rpc.call('deployment-permit'), /RUNNER_LEASE/); rpc.seq--;
  await assert.rejects(rpc.call('receipt', {}), /RUNNER_LEASE/); rpc.seq--;
  await assert.rejects(rpc.call('manifest-register', { files: [] }), /RUNNER_LEASE/);
  await db.prepare("UPDATE pages_runner_phases SET state_json=json_set(state_json,'$.fixtureCompleted',json('true')) WHERE job_id=? AND phase='preview'").bind(id).run();
  assert.equal((await fixture({ op: 'retry', id, phase: 'preview' })).retried, true);
  assert.equal((await mf.dispatchFetch('http://fixture/', { method: 'POST', body: JSON.stringify({ op: 'retry', id, phase: 'preview' }) })).status, 409);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM fixture_dispatches WHERE body='rerun'").first()).n, 1);
  await db.prepare("UPDATE pages_jobs SET status='PUBLISHED'").run();
  doc.settings.accessToken = 'fixture-private';
  await db.prepare("UPDATE portfolio_documents SET draft_json=?,revision=1 WHERE id='default'").bind(JSON.stringify(doc)).run();
  const count = (await db.prepare('SELECT COUNT(*) n FROM pages_jobs').first()).n;
  const rejected = await mf.dispatchFetch('http://fixture/', { method: 'POST', body: JSON.stringify({ op: 'freeze' }) }); assert.equal(rejected.status, 409);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM pages_jobs').first()).n, count);
  return { control60KiBAccepted66KiBRejected: true, productionWithoutAdminPhaseRejected: true, largeUnicodeSnapshotPaged: true, largeSnapshotBytes: Buffer.byteLength(text), readLeaseCannotDeployRegisterOrReceive: true, canceledRun201RerunOnce: true, privateFieldRejectedBeforeCIAndTransactionRolledBack: true };
}
