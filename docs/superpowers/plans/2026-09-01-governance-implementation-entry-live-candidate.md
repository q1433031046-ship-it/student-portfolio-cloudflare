# Governance Implementation Entry Live-Candidate Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the protected writer enter `IMPLEMENTING` while retaining and object-verifying the rejected Candidate, without weakening the full live Candidate gate used for `RC_AUDIT_PENDING` and release states.

**Architecture:** Keep state-transition validation and remote-verification policy in the trusted Node verifier. The workflow supplies validated previous and next state files to one transition-aware command; the command derives `none`, `historical-object`, or `live`, shares immutable commit/Tree verification with the existing live verifier, and never lets historical mode authorize an audit-eligible state.

**Tech Stack:** Node.js ESM, Node test runner, GitHub Actions YAML, GitHub REST API, existing governance contract and protected writer.

## Global Constraints

- Modify only governance trust-root documentation, verifier, workflow, and governance tests.
- Do not modify product code, database migrations, deployment configuration, release tags, or Cloudflare resources.
- Do not change the formal transition graph, transition field allowlists, CAS semantics, Ruleset requirements, trusted writer identity, or independent Gate authority.
- `IMPLEMENTING -> RC_AUDIT_PENDING` must continue to bind and fully live-verify the exact new Candidate SHA, Tree SHA, PR, branch, base and ancestry.
- Deliver as an independent PR based on `main` and stop for role 2 intermediate audit.

---

### Task 1: Specify and test the verification-mode boundary

**Files:**
- Modify: `tests/governance-contract.test.mjs`
- Test: `tests/governance-contract.test.mjs`

**Interfaces:**
- Consumes: `buildGovernanceTransition(previous, request, contract)` and the existing GitHub-response test doubles.
- Produces: expectations for `remoteCandidateVerificationMode` and `verifyRemoteCandidateTransition`.

- [ ] **Step 1: Import the new verifier interfaces**

Add these imports from `scripts/governance-state.mjs`:

```js
remoteCandidateVerificationMode,
verifyRemoteCandidateTransition,
```

- [ ] **Step 2: Write the failing historical-object test**

Build `IMPLEMENTATION_REQUIRED -> IMPLEMENTING` from `bootstrapState()`. Use a fake fetch that returns the state-bound commit and Tree but throws if branch, PR, or comparison endpoints are requested. Assert mode `historical-object`, one request, and rejection when the returned Tree differs.

- [ ] **Step 3: Write the failing live-Candidate reverse test**

Build `IMPLEMENTING -> RC_AUDIT_PENDING` with a new same-repository PR. Assert mode `live`, all four GitHub endpoints are called, and a moved branch or wrong PR head/base rejects.

- [ ] **Step 4: Run the focused tests and confirm they fail before implementation**

Run:

```text
node --test --test-name-pattern="transition-aware remote Candidate" tests/governance-contract.test.mjs
```

Expected: failure because the new exports do not exist.

### Task 2: Implement the transition-aware verifier

**Files:**
- Modify: `scripts/governance-state.mjs`
- Test: `tests/governance-contract.test.mjs`

**Interfaces:**
- Consumes: validated previous/next states, governance contract, GitHub token and injectable `fetchImpl`.
- Produces: `remoteCandidateVerificationMode()` and `verifyRemoteCandidateTransition()` plus CLI command `verify-remote-transition`.

- [ ] **Step 1: Extract immutable object verification**

Create an internal helper that fetches `/git/commits/<candidateSha>`, checks the exact commit SHA and Tree SHA, and returns `{ candidateSha, treeSha }`. Make `verifyRemoteCandidate()` reuse it before branch, PR and comparison checks.

- [ ] **Step 2: Add the pure mode selector**

Implement:

```js
export function remoteCandidateVerificationMode(previousInput, nextInput, contractInput) {
  const previous = validateGovernanceState(previousInput, { contract: contractInput });
  const next = validateGovernanceTransition(previous, nextInput, contractInput);
  if (!next.candidateSha) return "none";
  if (next.stage === "IMPLEMENTING") return "historical-object";
  if (next.stage === "BLOCKED" && next.block?.sourceStage === "IMPLEMENTING") {
    return "historical-object";
  }
  return "live";
}
```

- [ ] **Step 3: Add the remote transition verifier**

For `none`, return without network access. For `historical-object`, call only immutable object verification. For `live`, call the unchanged full live verifier. Return evidence with the exact selected mode.

- [ ] **Step 4: Add the CLI command**

Accept only `--previous` and `--contract`, load both state files, call `verifyRemoteCandidateTransition`, and print its JSON evidence. Update the usage error to include the command.

- [ ] **Step 5: Run the focused tests**

Run the same focused command. Expected: all transition-aware tests pass.

### Task 3: Route the trusted workflow through the tested policy

**Files:**
- Modify: `.github/workflows/governance-state.yml`
- Modify: `tests/governance-contract.test.mjs`

**Interfaces:**
- Consumes: `next.json`, `previous.json`, and the trusted contract checked out from `main`.
- Produces: one mandatory transition-aware verification call before any protected proposal is created.

- [ ] **Step 1: Replace the normal transition check**

Replace the `candidateSha` shell conditional with:

```bash
GITHUB_TOKEN="$GH_TOKEN" node scripts/governance-state.mjs verify-remote-transition "$next" \
  --contract governance/role-contract.json \
  --previous "$PREVIOUS_PATH"
```

- [ ] **Step 2: Add workflow contract assertions**

Assert that the normal transition step contains `verify-remote-transition`, `--previous`, and the trusted contract path. Assert that bootstrap recovery still invokes the full `verify-remote` command. Assert the normal transition block no longer gates verification solely on non-empty `candidateSha`.

- [ ] **Step 3: Run governance tests and static checks**

Run:

```text
node --test tests/governance-contract.test.mjs
node --check scripts/governance-state.mjs
npm run governance:validate
git diff --check
```

Expected: zero failures; Bash-only tests may skip on Windows and must run in exact-Head Linux CI.

### Task 4: Validate and hand off the independent trust-root Candidate

**Files:**
- Modify: no additional source files
- Verify: complete repository gates

**Interfaces:**
- Consumes: the exact branch Head and Tree produced by Tasks 1-3.
- Produces: an open, unmerged trust-root PR with exact-Head CI and an audit handoff for role 2.

- [ ] **Step 1: Run all proportionate local validation**

Run governance validation, all Node tests, production dependency audit, ESLint, TypeScript, migration consistency, production build, Wrangler dry-run, syntax checks, and `git diff --check`. Record Windows-only skips separately.

- [ ] **Step 2: Confirm scope**

Diff against `origin/main`. Expected changed paths are only the workflow, verifier, governance tests, this design, and this plan. Confirm no product or deployment-resource files changed.

- [ ] **Step 3: Commit and publish the exact branch**

Create focused commits, push `governance/trust-root-implementation-entry-fix`, and open an unmerged PR into `main`. Do not merge it.

- [ ] **Step 4: Verify exact-Head CI and immutable identity**

Read back PR base, Head, Tree, changed paths, merge state and Complete Verification run/job. Any Head or Tree drift invalidates the handoff.

- [ ] **Step 5: Stop for role 2**

Report the real run `33476665136` failure as the reproduction, the new PR/Head/Tree/CI as the fix Candidate, unchanged Ruleset and Cloudflare boundaries, and request an independent role 2 audit. Do not retry governance state mutation until the audited fix is merged to `main`.
