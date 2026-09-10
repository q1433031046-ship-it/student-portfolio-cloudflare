import { writeFile, mkdir } from 'node:fs/promises';
export async function profileWorker(mf) {
  const base = await mf.getInspectorURL(); base.protocol = 'http:';
  const targets = await (await fetch(new URL('/json', base))).json();
  const target = targets.find(t => t.id === 'core:user:pages-free');
  if (!target) throw new Error('CPU inspector target unavailable');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let next = 0; const waiting = new Map(), samples = [];
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); const entry = waiting.get(message.id); if (!entry) return; waiting.delete(message.id); if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  await call('Profiler.enable'); await call('Profiler.setSamplingInterval', { interval: 100 });
  const dispatch = mf.dispatchFetch.bind(mf);
  await mkdir('.pages-workerd/cpu', { recursive: true });
  mf.dispatchFetch = async (input, init) => {
    const op = init?.headers?.['x-pages-identity'] ? JSON.parse(init.headers['x-pages-identity']).op : 'fixture';
    await call('Profiler.start');
    let response, bytes;
    try { response = await dispatch(input, init); bytes = await response.arrayBuffer(); }
    finally {
      const { profile } = await call('Profiler.stop');
      const nodes = new Map(profile.nodes.map(n => [n.id, n])); let sampledActiveUs = 0;
      const functions = new Map();
      for (let j = 0; j < (profile.samples?.length ?? 0); j++) {
        const node = nodes.get(profile.samples[j]), name = node?.callFrame.functionName ?? 'unknown', delta = profile.timeDeltas[j];
        if (['(idle)', '(root)'].includes(name)) continue;
        sampledActiveUs += delta; functions.set(name, (functions.get(name) ?? 0) + delta);
      }
      samples.push({ operation: op, sampledActiveMs: sampledActiveUs / 1000, profileDurationMs: (profile.endTime - profile.startTime) / 1000, samples: profile.samples?.length ?? 0, hotFunctions: [...functions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, us]) => ({ name, ms: us / 1000 })) });
      await writeFile(`.pages-workerd/cpu/${samples.length}-${op}.cpuprofile`, JSON.stringify(profile));
    }
    return new Response(bytes, { status: response.status, headers: response.headers });
  };
  return async () => {
    mf.dispatchFetch = dispatch; socket.close();
    const requests = samples.filter(s => s.operation !== 'fixture');
    const maximumSampledActiveMs = Math.max(...requests.map(s => s.sampledActiveMs));
    const evidence = { method: 'V8 CPU Profiler, 100us requested sampling; active samples exclude idle/root; profile wall duration is reported separately. Includes runtime/native callback samples and profiler overhead. Local measurements are not provider-billed CPU.', conclusion: 'INCONCLUSIVE: sparse Windows samples and multi-millisecond scheduling gaps do not establish Free 10ms headroom; no PASS is claimed.', onlineFree10msVerified: false, maximumSampledActiveMs, requests, fixtureRequests: samples.filter(s => s.operation === 'fixture') };
    await writeFile('audit/pages-free/cpu-profile.json', JSON.stringify(evidence, null, 2));
    return { cpuProfileRequests: requests.length, maximumSampledActiveMs, onlineFree10msVerified: false };
  };
}
