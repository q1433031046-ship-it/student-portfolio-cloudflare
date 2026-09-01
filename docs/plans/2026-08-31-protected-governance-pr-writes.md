# Protected Governance PR Writes Implementation Plan

> **For implementation:** Execute this plan task-by-task with the workflow available in the current environment. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `governance-state` change pass through two sequential, status-gated pull requests while preserving owner-only commands, record-first ordering, remote Candidate verification, and compare-and-swap behavior.

**Architecture:** The trusted `main` workflow validates the requested transition, commits the immutable record on a short-lived proposal branch, marks the fixed `governance-state-write` status, and merges a PR whose base is the exact current `governance-state` tip. It then repeats the process for `current.json` and the version snapshot from the newly merged tip. The repository ruleset has an empty bypass list and requires pull requests, the fixed status, an up-to-date branch, deletion protection, and force-push protection.

**Tech Stack:** GitHub Actions YAML, Bash, GitHub CLI/REST API, Node.js 22, `node:test`, JSON governance contracts.

**Spec:** `governance/README.md`, `governance/workflow.md`, `governance/role-contract.json`, and audit `AUD-20260831-GOV-RC-001`.

## Global Constraints

- Product version remains `1.3.0`; no product code, database schema, Migration, Worker, D1, KV, Secret, Release, tag, or production deployment may change.
- Only an exact repository-owner command on an open, non-draft, same-repository PR may start a transition.
- `governance-state` is updated in two ordered phases: immutable record first, state pointer and version snapshot second.
- Every phase must compare the current remote tip with its expected tip immediately before merge and must require the proposal branch to be up to date.
- The target ruleset has no bypass actors and blocks direct updates through the pull-request requirement.
- Cloudflare governance-branch build isolation and the existing fail-closed build guard remain mandatory.

---

### Task 1: Freeze the protected-PR runtime contract

**Files:**
- Modify: `tests/governance-contract.test.mjs`
- Modify: `governance/role-contract.json`
- Modify: `scripts/governance-state.mjs`
- Modify: `governance/README.md`
- Modify: `governance/workflow.md`
- Modify: `governance/roles/super-planning.md`
- Modify: `governance/roles/super-audit.md`
- Modify: `governance/roles/super-work.md`
- Modify: `governance/roles/super-release.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: existing `CANONICAL_RUNTIME` exact allowlist and `validateGovernanceContract(input)`.
- Produces: runtime fields `writeTransport`, `requiredStatusContext`, `pullRequestRequired`, `strictUpToDateRequired`, and unchanged `directPushAllowed: false` for the workflow and tests.

- [x] **Step 1: Write the failing contract test**

```js
assert.equal(contract.runtime.writeTransport, "protected-pull-request");
assert.equal(contract.runtime.requiredStatusContext, "governance-state-write");
assert.equal(contract.runtime.pullRequestRequired, true);
assert.equal(contract.runtime.strictUpToDateRequired, true);
assert.equal(contract.runtime.directPushAllowed, false);
```

- [x] **Step 2: Run the focused test and verify failure**

Run: `node --experimental-strip-types --test --test-name-pattern='protected writer' tests/governance-contract.test.mjs`

Expected: FAIL because the protected-PR fields are absent and the workflow still pushes the state ref directly.

- [x] **Step 3: Add the exact runtime allowlist and positive contract wording**

Add the following exact JSON fields to `governance/role-contract.json#runtime` and the same values to `CANONICAL_RUNTIME`:

```json
{
  "writeTransport": "protected-pull-request",
  "requiredStatusContext": "governance-state-write",
  "pullRequestRequired": true,
  "strictUpToDateRequired": true
}
```

Update all governance-facing documents to state that each phase is a protected PR based on the exact expected tip and that only a successful `governance-state-write` status permits merge.

- [x] **Step 4: Run the focused test**

Run: `node --experimental-strip-types --test --test-name-pattern='protected writer' tests/governance-contract.test.mjs`

Expected: the contract assertions pass; workflow assertions remain red until Task 2.

### Task 2: Replace ref pushes with two protected pull-request merges

**Files:**
- Create: `scripts/governance-protected-write.sh`
- Modify: `.github/workflows/governance-state.yml`
- Modify: `tests/governance-contract.test.mjs`

**Interfaces:**
- Consumes: `GH_TOKEN`, `REPOSITORY`, `REPOSITORY_OWNER`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, a checked-out state worktree, an expected 40-character tip, a phase name, commit message, PR title, and exact paths.
- Produces: `tip=<40-character merged governance-state SHA>` and `pull_request=<number>` through `$GITHUB_OUTPUT` after a successful protected merge.

- [x] **Step 1: Write failing workflow and script assertions**

```js
assert.match(workflow, /pull-requests: write/u);
assert.match(workflow, /statuses: write/u);
assert.match(writer, /governance-state-write/u);
assert.match(writer, /repos\/\$REPOSITORY\/pulls/u);
assert.match(writer, /repos\/\$REPOSITORY\/statuses\/\$head_sha/u);
assert.match(writer, /pulls\/\$pull_request\/merge/u);
assert.match(writer, /remote_tip.*EXPECTED_TIP/su);
assert.doesNotMatch(workflow, /push origin HEAD:refs\/heads\/governance-state/u);
```

- [x] **Step 2: Run the focused test and verify failure**

Run: `node --experimental-strip-types --test --test-name-pattern='protected writer' tests/governance-contract.test.mjs`

Expected: FAIL because the writer script and protected PR calls do not exist.

- [x] **Step 3: Implement the protected writer script**

The script must validate every input, re-read `refs/heads/governance-state`, refuse a tip mismatch, commit only the supplied paths, push a unique `governance-write/<run>-<attempt>-<phase>` proposal branch, create a PR targeting `governance-state`, write status context `governance-state-write`, re-read the target tip, merge only the exact proposal SHA, verify the returned merge SHA equals the new target tip, and emit both outputs. It must not call Wrangler, create tags, or target `main`.

- [x] **Step 4: Wire both governance jobs through the script**

Grant only:

```yaml
permissions:
  contents: write
  issues: write
  pull-requests: write
  statuses: write
```

Call the writer once for the immutable record paths. Fetch and reset the local state worktree to the returned tip, create `current.json` plus the version snapshot, then call the writer a second time with the first returned tip. Apply the same sequence to the one-time bootstrap migration.

- [x] **Step 5: Run syntax and focused tests**

Run: `bash -n scripts/governance-protected-write.sh`

Expected: exit 0.

Run: `node --experimental-strip-types --test --test-name-pattern='protected writer' tests/governance-contract.test.mjs`

Expected: PASS with no direct `governance-state` ref push remaining.

### Task 3: Regress the governance and repository gates

**Files:**
- Modify: `tests/governance-contract.test.mjs`
- Modify only if evidence requires it: `governance/README.md`, `governance/workflow.md`, `AGENTS.md`

**Interfaces:**
- Consumes: completed protected-PR writer and frozen runtime contract.
- Produces: a new fixed Candidate SHA whose tree passes local and GitHub verification without production mutation.

- [x] **Step 1: Add mutation coverage**

Verify tests fail when the status context changes, when the target base changes from `governance-state`, when the remote-tip equality check is removed, when pointer write appears before record write, or when a direct target-branch push is restored.

- [x] **Step 2: Run governance validation**

Run: `npm run governance:validate`

Expected: PASS.

Run: `node --experimental-strip-types --test tests/governance-contract.test.mjs`

Expected: all governance tests pass.

- [x] **Step 3: Run the full repository gate**

Run: `npm test`

Expected: production build succeeds and all Node tests pass.

Run: `npm run lint`

Expected: PASS.

Run: `./node_modules/.bin/tsc --noEmit`

Expected: PASS.

Run: `npm audit --omit=dev --audit-level=high`

Expected: zero high or critical production dependency vulnerabilities.

Run: `npm run db:generate && git status --porcelain --untracked-files=all -- drizzle`

Expected: no migration drift.

Run: `./node_modules/.bin/wrangler deploy --dry-run --keep-vars --config wrangler.jsonc`

Expected: dry run succeeds without a remote deployment.

- [ ] **Step 4: Freeze and publish the Candidate only**

Verify changed paths remain governance-only, commit the tested tree, fast-forward `governance/four-role-auto-handoff`, update PR #13, and wait for GitHub `Complete Verification`. Do not merge, tag, release, or deploy.

- [ ] **Step 5: Configure and verify the repository rule**

Create an active branch ruleset targeting only `governance-state` with an empty bypass list and these rules:

```text
Require a pull request before merging
Require status checks to pass before merging: governance-state-write
Require branches to be up to date before merging
Restrict deletions
Block force pushes
```

Enable `Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests`. Trigger one governance transition only after the fixed Candidate is approved and merged to `main`; verify the record PR merges before the pointer PR and a direct push is rejected.

## Self-review

- Spec coverage: owner-only entry, immutable Candidate verification, strict field transition, record-first ordering, two remote comparisons, no-secret scanning, Cloudflare isolation, and no production mutation each map to an explicit task and gate.
- Placeholder scan: no deferred implementation markers remain.
- Type consistency: contract field names, status context, branch name, workflow permissions, and script outputs are identical across all tasks.
