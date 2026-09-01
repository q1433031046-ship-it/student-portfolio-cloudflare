import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";

const execFileAsync = promisify(execFile);

function extractResolverShell(workflow) {
  workflow = workflow.replace(/\r\n/gu, "\n");
  const stepMarker = "      - name: Resolve the exact owner-approved release PR\n";
  const stepOffset = workflow.indexOf(stepMarker);
  assert.notEqual(stepOffset, -1, "release command resolver is missing");
  const runMarker = "        run: |\n";
  const runOffset = workflow.indexOf(runMarker, stepOffset);
  assert.notEqual(runOffset, -1, "release command resolver shell is missing");
  const endOffset = workflow.indexOf("\n  verify-and-tag:\n", runOffset);
  assert.notEqual(endOffset, -1, "release command resolver end is missing");
  return workflow
    .slice(runOffset + runMarker.length, endOffset)
    .split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n");
}

async function runResolver(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "portfolio-release-command-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const output = join(root, "github-output");
  const log = join(root, "gh-log");
  await mkdir(bin);
  await writeFile(output, "");
  await writeFile(log, "");

  const fakeGh = join(bin, "gh");
  const shellShebang = (process.env.RELEASE_TEST_SH ?? "/usr/bin/env sh").replaceAll("\\", "/");
  await writeFile(fakeGh, `#!${shellShebang}
set -eu
printf '%s\\n' "$*" >> "$FAKE_GH_LOG"
case "$*" in
  *"/pulls/"*)
    printf '%s\\n' "$FAKE_PR_JSON"
    exit 0
    ;;
  *"/git/ref/heads/main"*)
    printf '%s\\n' "$FAKE_MAIN_SHA"
    exit 0
    ;;
esac
printf 'unexpected gh call: %s\\n' "$*" >&2
exit 64
`);
  await chmod(fakeGh, 0o755);

  const fakeJq = join(bin, "jq");
  const fakeJqProgram = join(bin, "fake-jq.cjs");
  await writeFile(fakeJqProgram, `
const fs = require("node:fs");
const document = JSON.parse(fs.readFileSync(0, "utf8"));
const query = process.argv.at(-1);
const value = query
  .replace(/^\\./u, "")
  .split(".")
  .reduce((current, key) => current?.[key], document);
if (value === undefined || value === null) process.exit(1);
process.stdout.write(String(value) + "\\n");
`);
  await writeFile(fakeJq, `#!${shellShebang}
exec "${process.execPath.replaceAll("\\", "/")}" "${fakeJqProgram.replaceAll("\\", "/")}" "$@"
`);
  await chmod(fakeJq, 0o755);

  const repository = "owner/student-portfolio-cloudflare";
  const candidateSha = "a".repeat(40);
  const mainSha = "b".repeat(40);
  const pr = {
    state: "open",
    draft: false,
    base: { ref: "main", repo: { full_name: repository } },
    head: { ref: "release/v1.3.1", repo: { full_name: repository }, sha: candidateSha },
    ...overrides.pr,
  };
  const workflow = await readFile(".github/workflows/release-command.yml", "utf8");
  const shell = extractResolverShell(workflow);
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    COMMENT_ACTOR: "owner",
    COMMENT_BODY: "/verify-and-tag v1.3.1",
    PR_NUMBER: "12",
    REPOSITORY: repository,
    REPOSITORY_OWNER: "owner",
    GH_TOKEN: "test-token",
    GITHUB_OUTPUT: output,
    FAKE_GH_LOG: log,
    FAKE_PR_JSON: JSON.stringify(pr),
    FAKE_MAIN_SHA: mainSha,
    ...overrides.env,
  };

  try {
    const result = await execFileAsync(process.env.RELEASE_TEST_BASH ?? "bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", shell], {
      cwd: process.cwd(),
      env,
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr, output: await readFile(output, "utf8"), log: await readFile(log, "utf8") };
  } catch (error) {
    return {
      status: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      output: await readFile(output, "utf8"),
      log: await readFile(log, "utf8"),
    };
  }
}

test("the owner command resolves only GitHub-supplied release and main SHAs", async (t) => {
  const result = await runResolver(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, [
    `candidate_sha=${"a".repeat(40)}`,
    `base_main_sha=${"b".repeat(40)}`,
    "confirm_version=1.3.1",
    "",
  ].join("\n"));
  assert.match(result.log, /pulls\/12/u);
  assert.match(result.log, /git\/ref\/heads\/main/u);
});

test("the owner command preserves an exact SemVer prerelease identity", async (t) => {
  const repository = "owner/student-portfolio-cloudflare";
  const candidateSha = "a".repeat(40);
  const version = "1.3.1-b";
  const result = await runResolver(t, {
    env: { COMMENT_BODY: `/verify-and-tag v${version}` },
    pr: {
      state: "open",
      draft: false,
      base: { ref: "main", repo: { full_name: repository } },
      head: { ref: `release/v${version}`, repo: { full_name: repository }, sha: candidateSha },
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.output, /^confirm_version=1\.3\.1-b$/mu);
});

test("a non-owner or malformed command fails before reading pull-request data", async (t) => {
  const nonOwner = await runResolver(t, { env: { COMMENT_ACTOR: "collaborator" } });
  assert.notEqual(nonOwner.status, 0);
  assert.match(nonOwner.stderr, /Only the repository owner/u);
  assert.equal(nonOwner.log, "");

  const malformed = await runResolver(t, { env: { COMMENT_BODY: "/verify-and-tag v1.3" } });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /exact command/u);
  assert.equal(malformed.log, "");

  for (const command of [
    "/verify-and-tag v1.3.1-B",
    "/verify-and-tag v1.3.1-",
    "/verify-and-tag v1.03.1-b",
    "/verify-and-tag v1.3.1_b",
    "/verify-and-tag v1.3.1/b",
    "/verify-and-tag v1.3.1-b+build.1",
  ]) {
    const invalidPrerelease = await runResolver(t, { env: { COMMENT_BODY: command } });
    assert.notEqual(invalidPrerelease.status, 0, command);
    assert.match(invalidPrerelease.stderr, /exact command/u);
    assert.equal(invalidPrerelease.log, "");
  }
});

test("forks, wrong branches and draft release pull requests fail closed", async (t) => {
  const fork = await runResolver(t, {
    pr: {
      state: "open",
      draft: false,
      base: { ref: "main", repo: { full_name: "owner/student-portfolio-cloudflare" } },
      head: { ref: "release/v1.3.1", repo: { full_name: "fork/student-portfolio-cloudflare" }, sha: "a".repeat(40) },
    },
  });
  assert.notEqual(fork.status, 0);
  assert.match(fork.stderr, /must come from release\/v1\.3\.1/u);

  const wrongBranch = await runResolver(t, {
    pr: {
      state: "open",
      draft: false,
      base: { ref: "main", repo: { full_name: "owner/student-portfolio-cloudflare" } },
      head: { ref: "feature/mobile", repo: { full_name: "owner/student-portfolio-cloudflare" }, sha: "a".repeat(40) },
    },
  });
  assert.notEqual(wrongBranch.status, 0);
  assert.match(wrongBranch.stderr, /must come from release\/v1\.3\.1/u);

  const draft = await runResolver(t, {
    pr: {
      state: "open",
      draft: true,
      base: { ref: "main", repo: { full_name: "owner/student-portfolio-cloudflare" } },
      head: { ref: "release/v1.3.1", repo: { full_name: "owner/student-portfolio-cloudflare" }, sha: "a".repeat(40) },
    },
  });
  assert.notEqual(draft.status, 0);
  assert.match(draft.stderr, /review-ready/u);
});

test("all protected release stages use the shared controlled parser", async () => {
  const [commandWorkflow, releaseWorkflow] = await Promise.all([
    readFile(".github/workflows/release-command.yml", "utf8"),
    readFile(".github/workflows/release-verify.yml", "utf8"),
  ]);

  assert.match(commandWorkflow, /node shared\/semantic-version\.mjs parse/u);
  assert.match(releaseWorkflow, /\$\{GITHUB_WORKFLOW_SHA\}:shared\/semantic-version\.mjs/u);
  assert.match(releaseWorkflow, /parser_path="\$RUNNER_TEMP\/semantic-version\.mjs"/u);
  assert.match(releaseWorkflow, /node "\$parser_path" parse/u);
  assert.match(releaseWorkflow, /node shared\/semantic-version\.mjs parse/u);
  assert.doesNotMatch(commandWorkflow, /COMMENT_BODY" =~/u);
  assert.doesNotMatch(releaseWorkflow, /confirm_version" =~/u);
});
