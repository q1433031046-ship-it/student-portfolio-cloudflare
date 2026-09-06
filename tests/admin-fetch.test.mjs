import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { fetchAdmin } = await import("../app/admin/admin-fetch.ts");

test("admin requests abort a hung browser fetch with a bounded Chinese error", async () => {
  const originalFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = async (_input, init) => {
    await new Promise((resolve) => init?.signal?.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
    throw new DOMException("aborted", "AbortError");
  };
  try {
    await assert.rejects(fetchAdmin("/api/admin/static-site", {}, 20), (error) => error?.message === "后台响应超时，请稍后重试");
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin fetch keeps explicit credentials and cache settings", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (_input, init) => {
    captured = init;
    return new Response("ok");
  };
  try {
    await fetchAdmin("/api/admin/setup", { credentials: "include", cache: "reload" });
    assert.equal(captured.credentials, "include");
    assert.equal(captured.cache, "reload");
    assert.ok(captured.signal instanceof AbortSignal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
