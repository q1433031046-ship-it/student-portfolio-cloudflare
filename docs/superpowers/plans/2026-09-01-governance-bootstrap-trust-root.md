# Governance Bootstrap Trust Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install an independently audited default-branch governance trust root that can recover the fixed failed bootstrap audit through two real Ruleset-protected pull requests without deploying Cloudflare.

**Architecture:** A default-branch `issue_comment` orchestrator creates deterministic governance proposals and requests a separate default-branch Gate through a fixed `repository_dispatch`; `pull_request_target` is a supplemental trigger for the same Gate. The Gate independently reconstructs each proposal without executing proposal code and creates a Checks API run on the exact proposal head. The protected writer cannot create its own status or Check; it waits for a successful `governance-state-write` Check from GitHub Actions App id `15368`, rechecks the exact state tip and proposal head, and merges through the active Ruleset.

**Tech Stack:** GitHub Actions YAML, Bash, Node.js 22.13.0 ESM, JSON Schema Draft 2020-12, GitHub REST API through `gh`, Node test runner, Cloudflare Workers Builds environment guards.

## Global Constraints

- Governance-only changes; no product behavior changes.
- Do not merge the trust-root PR before role 2 records approval.
- Do not merge PR #13, deploy production, create or modify a formal Release Tag, or mutate Worker, D1, `MEDIA_KV`, or Secrets.
- Keep Ruleset `21936381` active, strict, PR-only, deletion-protected, non-fast-forward-protected, and without bypass actors.
- The required check remains `governance-state-write` and its expected GitHub App is id `15368`.
- Proposal content, branch names, PR bodies, and files are untrusted inputs.
- Neither the dispatched Gate nor `pull_request_target` may checkout or execute proposal code.
- Record files merge before pointer files; every phase uses exact-tip compare-and-swap.
- The fixed failed audit binds PR #13 commit `e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b`, tree `a54f47d5f5b5b54e18454d5faa7a4fc3a403228d`, PR #14 head `9451ef05fbe289aaade134bb60fb1a57e5eb15a6`, and legacy state tip `3e7867d3cdba75045f6dc8aa0448ccaac3547b68`.
- Cloudflare acceptance requires zero new Worker Versions, zero previews, unchanged active deployment, and no Wrangler execution by governance workflows.

---

## File map

- `.github/workflows/governance-state.yml`: trusted command orchestrator and independent proposal gate.
- `scripts/governance-state.mjs`: contract validation, failed-audit migration, deterministic proposal reconstruction, and CLI commands.
- `scripts/governance-protected-write.sh`: protected PR transport and trusted-check polling only.
- `scripts/build-verified.sh`: fail-closed Workers Builds guard before build or upload.
- `governance/role-contract.json`: runtime transport, expected App id, bootstrap-recovery identity, and Cloudflare isolation contract.
- `governance/state-schema.json`: schema-2 state validation.
- `governance/workflow.md`: human protocol and recovery ordering.
- `governance/README.md`: bootstrap activation and retirement procedure.
- `governance/roles/*.md`: role boundaries and intermediate audit requirement.
- `tests/governance-contract.test.mjs`: deterministic unit, drift, writer integration, and build-guard tests.
- `docs/plans/2026-08-31-protected-governance-pr-writes.md`: the original protected-write implementation record carried by the governance Candidate.
- `package.json` and `package-lock.json`: `governance:validate` script metadata only.
- `AGENTS.md`: canonical navigation and protected-writer constraints.
- `docs/superpowers/specs/2026-09-01-governance-bootstrap-trust-root-design.md`: approved design.
- `docs/superpowers/plans/2026-09-01-governance-bootstrap-trust-root.md`: this implementation plan.

### Task 1: Restore an exact local source tree and branch baseline

**Files:**
- Materialize: all tracked files from Candidate commit `e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b`
- Preserve base metadata: `main@d81785dd51bb0c9be339449566a15d3b3971e02a`

**Interfaces:**
- Consumes: GitHub commit/tree/blob APIs.
- Produces: a local test tree byte-identical to Candidate Tree `a54f47d5f5b5b54e18454d5faa7a4fc3a403228d`, excluding no tracked text or binary file.

- [ ] **Step 1: Enumerate the immutable Candidate tree**

Fetch `git/trees/a54f47d5f5b5b54e18454d5faa7a4fc3a403228d?recursive=1` and require `truncated=false`.

- [ ] **Step 2: Materialize every blob without newline conversion**

Fetch each blob by SHA, decode its declared encoding, and write it to the matching local path. Verify the Git blob identity with:

```powershell
git hash-object --no-filters --path $relativePath $absolutePath
```

Expected: every computed SHA equals the tree entry SHA, including `public/og.png`.

- [ ] **Step 3: Verify the complete local tree inventory**

```powershell
rg --files -g '!node_modules' -g '!dist' -g '!.next' | Sort-Object
```

Expected: the path set equals the 217 blob paths returned by GitHub plus the two approved design/plan documents on the trust-root branch.

- [ ] **Step 4: Record immutable remote baselines**

Require these values immediately before implementation:

```text
main=d81785dd51bb0c9be339449566a15d3b3971e02a
governance-state=3e7867d3cdba75045f6dc8aa0448ccaac3547b68
PR13=e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b
PR14=9451ef05fbe289aaade134bb60fb1a57e5eb15a6
```

Stop if any value changes and re-read the corresponding audit record before continuing.

### Task 2: Add failing contract tests for the corrected trust boundary

**Files:**
- Modify: `tests/governance-contract.test.mjs`

**Interfaces:**
- Consumes: workflow, contract, writer, build guard, and exported governance functions.
- Produces: failing tests named `migrates the fixed failed bootstrap audit`, `verifies an untrusted protected proposal independently`, `waits for the pinned GitHub Actions check`, and `blocks every governance-only Workers Build before build`.

- [ ] **Step 1: Add the failed-audit migration test**

Create fixtures with the exact legacy state and immutable PR identities. Assert:

```js
const result = migrateFailedBootstrapAudit(legacy, request, contract);
assert.equal(result.state.schemaVersion, 2);
assert.equal(result.state.revision, 3);
assert.equal(result.state.stage, "IMPLEMENTATION_REQUIRED");
assert.deepEqual(result.state.lastUpdatedBy, { roleNumber: 2, roleName: "超级审计" });
assert.equal(result.state.candidateSha, "e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b");
assert.equal(result.state.candidateContext.treeSha, "a54f47d5f5b5b54e18454d5faa7a4fc3a403228d");
assert.equal(result.state.bootstrap.mode, "legacy-failed-audit-recovery");
assert.equal(result.state.bootstrap.completed, true);
```

Mutate the conclusion, candidate SHA, tree SHA, recovery head, legacy tip input, revision, and second-run schema individually; every mutation must throw.

- [ ] **Step 2: Add independent proposal verification tests**

Build temporary base and proposal directories for `bootstrap-recovery-records` and `bootstrap-recovery-pointer`. Call:

```js
verifyProtectedProposal({
  baseRoot,
  proposalRoot,
  envelope,
  candidatePullRequest,
  recoveryPullRequest,
  contract,
});
```

Assert success only for the exact path and byte set. Add one mutation per rejection case: extra path, deletion, symlink mode, changed bytes, changed digest, wrong phase, wrong expected tip, wrong source head, and pointer-before-record.

- [ ] **Step 3: Replace the self-status writer fixture**

The fake `gh` program must return this trusted check object:

```json
{
  "check_runs": [
    {
      "id": 9001,
      "name": "governance-state-write",
      "status": "completed",
      "conclusion": "success",
      "head_sha": "PROPOSAL_HEAD",
      "app": { "id": 15368, "slug": "github-actions" }
    }
  ]
}
```

Assert wrong App id, wrong head SHA, failure, and timeout all return exit 75 without invoking the merge endpoint. Assert the writer source does not contain `/statuses/`, `statuses: write`, or a success-state POST.

- [ ] **Step 4: Expand Cloudflare guard tests**

Run `scripts/build-verified.sh` with `WORKERS_CI=1` for:

```text
governance-state
governance/four-role-auto-handoff
governance/bootstrap-trust-root
governance-write/123-1-bootstrap-recovery-records
```

Assert exit 78 and no `Running bounded vinext build` output. Add a temporary two-parent trust-root merge fixture on `main`, set `WORKERS_CI_COMMIT_SHA`, and assert the exact governance allowlist exits 78 while a product-path mutation is not classified as governance-only.

- [ ] **Step 5: Run the focused tests and confirm failure**

```powershell
node --experimental-strip-types --test --test-name-pattern='failed bootstrap|protected proposal|pinned GitHub Actions|Workers Build' tests/governance-contract.test.mjs
```

Expected: FAIL because the new exports, independent gate, pinned check polling, and main-merge guard do not yet exist.

### Task 3: Freeze the corrected machine contract

**Files:**
- Modify: `governance/role-contract.json`
- Modify: `governance/state-schema.json`
- Modify: `governance/runtime-example/current.json`
- Modify: `governance/runtime-example/version-state.json`

**Interfaces:**
- Consumes: fixed audit identities and Ruleset facts.
- Produces: `runtime.requiredStatusAppId`, independent verifier metadata, and a single-use failed-audit recovery policy.

- [ ] **Step 1: Add exact runtime fields**

Add these values to `runtime`:

```json
{
  "requiredStatusContext": "governance-state-write",
  "requiredStatusAppId": 15368,
  "statusProducer": "default-branch-repository-dispatch-proposal-gate",
  "requiredCheckTransport": "checks-api-head-sha",
  "writerRequestsIndependentGate": true,
  "authorizationSource": "repository-owner-issue-comment",
  "authorizationRevalidatedByGate": true,
  "writerMayCreateStatus": false,
  "writerMayCreateCheckRun": false,
  "proposalVerifierExecutesHeadCode": false
}
```

- [ ] **Step 2: Replace the passing-only bootstrap policy**

Define this fixed recovery object:

```json
{
  "failedAuditRecovery": {
    "legacyTip": "3e7867d3cdba75045f6dc8aa0448ccaac3547b68",
    "legacyRevision": 2,
    "legacyCandidateSha": "7caf24d4c52f1502d43cbf668329701986669a6e",
    "candidatePullRequest": 13,
    "candidateSha": "e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b",
    "candidateTreeSha": "a54f47d5f5b5b54e18454d5faa7a4fc3a403228d",
    "recoveryPullRequest": 14,
    "recoveryBranch": "recovery/governance-rc-audit-r1",
    "recoveryHeadSha": "9451ef05fbe289aaade134bb60fb1a57e5eb15a6",
    "auditConclusion": "failed",
    "targetStage": "IMPLEMENTATION_REQUIRED",
    "resultSchemaVersion": 2,
    "resultRevision": 3,
    "singleUse": true,
    "retainCompletedReceipt": true
  }
}
```

Retain the governance-1 `planAuditMayBeNull` exception only when an immutable completed recovery receipt is present, and prohibit it for later versions. The migration itself still accepts only schema 1, so the receipt cannot be replayed.

- [ ] **Step 3: Validate example states against Schema 2**

Both examples must contain complete `records`, `recordDigests`, `candidateContext`, `block`, and `bootstrap` keys with explicit nulls where allowed.

- [ ] **Step 4: Run the contract parser test**

```powershell
node --experimental-strip-types --test --test-name-pattern='contract|schema' tests/governance-contract.test.mjs
```

Expected: contract structure passes; behavior tests remain failing until implementation.

### Task 4: Implement failed-audit migration and proposal reconstruction

**Files:**
- Modify: `scripts/governance-state.mjs`

**Interfaces:**
- Consumes: schema-1 state, fixed candidate/recovery PR payloads, candidate tree SHA, immutable record content, contract.
- Produces: `migrateFailedBootstrapAudit(previous, request, contract)`, `buildProposalEnvelope(input)`, and `verifyProtectedProposal(input)`.

- [ ] **Step 1: Implement the fixed migration**

Export:

```js
export function migrateFailedBootstrapAudit(previousInput, request, contractInput)
```

Validate the exact policy fields before reading records. Require PR #13 and PR #14 to be open, non-draft, same-repository objects at their fixed heads. Require the immutable rc-audit record to bind the Candidate and contain both the failed conclusion and `IMPLEMENTATION_REQUIRED`. Produce the exact schema-2 state described in Task 2, including an immutable `legacy-failed-audit-recovery` receipt that preserves the truthful governance-1 `planAudit=null` exception.

- [ ] **Step 2: Canonicalize proposal envelopes**

Export:

```js
export function buildProposalEnvelope({
  phase,
  expectedTip,
  expectedRevision,
  source,
  paths,
  contentDigests,
})
```

Allow phases `bootstrap-recovery-records`, `bootstrap-recovery-pointer`, `record`, and `pointer`. Sort paths and digest keys, reject unknown keys, and return stable JSON whose SHA-256 is stored as `envelopeDigest`.

- [ ] **Step 3: Independently reconstruct and verify proposals**

Export:

```js
export function verifyProtectedProposal({
  baseRoot,
  proposalRoot,
  envelope,
  candidatePullRequest,
  recoveryPullRequest,
  contract,
})
```

Re-run the migration or normal transition from base facts. Derive the only allowed paths and expected bytes for the phase. Use `lstat` to reject symlinks. Compare sorted recursive path sets, file bytes, SHA-256 digests, state values, and record ordering.

- [ ] **Step 4: Add CLI commands**

Support:

```text
build-bootstrap-recovery
build-proposal-envelope
verify-protected-proposal
```

Every command uses explicit file arguments, returns no secret values in errors, and exits nonzero on unknown options.

- [ ] **Step 5: Run migration and proposal tests**

```powershell
node --experimental-strip-types --test --test-name-pattern='failed bootstrap|protected proposal' tests/governance-contract.test.mjs
```

Expected: PASS.

### Task 5: Remove self-authorization from the protected writer

**Files:**
- Modify: `scripts/governance-protected-write.sh`

**Interfaces:**
- Consumes: state worktree, exact expected tip, phase, messages, envelope file, and runtime paths.
- Produces: `tip=<merge SHA>` and `pull_request=<number>` only after a trusted check and exact merge.

- [ ] **Step 1: Add envelope input and validation**

Change the interface to:

```text
governance-protected-write.sh STATE_ROOT EXPECTED_TIP PHASE COMMIT_MESSAGE PR_TITLE ENVELOPE_PATH PATH...
```

Require the envelope to be valid JSON, single-line canonical data, and to match phase, tip, and sorted paths.

- [ ] **Step 2: Remove status creation**

Delete every call to `repos/$REPOSITORY/statuses/$head_sha`. The script must not require `statuses: write`.

- [ ] **Step 3: Request the independent Gate**

After the proposal identity is validated, submit an exact JSON repository dispatch with event type `governance-proposal` and the proposal PR number. This request starts the default-branch verification run but carries no authority to create or complete a Check.

- [ ] **Step 4: Poll the trusted check**

Query `repos/$REPOSITORY/commits/$head_sha/check-runs`. Accept only the newest run satisfying:

```jq
.name == "governance-state-write" and
.head_sha == $head and
.app.id == 15368 and
.app.slug == "github-actions" and
.status == "completed" and
.conclusion == "success"
```

Use bounded environment-configurable attempts for tests and a production default below the workflow timeout.

- [ ] **Step 5: Recheck identity and merge**

Immediately before merge, require the PR API head SHA and base ref to remain exact and the remote state tip to equal `EXPECTED_TIP`. Merge with `sha=$head_sha` and `merge_method=merge`, then require the new target tip to equal the returned SHA and have two parents.

- [ ] **Step 6: Run writer tests and syntax validation**

```powershell
bash -n scripts/governance-protected-write.sh
node --experimental-strip-types --test --test-name-pattern='pinned GitHub Actions|protected writer' tests/governance-contract.test.mjs
```

Expected: PASS.

### Task 6: Split orchestration from independent authorization

**Files:**
- Modify: `.github/workflows/governance-state.yml`

**Interfaces:**
- Consumes: owner commands, fixed `repository_dispatch` requests, and supplemental `pull_request_target` events.
- Produces: deterministic protected proposals and the GitHub Actions check `governance-state-write`.

- [ ] **Step 1: Add the always-created proposal gate**

Use:

```yaml
on:
  issue_comment:
    types: [created]
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review]
    branches: [governance-state]
  repository_dispatch:
    types: [governance-proposal]
```

Create one `governance-proposal-gate` job for every fixed dispatch or matching `pull_request_target` event. Grant only `checks: write`, `contents: read`, `issues: read`, and `pull-requests: read`. Checkout `ref: main` with `persist-credentials: false` into a trusted directory. Create an in-progress Checks API run named `governance-state-write` on the exact proposal head, require the head to remain unchanged during verification, and always complete that same Check with success or failure.

After creating each proposal PR, the writer must emit event type `governance-proposal` through the repository dispatch API with the exact PR number. This is the guaranteed path because ordinary events created by `GITHUB_TOKEN` do not start a second workflow run; `repository_dispatch` is the supported exception. The writer uses its existing `contents: write` and never receives `checks: write`.

The envelope must bind `github.event.comment.id`. The gate re-reads that comment with the GitHub API, requires `user.login == repository_owner`, parses the exact command again, and requires the comment's issue number and all command values to match the source PR and envelope before reconstruction.

- [ ] **Step 2: Materialize proposal data without executing it**

Use `gh api` and `git fetch` to place exact base and head trees in `$RUNNER_TEMP`. Do not source shell, run Node, install packages, or invoke scripts from the proposal tree. Run only `main`'s `scripts/governance-state.mjs verify-protected-proposal`.

- [ ] **Step 3: Implement the exact failed-recovery command**

Accept only:

```text
/governance-bootstrap-recover <expected-tip> 2 13 14 <candidate-sha> <tree-sha> <recovery-head-sha>
```

Require the repository owner and exact fixed values from the contract. Build records and pointer proposals sequentially through the refactored writer.

- [ ] **Step 4: Preserve normal transitions**

Keep `/governance-transition` but route its record and pointer proposals through the same envelope, independent gate, trusted-check polling, and CAS logic.

- [ ] **Step 5: Restrict permissions**

The orchestrator may use `contents: write`, `issues: write`, and `pull-requests: write` for proposal transport and the fixed repository dispatch. It must not request `actions: write`, `checks: write`, `statuses: write`, deployments, packages, environments, id-token, or Cloudflare permissions. The Gate alone receives `checks: write` and no repository write permission.

- [ ] **Step 6: Validate YAML and workflow drift tests**

```powershell
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/governance-state.yml', aliases: true); puts 'yaml ok'"
node --experimental-strip-types --test --test-name-pattern='owner-only|workflow|proposal gate|drift' tests/governance-contract.test.mjs
```

Expected: PASS.

### Task 7: Fail Cloudflare closed before build or version creation

**Files:**
- Modify: `scripts/build-verified.sh`
- Modify: `tests/governance-contract.test.mjs`
- Modify: `governance/workflow.md`

**Interfaces:**
- Consumes: `WORKERS_CI`, `WORKERS_CI_BRANCH`, `WORKERS_CI_COMMIT_SHA`, and local Git commit metadata.
- Produces: exit 78 before the first build marker for verified governance-only events.

- [ ] **Step 1: Guard all governance branches**

Before the `SITES_ENV_READY` relaunch, match:

```bash
governance-state|governance/*|governance-write/*
```

When `WORKERS_CI=1`, print one non-sensitive diagnostic and exit 78.

- [ ] **Step 2: Guard the trust-root merge on main**

Resolve `WORKERS_CI_COMMIT_SHA` (or the checked-out `HEAD`) to an exact commit, calculate the complete first-parent changed-path set, and detect `.github/workflows/governance-state.yml`. Any such trust-root change must be a two-parent merge and every path must match the approved allowlist before exiting 78. Classification must not depend on GitHub's configured merge-title format; a subject beginning `Governance trust root:` is an additional fail-closed signal.

- [ ] **Step 3: Fail closed on incomplete governance proof**

If a trust-root workflow change or marked commit has an unprovable shape, parent, or path set, exit 78. If it includes a product path, exit 78 with a distinct “governance trust-root path mismatch” message; never continue to a deploy-capable build under ambiguous governance evidence.

- [ ] **Step 4: Run build-guard tests**

```powershell
node --experimental-strip-types --test --test-name-pattern='Workers Build' tests/governance-contract.test.mjs
```

Expected: PASS with no build marker in guarded cases.

### Task 8: Align documentation and role recovery rules

**Files:**
- Modify: `AGENTS.md`
- Modify: `governance/README.md`
- Modify: `governance/workflow.md`
- Modify: `governance/roles/super-audit.md`
- Modify: `governance/roles/super-work.md`
- Modify: `docs/superpowers/specs/2026-09-01-governance-bootstrap-trust-root-design.md` only if implementation proves a wording error

**Interfaces:**
- Consumes: implemented behavior.
- Produces: one unambiguous intermediate-audit and recovery protocol.

- [ ] **Step 1: Document the trust-root audit gate**

State that role 2 first audits the trust-root PR, not PR #13's final Candidate, and that no default-branch activation occurs before that approval.

- [ ] **Step 2: Document expected-source pinning**

Record context `governance-state-write`, App id `15368`, independent default-branch verifier, and the prohibition on self-authored statuses.

- [ ] **Step 3: Document failed-audit recovery**

Record the fixed inputs, schema-2 revision-3 `IMPLEMENTATION_REQUIRED` output, record-first/pointer-second order, and single-use retirement.

- [ ] **Step 4: Document Cloudflare evidence**

Require before/after build, version, deployment, preview, GitHub check, and comment snapshots. Distinguish a skipped build from a failed-closed build.

- [ ] **Step 5: Run documentation contract tests**

```powershell
node --experimental-strip-types --test --test-name-pattern='documents|roles|handoff' tests/governance-contract.test.mjs
```

Expected: PASS.

### Task 9: Run complete local verification

**Files:**
- Verify only; do not change generated migrations or production configuration.

**Interfaces:**
- Consumes: complete implementation tree.
- Produces: reproducible validation transcript and final clean diff.

- [ ] **Step 1: Install exact dependencies**

```powershell
npm ci
```

Expected: exit 0 with the lockfile unchanged.

- [ ] **Step 2: Run focused governance verification**

```powershell
npm run governance:validate
node --experimental-strip-types --test tests/governance-contract.test.mjs
bash -n scripts/governance-protected-write.sh
node --check scripts/governance-state.mjs
```

Expected: all governance tests pass; shell and Node syntax pass.

- [ ] **Step 3: Run the full project gate**

```powershell
npm audit --omit=dev --audit-level=high
npm test
npm run lint
./node_modules/.bin/tsc --noEmit
npm run db:generate
git status --porcelain --untracked-files=all -- drizzle
npx --no-install wrangler deploy --dry-run --keep-vars --config wrangler.jsonc
git diff --exit-code -- wrangler.jsonc
```

Expected: zero high/critical production vulnerabilities, all tests pass, build/lint/typecheck pass, no migration drift, dry-run exits successfully, and Wrangler config is unchanged.

- [ ] **Step 4: Scan the final diff for forbidden scope**

Require no changes below `app/`, `worker/`, `cloudflare/`, `db/`, `drizzle/`, runtime resource ids, formal tags, or product version fields. Scan governance files for credential-shaped values and report categories only.

### Task 10: Publish the trust-root implementation for intermediate audit

**Files:**
- Commit only approved trust-root files from the file map.

**Interfaces:**
- Consumes: tested local tree and unchanged remote baselines.
- Produces: one open, non-draft, same-repository PR to `main` with exact Head SHA and Tree SHA.

- [ ] **Step 1: Re-read remote refs before publishing**

Require `main`, PR #13, PR #14, and `governance-state` to match Task 1. If any changed, stop and reconcile rather than force-update.

- [ ] **Step 2: Create the implementation commit**

Use the exact commit subject:

```text
Governance trust root: add independent protected-state verifier
```

Create a Git tree from the verified base and only the approved changed blobs. Create a single-parent commit based on the current trust-root branch head and fast-forward the branch without force.

- [ ] **Step 3: Create the intermediate-audit PR**

Open a non-draft PR from `governance/bootstrap-trust-root` to `main`. Its body must state that it is a trust-root audit target, not the final PR #13 Candidate, and must enumerate all validation results plus every unverified live step.

- [ ] **Step 4: Wait for GitHub verification**

Require `Complete Verification / full-verify` success on the exact Head SHA. Read back the commit Tree SHA and all changed filenames.

- [ ] **Step 5: Stop at the role-2 gate**

Do not merge the PR, change the Ruleset, invoke bootstrap recovery, or touch Cloudflare. Provide role 2 with the exact PR, Head SHA, Tree SHA, base SHA, changed paths, local and GitHub results, and the explicit audit question: whether this trust root may enter `main` without weakening governance or permitting a production deployment.

## Plan self-review

- Spec coverage: every design section maps to Tasks 2–10; live recovery after trust-root approval is intentionally deferred to a second plan because it crosses an independent role-2 gate.
- Placeholder scan: the plan contains no unresolved implementation placeholders; fixed remote identities and expected outputs are explicit.
- Type consistency: `requiredStatusAppId`, `migrateFailedBootstrapAudit`, `buildProposalEnvelope`, `verifyProtectedProposal`, envelope phases, workflow job name, and writer outputs are identical across tasks.
