# Governance Bootstrap Trust Root Design

## Status and scope

This design resolves the governance bootstrap deadlock recorded by role 2 for PR #13 and PR #14. It is governance-only. It does not change product behavior, the product version, database migrations, the formal Release Tag, production traffic, Worker runtime configuration, D1, `MEDIA_KV`, or Secrets.

The fixed failed-audit inputs are:

- Candidate PR: `#13`
- Candidate commit: `e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b`
- Candidate tree: `a54f47d5f5b5b54e18454d5faa7a4fc3a403228d`
- Recovery PR: `#14`
- Recovery PR head: `9451ef05fbe289aaade134bb60fb1a57e5eb15a6`
- Legacy state tip: `3e7867d3cdba75045f6dc8aa0448ccaac3547b68`
- Legacy state: schema 1, revision 2, `RC_AUDIT_PENDING`
- Audit conclusion: failed
- Required recovered stage: `IMPLEMENTATION_REQUIRED`

The design deliberately introduces an intermediate role-2 audit. The trust root must be audited before it enters `main`; only code already present on the default branch may authorize protected governance writes.

## Problem statement

The existing Candidate cannot legally restore its failed audit:

1. The `issue_comment` writer is absent from `main`, so GitHub cannot trigger it as trusted default-branch code.
2. The legacy migration accepts only a passing audit and always produces `RELEASE_APPROVED`; it rejects the real failed audit that must produce `IMPLEMENTATION_REQUIRED`.
3. The Ruleset requires the context `governance-state-write` but does not pin an expected GitHub App.
4. The writer posts its own successful commit status before merging, so proposal creation and independent authorization are not separated.
5. Tests simulate GitHub and do not prove that the active Ruleset, repository permissions, and two sequential merge commits work together.
6. Cloudflare evidence does not prove that the default-branch trust-root merge and governance proposal branches create zero Worker Versions and zero previews.

## Security model

The proposal branch and its pull-request body are always untrusted. A successful status is accepted only when all of the following are true:

- the verifier workflow definition comes from `main`;
- the verifier uses `pull_request_target` and never checks out or executes proposal code;
- the fixed job name is `governance-state-write`;
- the check run is produced by the GitHub Actions App, integration id `15368`;
- the active Ruleset independently requires the same context and integration id;
- the verifier reconstructs the permitted transition from immutable GitHub and `governance-state` facts and compares exact files and values;
- the orchestrator rechecks the proposal head and state tip after the check succeeds and immediately before merge;
- the merge API is called with the exact proposal head SHA and merge method `merge`.

No workflow may create a successful classic commit status for `governance-state-write`. No bypass actor is added. The Ruleset remains active, strict, pull-request-only, deletion-protected, and non-fast-forward-protected.

## Architecture

### 1. Audited default-branch trust root

A dedicated pull request based on the current `main` installs the smallest code required to validate and transport governance state:

- `.github/workflows/governance-state.yml`
  - owner-only `issue_comment` command orchestration;
  - independent `pull_request_target` proposal verification;
  - no Wrangler, tag, release, Worker, D1, KV, or Secrets operations.
- `scripts/governance-state.mjs`
  - deterministic schema and transition validation;
  - a single-use failed-audit legacy migration;
  - protected-proposal reconstruction and exact-diff verification.
- `scripts/governance-protected-write.sh`
  - proposal creation, trusted-check polling, exact-tip CAS, and protected merge;
  - no `statuses: write` permission and no status-creation API call.
- the governance contract, schema, role rules, focused tests, and the Cloudflare pre-build guard needed by those files.

Role 2 audits this trust-root pull request before it is merged. The failed PR #13 Candidate is not merged to establish the trust root.

### 2. Independent proposal verifier

The `pull_request_target` job runs only for pull requests whose base is `governance-state`. It performs these checks without executing proposal content:

1. Read the pull request through the GitHub API and require an open, non-draft, same-repository head.
2. Require a `governance-write/<run-id>-<attempt>-<phase>` branch and a machine-readable authorization envelope in the PR body.
3. Read the exact current `governance-state` tip and require it to match the envelope's expected tip.
4. Fetch the proposal commit and exact base commit as data.
5. Reconstruct the expected record or pointer files using `main` validation code and immutable source PR metadata.
6. Compare the proposal's complete changed-path set, file bytes, state values, record digests, Candidate commit/tree/base/branch, and expected parent.
7. Reject extra paths, symlinks, deletions, mutable references, same-stage rewrites, secrets, or an invalid audit chain.

The job itself produces the GitHub Actions check run named `governance-state-write`. Skipped jobs are not allowed to satisfy the Ruleset: the workflow uses a single always-created gate job that explicitly fails for an out-of-scope PR.

### 3. Protected writer transport

The transport script has no authority to approve its own proposal. For each phase it:

1. Requires the exact state tip, phase, paths, commit message, PR title, and authorization envelope.
2. Re-reads the remote state tip before committing.
3. Commits only the declared `governance/runtime/**` paths on a unique proposal branch.
4. Opens a pull request targeting `governance-state`.
5. Polls the proposal head's check runs and accepts only a completed successful `governance-state-write` check from GitHub Actions App id `15368`.
6. Re-reads the PR head and target tip.
7. Merges with the exact head SHA and `merge` method.
8. Confirms the returned merge SHA equals the new remote state tip and that the result has two parents.

Failure at any step stops the current phase. A record merge may exist without a pointer merge; this is recoverable because `current.json` remains unchanged and the next attempt starts from repository facts.

## One-time failed-audit recovery

The recovery command is exact and single-use. It binds the expected legacy tip and revision plus PR #13 and PR #14 identities. The migration accepts only the fixed legacy state and the fixed failed-audit evidence.

The migration must:

- read the release-candidate and audit records from immutable PR heads, not editable comments;
- require the failed conclusion and target `IMPLEMENTATION_REQUIRED`;
- require Candidate commit `e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b` and tree `a54f47d5f5b5b54e18454d5faa7a4fc3a403228d`;
- produce schema 2, revision 3, role 2 as last updater, and stage `IMPLEMENTATION_REQUIRED`;
- preserve the governance-1 plan and its allowed bootstrap `planAudit=null` exception;
- populate release-candidate and rc-audit pointers and SHA-256 digests;
- populate the exact Candidate context;
- clear the legacy bootstrap marker so the migration cannot run again.

The state is written through two protected pull requests:

1. records phase: immutable release-candidate and rc-audit files only;
2. pointer phase: `current.json` and `versions/governance-1.json`, based on the exact records merge tip.

PR #14 remains merely a source proposal until both protected phases succeed. It is never described as effective beforehand.

## Normal role-3 completion after recovery

After recovery, role 3 uses the normal contract:

1. `IMPLEMENTATION_REQUIRED -> IMPLEMENTING` through the protected writer;
2. update PR #13 with the complete reviewed governance implementation and tests;
3. run all required local and GitHub validations;
4. `IMPLEMENTING -> RC_AUDIT_PENDING` through record-first and pointer-second protected pull requests;
5. record the new Candidate commit and tree from GitHub after the final tested commit;
6. stop and hand the fixed Candidate to role 2.

The new Candidate must use the trust-root `main` commit as its current base and contain no product, migration, release-tag, or production-resource changes.

## Cloudflare zero-version and zero-preview proof

No governance event may reach a build, version upload, or deployment command.

The pre-build guard runs before dependency-heavy build work and recognizes:

- `governance-state`;
- `governance/*`;
- `governance-write/*`;
- the specifically marked governance-only trust-root merge on `main` after verifying its changed-path allowlist.

The trust-root changed-path allowlist is exact:

- `.github/workflows/governance-state.yml`;
- the root `AGENTS.md` governance entry;
- `governance/**`;
- `scripts/governance-*.sh` and `scripts/governance-*.mjs`;
- `scripts/build-verified.sh`;
- `tests/governance-contract.test.mjs`;
- `docs/superpowers/specs/**` and `docs/superpowers/plans/**`;
- the governance-script entries in `package.json` and their corresponding `package-lock.json` metadata only.

For a governance-only `main` commit, the guard resolves `WORKERS_CI_COMMIT_SHA`, verifies the first-parent changed paths, and exits closed before `vinext build`. The trust-root PR verifier must prove the commit shape and allowlisted paths before approval. At Workers Builds runtime, an unavailable parent or unprovable changed-path set also exits closed before build or upload; it is reported as a failed-closed build rather than treated as no-build evidence.

Acceptance evidence consists of read-only snapshots taken immediately before and after the trust-root merge and real governance writes:

- Cloudflare Workers Builds history;
- production Worker Version identifiers and creation timestamps;
- deployments and active version identifiers;
- preview aliases or preview deployment records;
- GitHub Cloudflare check runs and deployment comments for every involved commit.

The accepted result is zero new Worker Versions, zero preview deployments or aliases, unchanged active production deployment, and no Wrangler execution in governance workflows. A failed build record is reported separately and is acceptable only if logs prove the guard exited before build and upload.

## Tests and acceptance

### Deterministic tests

- A failed audit migrates only from the exact schema-1 revision-2 state to schema-2 revision 3 `IMPLEMENTATION_REQUIRED`.
- A passing audit, changed Candidate, changed tree, changed PR head, changed legacy tip, or second migration attempt fails.
- The proposal verifier rejects extra files, missing files, byte changes, digest changes, wrong parent, wrong base, wrong phase, and mutable Candidate identity.
- The writer contains no status-creation call and accepts only the fixed check name plus App id.
- Record and pointer phases cannot be reversed.
- Tip changes at proposal creation, after authorization, or before merge fail closed.
- Cloudflare guard tests cover all governance branches and the exact governance-only main-merge case before any build marker.

### Real GitHub acceptance

- Trust-root PR passes the full repository verification workflow.
- Role 2 records approval before the trust-root PR enters `main`.
- Ruleset readback shows `integration_id=15368`, strict status checks, no bypass, PR-only writes, deletion protection, and non-fast-forward protection.
- A deliberately unauthorized state PR is blocked and cannot merge.
- The recovery creates two real proposal PRs and two real merge commits in record-then-pointer order.
- Direct ref update remains rejected.
- Re-running the recovery command fails because the legacy state no longer exists.
- The final Candidate handoff repeats the real two-stage path.

### Full Candidate validation

- `npm ci`
- full test suite
- governance-focused tests
- production dependency audit
- build
- ESLint
- TypeScript `--noEmit`
- migration metadata drift check
- YAML, shell, and MJS syntax checks
- Wrangler dry-run only
- GitHub `Complete Verification`
- read-only Cloudflare zero-version/zero-preview comparison

## Failure handling

- Missing default-branch workflow, insufficient GitHub Actions permission, missing expected App source, Ruleset drift, or unexpected Cloudflare build configuration stops the process before state mutation.
- A merged record with an unmerged pointer is reported as a partial protected write; it is not treated as a completed transition.
- Any new production Worker Version, preview, active deployment change, D1/KV/Secrets mutation, Release Tag, or product-path change fails acceptance and returns the work to role 3 without claiming a Candidate handoff.
- The Ruleset is never disabled, loosened, bypassed, or replaced with a self-authored status.

## Handoff sequence

1. Role 3 commits the trust-root implementation to a dedicated branch and opens its PR to `main`.
2. Role 2 audits only the trust root and Cloudflare no-deploy gate.
3. After approval, the trust root enters `main`; the Ruleset source is pinned without changing its other protections.
4. The real two-stage failed-audit recovery moves authoritative state to `IMPLEMENTATION_REQUIRED`.
5. Role 3 completes the bounded fixes and writes the new Candidate through the protected two-stage path.
6. The final state is `RC_AUDIT_PENDING`; role 2 receives the new Candidate SHA and Tree for candidate audit.

