import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import vm from "node:vm";

import {
  compareSemanticVersion,
  parseSemanticVersion,
} from "../shared/semantic-version.mjs";

const execFileAsync = promisify(execFile);

test("parses stable and authorized prerelease semantic versions", () => {
  assert.deepEqual(parseSemanticVersion("1.3.1"), {
    version: "1.3.1",
    major: 1,
    minor: 3,
    patch: 1,
    prerelease: [],
  });
  assert.deepEqual(parseSemanticVersion("1.3.1-b"), {
    version: "1.3.1-b",
    major: 1,
    minor: 3,
    patch: 1,
    prerelease: ["b"],
  });
  assert.equal(parseSemanticVersion("v1.3.1").version, "1.3.1");
  assert.deepEqual(parseSemanticVersion("v1.3.1-b"), {
    version: "1.3.1-b",
    major: 1,
    minor: 3,
    patch: 1,
    prerelease: ["b"],
  });
  assert.equal(parseSemanticVersion("0.0.0").version, "0.0.0");
  assert.equal(parseSemanticVersion("12.34.56-rc.1").version, "12.34.56-rc.1");
});

test("rejects malformed, ambiguous, path-like, and unauthorized versions", () => {
  for (const version of [
    "1.3.1-B",
    "1.3.1-",
    "1.03.1-b",
    "01.3.1",
    "1.3.01",
    "1.3.1_b",
    "1.3.1/b",
    "1.3.1\\b",
    "../1.3.1",
    "1.3.1+build.1",
    "1.3.1-b+build.1",
    "1.3.1-01",
    "1.3",
    "",
  ]) {
    assert.throws(
      () => parseSemanticVersion(version),
      { name: "TypeError" },
      version || "empty input",
    );
  }
});

test("orders prerelease versions below their stable release", () => {
  assert.equal(compareSemanticVersion("1.3.0", "1.3.1-b"), -1);
  assert.equal(compareSemanticVersion("1.3.1-b", "1.3.1"), -1);
  assert.equal(compareSemanticVersion("1.3.1", "1.3.1"), 0);
  assert.equal(compareSemanticVersion("1.3.1", "1.3.1-b"), 1);

  const versions = ["1.3.1", "1.3.0", "1.3.1-b"];
  versions.sort(compareSemanticVersion);
  assert.deepEqual(versions, ["1.3.0", "1.3.1-b", "1.3.1"]);
});

test("module evaluation stays browser-safe when a process shim has no argv", async () => {
  const source = await readFile(new URL("../shared/semantic-version.mjs", import.meta.url), "utf8");
  const browserSource = source.replaceAll(/^export /gmu, "");
  assert.doesNotThrow(() => vm.runInNewContext(browserSource, { process: {}, console }));
});

test("the controlled CLI returns only the canonical version", async () => {
  for (const [input, expected] of [
    ["1.3.1", "1.3.1"],
    ["v1.3.1-b", "1.3.1-b"],
  ]) {
    const result = await execFileAsync(
      process.execPath,
      ["shared/semantic-version.mjs", "parse", input],
      { cwd: process.cwd() },
    );
    assert.equal(result.stdout, `${expected}\n`);
    assert.equal(result.stderr, "");
  }

  await assert.rejects(
    execFileAsync(
      process.execPath,
      ["shared/semantic-version.mjs", "parse", "1.3.1+build.1"],
      { cwd: process.cwd() },
    ),
  );
});
