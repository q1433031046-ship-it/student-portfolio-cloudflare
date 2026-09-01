# Governance Implementation Entry Live-Candidate Verification Design

## Status and authorization

Role 3 discovered this blocker while carrying the approved governance trust-root work through the real protected state transition. The owner instructed role 3 to continue until an audit is required and previously approved the minimal trust-root convergence design. This document narrows the repair to the failed transition path; it does not authorize product work, production deployment, a release tag, PR #13 merge, or direct writes to `governance-state`.

## Observed failure

The protected state is schema 2, revision 3, `IMPLEMENTATION_REQUIRED`. It correctly preserves the rejected Candidate identity:

- Candidate SHA `e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b`;
- Tree SHA `a54f47d5f5b5b54e18454d5faa7a4fc3a403228d`;
- PR #13;
- base `d81785dd51bb0c9be339449566a15d3b3971e02a`.

Role 3 completed the replacement Candidate on the same PR branch:

- Candidate SHA `1d2b791b918bfc69625f5ac56990c42146cf002e`;
- Tree SHA `d8920364d95735b4a399e165efe7f1d670f8c7e6`;
- base `c2101f7f4ca62fe4e1fdd477c7f1370a5f636605`.

The owner-only CAS command `/governance-transition ac64bde51457291287e81e858953059f01a05423 3 3 IMPLEMENTING` triggered Governance State Transition run `33476665136`, job `99757244607`. Command parsing, trusted checkout, dependency installation, immutable input resolution, and state construction succeeded. The validator reported `IMPLEMENTATION_REQUIRED -> IMPLEMENTING revision=4`, then the workflow failed with `Candidate 分支 tip 已变化` before opening a protected proposal.

This is a sequencing defect in the trusted writer. The state intentionally retains the rejected Candidate as historical evidence when entering `IMPLEMENTING`, but the workflow incorrectly applies the live-ref invariant to that historical identity. Once implementation changes the PR branch or `main` advances, the old PR head and old base cannot remain live.

## Security boundary

The repair must distinguish two verification meanings:

1. **Historical object verification** proves that the state-bound commit still resolves and still has the state-bound Tree SHA. It does not require the rejected Candidate's branch tip, PR head, or PR base to remain current.
2. **Live Candidate verification** proves commit, Tree, branch tip, open non-draft same-repository PR head, exact `main` base, and ancestry. This remains mandatory whenever a transition claims a current Candidate that may proceed to audit or release.

The writer selects the mode from the validated previous and next states, not from an untrusted PR body or comment field:

| Transition result | Verification mode | Reason |
| --- | --- | --- |
| No Candidate identity | `none` | There is no Candidate to verify. |
| `IMPLEMENTING` | `historical-object` | The retained rejected Candidate is evidence, while its branch and PR are now mutable work surfaces. |
| `BLOCKED` sourced from `IMPLEMENTING` | `historical-object` | Role 3 must be able to fail closed after implementation refs move. |
| Any other state with a Candidate | `live` | Candidate eligibility or frozen audit/release identity still depends on exact live refs and ancestry. |

In particular, `IMPLEMENTING -> RC_AUDIT_PENDING` first replaces the state identity with the exact new PR head, Tree and base, then performs full live verification. No transition can obtain audit or release eligibility through historical-object mode.

## Approaches considered

### A. Skip all remote verification for `IMPLEMENTING`

This is the smallest workflow edit, but it loses even commit/Tree object evidence and leaves the security reason encoded in shell conditionals. It is not selected.

### B. Add a transition-aware trusted verifier

The trusted Node verifier validates the previous-to-next transition, derives `none`, `historical-object`, or `live`, and performs exactly that remote check. The workflow always calls this verifier. Unit tests exercise the policy directly, while existing independent-Gate and protected-write tests remain unchanged. This is selected because it is explicit, testable, and preserves the full live Candidate gate.

### C. Clear Candidate identity on entry to `IMPLEMENTING`

This would require widening the field allowlist and changing the formal state/record semantics. It is not selected because the historical rejected Candidate must remain traceable and the change is larger than the observed defect.

## Components

### `scripts/governance-state.mjs`

Add a pure mode selector and a transition-aware remote verifier. Refactor the existing live verifier so immutable commit/Tree verification is shared rather than duplicated.

The public behavior is:

```js
remoteCandidateVerificationMode(previous, next, contract)
// -> "none" | "historical-object" | "live"

verifyRemoteCandidateTransition(previous, next, {
  contract,
  token,
  fetchImpl,
})
// -> evidence containing the selected mode
```

The command-line entry is:

```text
verify-remote-transition <next.json> --previous <previous.json> --contract <contract.json>
```

### `.github/workflows/governance-state.yml`

Replace the unconditional `verify-remote` call in the normal transition builder with `verify-remote-transition`. Bootstrap recovery continues to call the full `verify-remote` command because it establishes a current fixed Candidate.

### `tests/governance-contract.test.mjs`

Add tests proving:

- a moved rejected branch/Base cannot block a valid `IMPLEMENTATION_REQUIRED -> IMPLEMENTING` transition;
- historical mode still rejects the wrong Tree for the state-bound commit;
- the exact new Candidate at `RC_AUDIT_PENDING` still receives all four live checks;
- a moved/wrong new Candidate still fails;
- the trusted workflow calls the transition-aware command and bootstrap recovery retains full live verification.

## Unchanged invariants

- Ruleset `21936381`, required check `governance-state-write`, App id `15368`, empty bypass list, CAS, and revision `+1` are unchanged.
- Protected writes remain record-first and pointer-second where a record exists.
- The independent Gate still reconstructs proposals from trusted `main` code and never executes proposal code.
- Candidate SHA, Tree, PR, base, branch and ancestry remain mandatory and exact at `RC_AUDIT_PENDING` and later eligible states.
- Failed or conditional audits cannot advance; wrong Candidates cannot become release eligible.
- No product, Worker, D1, KV, Secrets, preview, production deployment, or release-tag behavior changes.

## Delivery sequence

The fix is delivered as a small independent trust-root PR based on the current `main`. Role 3 stops for role 2 intermediate audit. Only after that exact Head is approved and merged into `main` may role 3 retry revision 3 -> 4, restore/finalize PR #13 against the new `main`, run exact-Head CI, and execute revision 4 -> 5 to `RC_AUDIT_PENDING`.
