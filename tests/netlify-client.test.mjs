import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { NetlifyClient, NetlifyClientError } = await import("../app/api/_lib/netlify-client.ts");

function response(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }

test("findDeployByRequestKey requires exact site, branch, request key and time window", async () => {
  const deployments = [
    { id: "right", site_id: "site-1", branch: "static-build/v1.3.1-b", title: "sp-aaaaaaaaaaaaaaaaaaaaaaaa", created_at: "2026-09-01T00:05:00.000Z" },
    { id: "wrong-branch", site_id: "site-1", branch: "main", title: "sp-aaaaaaaaaaaaaaaaaaaaaaaa", created_at: "2026-09-01T00:05:00.000Z" },
    { id: "wrong-key", site_id: "site-1", branch: "static-build/v1.3.1-b", title: "sp-bbbbbbbbbbbbbbbbbbbbbbbb", created_at: "2026-09-01T00:05:00.000Z" },
  ];
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => response(deployments));
  assert.equal((await client.findDeployByRequestKey("site-1", "sp-aaaaaaaaaaaaaaaaaaaaaaaa", new Date("2026-09-01T00:00:00Z")))?.id, "right");
});

test("ambiguous provider request key fails closed", async () => {
  const deploy = { site_id: "site-1", branch: "static-build/v1.3.1-b", title: "sp-aaaaaaaaaaaaaaaaaaaaaaaa", created_at: "2026-09-01T00:05:00.000Z" };
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => response([{ ...deploy, id: "a" }, { ...deploy, id: "b" }]));
  await assert.rejects(client.findDeployByRequestKey("site-1", deploy.title, new Date("2026-09-01T00:00:00Z")), (error) => error.code === "NETLIFY_DEPLOY_AMBIGUOUS");
});

test("publishExistingDeploy restores only the already verified deploy", async () => {
  const calls = [];
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async (url, init = {}) => {
    calls.push([String(url), init.method ?? "GET"]);
    return response({ id: "deploy-1", site_id: "site-1", state: "ready" });
  });
  assert.equal((await client.publishExistingDeploy("site-1", "deploy-1")).id, "deploy-1");
  assert.deepEqual(calls.map((call) => call[1]), ["GET", "POST"]);
  assert.match(calls[1][0], /deploys\/deploy-1\/restore$/u);
});

test("hook response loss can recover the unique original deploy without triggering again", async () => {
  const calls = [];
  const deployments = [{ id: "original", site_id: "site-1", branch: "static-build/v1.3.1-b",
    title: "sp-aaaaaaaaaaaaaaaaaaaaaaaa", created_at: "2026-09-01T00:05:00.000Z", state: "ready" }];
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async (url, init = {}) => {
    calls.push([String(url), init.method ?? "GET"]);
    return response(deployments);
  });
  const found = await client.findDeployByRequestKey("site-1", "sp-aaaaaaaaaaaaaaaaaaaaaaaa", new Date("2026-09-01T00:00:00Z"));
  assert.equal(found?.id, "original");
  assert.deepEqual(calls.map((call) => call[1]), ["GET"]);
});

test("site readback binds the published deploy to the same site", async () => {
  const good = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => response({
    id: "site-1", published_deploy: { id: "deploy-1", site_id: "site-1", state: "ready" },
  }));
  assert.equal((await good.getSite("site-1")).published_deploy.id, "deploy-1");
  for (const body of [
    { id: "site-2" },
    { id: "site-1", published_deploy: { id: "deploy-1", site_id: "site-2", state: "ready" } },
  ]) {
    const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => response(body));
    await assert.rejects(client.getSite("site-1"), (error) => error instanceof NetlifyClientError && /MISMATCH/u.test(error.code));
  }
});

test("401, 403 and 429 map to stable fail-closed codes", async () => {
  for (const [status, code] of [[401, "NETLIFY_REAUTHORIZATION_REQUIRED"], [403, "NETLIFY_REAUTHORIZATION_REQUIRED"], [429, "NETLIFY_RATE_LIMITED"]]) {
    const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => response({}, status));
    await assert.rejects(client.listDeploys("site-1"), (error) => error instanceof NetlifyClientError && error.code === code);
  }
});
