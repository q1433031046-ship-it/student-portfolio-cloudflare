import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deployScriptPath = "scripts/cloudflare-deploy.mjs";

test("all bridge Wrangler calls disable provisioning and draft auto-create", async () => {
  const source = await readFile(deployScriptPath, "utf8");

  const safetyStart = source.indexOf("const BRIDGE_NO_PROVISION_ARGS");
  const safetyEnd = source.indexOf("const BRIDGE_UNSUPPORTED_RESOURCE_CONFIG_FIELDS");
  assert.ok(safetyStart >= 0 && safetyEnd > safetyStart, "bridge Wrangler safety constants must exist");
  const safety = source.slice(safetyStart, safetyEnd);

  assert.match(safety, /--experimental-provision=false/u);
  assert.match(safety, /--experimental-auto-create=false/u);
  assert.match(
    safety,
    /const BRIDGE_SAFE_DEPLOY_ARGS[\s\S]*\.\.\.BRIDGE_NO_PROVISION_ARGS[\s\S]*--autoconfig=false/u,
  );

  const bridgeStart = source.indexOf("async function runWorkersBuildsUpgrade");
  const bridgeEnd = source.indexOf("async function main()");
  assert.ok(bridgeStart >= 0 && bridgeEnd > bridgeStart, "workers-builds bridge implementation must exist");
  const bridge = source.slice(bridgeStart, bridgeEnd);

  assert.match(bridge, /const commonArgs = \[[\s\S]*\.\.\.BRIDGE_NO_PROVISION_ARGS/u);
  assert.equal(
    (bridge.match(/\.\.\.BRIDGE_NO_PROVISION_ARGS/gu) ?? []).length,
    4,
    "status/version reads and all D1 list/apply/re-list calls must inherit both negative resource flags",
  );
  assert.match(bridge, /\.\.\.BRIDGE_SAFE_DEPLOY_ARGS/u);
});

test("bridge deploy keeps strict vars preservation while adding deploy-only autoconfig shutdown", async () => {
  const source = await readFile(deployScriptPath, "utf8");
  const bridgeStart = source.indexOf("async function runWorkersBuildsUpgrade");
  const bridgeEnd = source.indexOf("async function main()");
  const bridge = source.slice(bridgeStart, bridgeEnd);

  assert.match(bridge, /"--keep-vars"/u);
  assert.match(bridge, /"--strict"/u);
  assert.match(bridge, /\.\.\.BRIDGE_SAFE_DEPLOY_ARGS/u);
});
