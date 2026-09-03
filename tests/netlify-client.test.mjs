import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const {
  NetlifyClient,
  NetlifyClientError,
  classifyNetlifyRedirect,
  serializeTransportEvidence,
} = await import("../app/api/_lib/netlify-client.ts");

const hookUrl = "https://api.netlify.com/build_hooks/hook_123";
const requestKey = "sp-aaaaaaaaaaaaaaaaaaaaaaaa";

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function textResponse(value, status = 200, headers = {}) {
  return new Response(value, { status, headers });
}

function makeHookClient(result) {
  const calls = [];
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (result instanceof Error || (typeof result === "object" && result !== null && "name" in result && !("status" in result))) throw result;
    return result;
  });
  return { client, calls };
}

function segmentedCanary() {
  // Keep the complete value out of source and out of any assertion message.
  return ["hook", "-canary", "-", "value", "-", "9f3a"].join("");
}

async function triggerWith(responseOrError, key = requestKey) {
  const { client, calls } = makeHookClient(responseOrError);
  const outcome = await client.triggerDraftBuild(hookUrl, { jobId: "job-1" }, key).then(
    (value) => ({ value, error: null }),
    (error) => ({ value: null, error }),
  );
  return { ...outcome, calls };
}

test("Hook 2xx JSON body is accepted without using body as identity evidence", async () => {
  const result = await triggerWith(jsonResponse({ deploy_id: "provider-body-is-not-identity" }));
  assert.equal(result.error, null);
  assert.equal(result.value.evidence.responseReceived, true);
  assert.equal(result.value.evidence.statusClass, "success");
  assert.equal(result.value.evidence.deployMatch, "unknown");
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].init.redirect, "manual");
  assert.equal("providerReceived" in result.value.evidence, false);
});

test("Hook 2xx empty body is accepted", async () => {
  const result = await triggerWith(new Response(null, { status: 204 }));
  assert.equal(result.error, null);
  assert.equal(result.value.evidence.httpStatus, 204);
  assert.equal(result.calls.length, 1);
});

test("Hook 2xx text body is accepted even when it is not JSON", async () => {
  const result = await triggerWith(textResponse("accepted as text", 201));
  assert.equal(result.error, null);
  assert.equal(result.value.evidence.httpStatus, 201);
  assert.equal(result.calls.length, 1);
});

test("an invalid Response shape is recorded as received but with unknown status", async () => {
  const result = await triggerWith({ status: "not-a-status" });
  assert.equal(result.error.code, "NETLIFY_BUILD_TRIGGER_UNKNOWN");
  assert.equal(result.error.evidence.responseReceived, true);
  assert.equal(result.error.evidence.httpStatus, null);
  assert.equal(result.error.evidence.triggerCallCount, 1);
  assert.equal(result.calls.length, 1);
});

test("all first-hop 3xx responses are observed manually and never followed", async () => {
  for (const status of [300, 301, 302, 303, 307, 308, 399]) {
    const result = await triggerWith(textResponse("redirect body", status, { Location: "https://api.netlify.com/build_hooks/other" }));
    assert.equal(result.error.code, "NETLIFY_BUILD_TRIGGER_REDIRECT");
    assert.equal(result.error.evidence.statusClass, "redirect");
    assert.equal(result.error.evidence.redirectOccurred, true);
    assert.equal(result.error.evidence.locationClass, "same_exact_netlify_origin");
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].init.redirect, "manual");
  }
});

test("redirect to an unapproved host fails closed without a second fetch", async () => {
  const result = await triggerWith(textResponse("redirect body", 302, { Location: "https://external.example.invalid/second-hop" }));
  assert.equal(result.error.code, "NETLIFY_BUILD_TRIGGER_REDIRECT");
  assert.equal(result.error.evidence.locationClass, "external_or_unapproved");
  assert.equal(result.calls.length, 1);
});

test("missing, invalid, and looping Location values are classified without retaining them", async () => {
  const cases = [
    [new Headers(), "missing"],
    [new Headers({ Location: "https://[invalid" }), "invalid"],
    [new Headers({ Location: "javascript:alert(1)" }), "invalid"],
    [new Headers({ Location: hookUrl }), "loop"],
  ];
  for (const [headers, expected] of cases) {
    const result = await triggerWith(textResponse("redirect body", 302, headers));
    assert.equal(result.error.evidence.locationClass, expected);
    assert.equal(result.error.evidence.redirectOccurred, true);
    assert.equal(result.calls.length, 1);
    assert.equal("location" in result.error, false);
  }
});

test("a redirect that would require a second hop is blocked before any target fetch", async () => {
  const calls = [];
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return textResponse("redirect", 307, { Location: "https://netlify.com/second-hop" });
  });
  await assert.rejects(client.triggerDraftBuild(hookUrl, { jobId: "job-1" }, requestKey), (error) => {
    assert.equal(error.evidence.locationClass, "netlify_official_but_unapproved");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("Hook 401 and 403 preserve reauthorization semantics", async () => {
  for (const status of [401, 403]) {
    const result = await triggerWith(textResponse("auth body", status));
    assert.equal(result.error.code, "NETLIFY_REAUTHORIZATION_REQUIRED");
    assert.equal(result.error.evidence.statusClass, "unauthorized");
    assert.equal(result.error.evidence.responseReceived, true);
    assert.equal(result.calls.length, 1);
  }
});

test("Hook 429 has a stable rate-limit code", async () => {
  const result = await triggerWith(textResponse("rate body", 429));
  assert.equal(result.error.code, "NETLIFY_RATE_LIMITED");
  assert.equal(result.error.evidence.statusClass, "rate_limited");
  assert.equal(result.calls.length, 1);
});

test("other 4xx and 5xx Hook responses have stable classes", async () => {
  for (const [status, code, statusClass] of [
    [400, "NETLIFY_BUILD_TRIGGER_CLIENT_ERROR", "client_error"],
    [404, "NETLIFY_BUILD_TRIGGER_CLIENT_ERROR", "client_error"],
    [500, "NETLIFY_BUILD_TRIGGER_SERVER_ERROR", "server_error"],
    [503, "NETLIFY_BUILD_TRIGGER_SERVER_ERROR", "server_error"],
  ]) {
    const result = await triggerWith(textResponse("provider error body", status));
    assert.equal(result.error.code, code);
    assert.equal(result.error.evidence.statusClass, statusClass);
    assert.equal(result.error.evidence.httpStatus, status);
    assert.equal(result.calls.length, 1);
  }
});

test("TypeError, AbortError, and unknown exceptions are distinguished", async () => {
  const cases = [
    [new TypeError("transport exception"), "NETLIFY_BUILD_TRIGGER_TYPE_ERROR", "TypeError", "network_error"],
    [new DOMException("cancelled", "AbortError"), "NETLIFY_BUILD_TRIGGER_ABORTED", "AbortError", "timeout"],
    [{ name: "UnexpectedError", message: "unknown exception" }, "NETLIFY_BUILD_TRIGGER_UNKNOWN", "unknown", "unknown"],
  ];
  for (const [thrown, code, exceptionClass, statusClass] of cases) {
    const result = await triggerWith(thrown);
    assert.equal(result.error.code, code);
    assert.equal(result.error.evidence.exceptionClass, exceptionClass);
    assert.equal(result.error.evidence.statusClass, statusClass);
    assert.equal(result.error.evidence.responseReceived, false);
    assert.equal(result.error.evidence.triggerCallCount, 1);
    assert.equal(result.calls.length, 1);
  }
});

test("fetch exception remains provider-received unknown rather than a guessed negative", async () => {
  const result = await triggerWith(new TypeError("provider may have received the request"));
  assert.equal(result.error.evidence.deployMatch, "unknown");
  assert.equal("providerReceived" in result.error.evidence, false);
});

test("a lost Hook response can recover one exact Deploy without another Hook POST", async () => {
  const calls = [];
  const deploy = { id: "recovered", site_id: "site-1", branch: "static-build/v1.3.1-b", title: requestKey,
    state: "ready", created_at: "2026-09-01T00:05:00.000Z" };
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (init.method === "POST") throw new TypeError("response lost after provider may have received it");
    return jsonResponse([deploy]);
  });
  await assert.rejects(client.triggerDraftBuild(hookUrl, { jobId: "job-1" }, requestKey));
  const recovered = await client.findDeployByRequestKey("site-1", requestKey, new Date("2026-09-01T00:00:00Z"));
  assert.equal(recovered?.id, "recovered");
  assert.equal(calls.filter((call) => call.init.method === "POST").length, 1);
  assert.equal(calls.filter((call) => call.init.method !== "POST").length, 1);
});

test("invalid Hook or request key performs zero POST calls and records zero invocation", async () => {
  const { client, calls } = makeHookClient(new Response(null, { status: 204 }));
  await assert.rejects(client.triggerDraftBuild("https://evil.example.invalid/hook", {}, requestKey), (error) => {
    assert.equal(error.code, "NETLIFY_HOOK_INVALID");
    assert.equal(error.evidence.triggerCallCount, 0);
    return true;
  });
  await assert.rejects(client.triggerDraftBuild(hookUrl, {}, "bad key with spaces"), (error) => {
    assert.equal(error.code, "NETLIFY_REQUEST_KEY_INVALID");
    assert.equal(error.evidence.triggerCallCount, 0);
    return true;
  });
  assert.equal(calls.length, 0);
});

test("one Job/generation has at most one actual Hook POST, including failure", async () => {
  let calls = 0;
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => {
    calls += 1;
    throw new TypeError("response may be lost");
  });
  await assert.rejects(client.triggerDraftBuild(hookUrl, {}, requestKey));
  assert.equal(calls, 1);
});

test("NetlifyClientError and evidence are enumerable only through safe fields", async () => {
  const canary = segmentedCanary();
  const result = await triggerWith(new TypeError(canary));
  const error = result.error;
  const serialized = JSON.stringify(error);
  assert.equal(serialized.includes(canary), false);
  assert.equal(String(error).includes(canary), false);
  assert.equal(error.stack, undefined);
  assert.equal("cause" in error, false);
  for (const key of Object.keys(error)) assert.ok(["name", "code", "status", "evidence"].includes(key));
  const evidenceKeys = Object.keys(error.evidence);
  assert.deepEqual(evidenceKeys.sort(), [
    "attemptedAt", "deployMatch", "exceptionClass", "httpStatus", "locationClass", "providerRequestKey",
    "redirectOccurred", "responseReceived", "statusClass", "triggerCallCount",
  ].sort());
});

test("Hook diagnostics keep URL, token, bootstrap, Location and exception canaries out of every console path", async () => {
  const canaries = {
    hookUrl: ["https://api.netlify.com/build_hooks/", "hook-secret-canary-9f3a"].join(""),
    token: ["token", "-secret-canary-9f3a"].join(""),
    bootstrap: ["bootstrap", "-secret-canary-9f3a"].join(""),
    location: ["https://external.example.invalid/", "location-secret-canary-9f3a"].join(""),
    exception: ["exception", "-secret-canary-9f3a"].join(""),
  };
  const output = [];
  const methods = ["log", "info", "warn", "error"];
  const originals = Object.fromEntries(methods.map((method) => [method, console[method]]));
  for (const method of methods) console[method] = (...values) => output.push(values.map(String).join(" "));
  try {
    const client = new NetlifyClient(canaries.token, "https://example.test", async () => {
      throw new TypeError(canaries.exception);
    });
    await client.triggerDraftBuild(canaries.hookUrl, { bootstrapGrant: canaries.bootstrap }, requestKey).catch(() => undefined);
    await triggerWith(textResponse("body", 302, { Location: canaries.location }));
  } finally {
    for (const method of methods) console[method] = originals[method];
  }
  const safe = output.join("\n");
  for (const canary of Object.values(canaries)) assert.equal(safe.includes(canary), false);
});

test("transport evidence serialization re-sanitizes malformed values", () => {
  const canary = segmentedCanary();
  const serialized = serializeTransportEvidence({
    providerRequestKey: canary,
    attemptedAt: canary,
    responseReceived: "yes",
    httpStatus: canary,
    statusClass: canary,
    redirectOccurred: "yes",
    locationClass: canary,
    exceptionClass: canary,
    deployMatch: canary,
    triggerCallCount: 7,
    deployIdHash: canary,
  });
  assert.equal(serialized.includes(canary), false);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.providerRequestKey, "unknown");
  assert.equal(parsed.attemptedAt, "unknown");
  assert.equal(parsed.triggerCallCount, 0);
});

test("redirect classifier never returns a raw location", () => {
  const canary = segmentedCanary();
  const classification = classifyNetlifyRedirect(canary, hookUrl);
  assert.equal(classification, "same_exact_netlify_origin");
  assert.equal(typeof classification, "string");
});

test("findDeployByRequestKey requires exact Site, branch, request key and time window", async () => {
  const deployments = [
    { id: "right", site_id: "site-1", branch: "static-build/v1.3.1-b", title: requestKey, created_at: "2026-09-01T00:05:00.000Z" },
    { id: "wrong-branch", site_id: "site-1", branch: "main", title: requestKey, created_at: "2026-09-01T00:05:00.000Z" },
    { id: "wrong-key", site_id: "site-1", branch: "static-build/v1.3.1-b", title: "sp-bbbbbbbbbbbbbbbbbbbbbbbb", created_at: "2026-09-01T00:05:00.000Z" },
    { id: "too-late", site_id: "site-1", branch: "static-build/v1.3.1-b", title: requestKey, created_at: "2026-09-01T01:00:00.000Z" },
  ];
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => jsonResponse(deployments));
  assert.equal((await client.findDeployByRequestKey("site-1", requestKey, new Date("2026-09-01T00:00:00Z")))?.id, "right");
});

test("ambiguous exact request key fails closed", async () => {
  const deploy = { site_id: "site-1", branch: "static-build/v1.3.1-b", title: requestKey, created_at: "2026-09-01T00:05:00.000Z" };
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => jsonResponse([{ ...deploy, id: "a" }, { ...deploy, id: "b" }]));
  await assert.rejects(client.findDeployByRequestKey("site-1", requestKey, new Date("2026-09-01T00:00:00Z")), (error) => {
    assert.equal(error.code, "NETLIFY_DEPLOY_AMBIGUOUS");
    return true;
  });
});

test("zero, unique, and multiple Deploy outcomes are explicit and never trigger a Hook", async () => {
  const none = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => jsonResponse([]));
  assert.equal(await none.findDeployByRequestKey("site-1", requestKey, new Date("2026-09-01T00:00:00Z")), null);
  const unique = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => jsonResponse([{
    id: "one", site_id: "site-1", branch: "static-build/v1.3.1-b", title: requestKey, created_at: "2026-09-01T00:05:00.000Z",
  }]));
  assert.equal((await unique.findDeployByRequestKey("site-1", requestKey, new Date("2026-09-01T00:00:00Z")))?.id, "one");
});

test("API status and exception errors are stable and do not expose provider body", async () => {
  for (const [status, code] of [[401, "NETLIFY_REAUTHORIZATION_REQUIRED"], [403, "NETLIFY_REAUTHORIZATION_REQUIRED"],
    [429, "NETLIFY_RATE_LIMITED"], [404, "NETLIFY_API_CLIENT_ERROR"], [502, "NETLIFY_API_SERVER_ERROR"]]) {
    const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => textResponse("api-body-canary", status));
    await assert.rejects(client.listDeploys("site-1"), (error) => {
      assert.equal(error.code, code);
      assert.equal(String(error).includes("api-body-canary"), false);
      return true;
    });
  }
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => {
    throw new TypeError("api exception canary");
  });
  await assert.rejects(client.listDeploys("site-1"), (error) => {
    assert.equal(error.code, "NETLIFY_API_TYPE_ERROR");
    assert.equal(String(error).includes("api exception canary"), false);
    return true;
  });
});

test("publishExistingDeploy restores and reads only the same verified Deploy", async () => {
  const calls = [];
  const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async (url, init = {}) => {
    calls.push([String(url), init.method ?? "GET"]);
    return jsonResponse({ id: "deploy-1", site_id: "site-1", state: "ready" });
  });
  assert.equal((await client.publishExistingDeploy("site-1", "deploy-1")).id, "deploy-1");
  assert.deepEqual(calls.map((call) => call[1]), ["GET", "POST"]);
  assert.match(calls[1][0], /deploys\/deploy-1\/restore$/u);
});

test("site readback binds the published Deploy to the same Site", async () => {
  const good = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => jsonResponse({
    id: "site-1", published_deploy: { id: "deploy-1", site_id: "site-1", state: "ready" },
  }));
  assert.equal((await good.getSite("site-1")).published_deploy.id, "deploy-1");
  for (const body of [
    { id: "site-2" },
    { id: "site-1", published_deploy: { id: "deploy-1", site_id: "site-2", state: "ready" } },
  ]) {
    const client = new NetlifyClient("token-that-is-long-enough", "https://example.test", async () => jsonResponse(body));
    await assert.rejects(client.getSite("site-1"), (error) => error instanceof NetlifyClientError && /MISMATCH/u.test(error.code));
  }
});
