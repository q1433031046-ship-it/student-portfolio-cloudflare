# Governance Risk Acceptance and Failure Isolation Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in the current role 3 session. No subagent execution is authorized for this task. Each task ends with an independently testable deliverable.

**Goal:** Add a minimal, machine-enforced risk acceptance policy to Candidate audits so contained Medium / Low issues can be accepted without weakening governance trust-root, Candidate identity, CAS, protected-state, production, data, security, or irreversible-error boundaries.

**Architecture:** Extend the exact `auditPolicy` allowlist with a nested `riskAcceptancePolicy`, parse fixed Markdown risk-entry blocks in the existing audit record validator, and apply the same validation through both `buildGovernanceTransition` and `verifyProtectedProposal`. Keep the formal conclusions and state transitions unchanged; the policy only determines whether an audit record is valid evidence for its existing conclusion.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, JSON machine contracts, Markdown handoff records, GitHub protected-proposal Gate, PowerShell and Bash verification commands.

## Global Constraints

- Modify governance contracts, audit rules, their documentation, and corresponding tests only.
- Do not modify product code, database code, Migration files, product behavior, or product tests.
- Do not modify `governance/state-schema.json`, `.github/workflows/governance-state.yml`, `scripts/governance-protected-write.sh`, `scripts/build-verified.sh`, Ruleset configuration, or required-check identity.
- Do not deploy production, upload a Worker Version, create a preview, modify Worker/D1/MEDIA_KV/Secrets, create a Release, or create/move/delete a Release Tag.
- Formal audit conclusions remain exactly `通过` and `不通过` with the existing target-state mapping.
- PR #13 remains the sole Candidate PR; integrate trusted `main@c2101f7f4ca62fe4e1fdd477c7f1370a5f636605` before producing the new Candidate.
- Stop after the protected handoff reaches `RC_AUDIT_PENDING`; do not enter role 4.

---

### Task 1: Integrate the audited trust root into PR #13

**Files:**
- Preserve: `docs/superpowers/specs/2026-09-01-governance-risk-acceptance-isolation-design.md`
- Merge from: `origin/main`
- Verify no product-path conflict resolution is introduced.

**Interfaces:**
- Consumes: PR #13 branch `governance/four-role-auto-handoff` and audited trust-root merge `c2101f7f4ca62fe4e1fdd477c7f1370a5f636605`.
- Produces: one merge commit whose first parent is the current PR #13 design commit and whose second parent is the exact `origin/main` tip.

- [ ] **Step 1: Re-read branch tips and ensure the worktree is clean**

```powershell
git fetch --no-tags origin main governance/four-role-auto-handoff governance-state
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```

Expected: clean worktree; `origin/main` equals `c2101f7f4ca62fe4e1fdd477c7f1370a5f636605` unless a new main commit requires a fresh scope review before continuing.

- [ ] **Step 2: Merge the exact trusted main and prefer main for overlapping trust-root files**

```powershell
git merge --no-ff -X theirs origin/main -m "Merge audited governance trust root into Candidate"
```

Expected: merge completes without unresolved entries. The design file remains present.

- [ ] **Step 3: Verify merge shape and changed-path boundary**

```powershell
git rev-list --parents -n 1 HEAD
git diff --name-only origin/main...HEAD
git status --short --branch
```

Expected: the merge has two parents; the second parent is exact `origin/main`; no path under `app/`, `db/`, `drizzle/`, `public/`, or product E2E tests appears as a role-3 change.

- [ ] **Step 4: Run the trusted governance baseline before feature edits**

```powershell
npm ci
npm run governance:validate
node --experimental-strip-types --test tests/governance-contract.test.mjs
```

Expected: baseline governance validation passes before adding the risk policy.

### Task 2: Lock the risk policy in the exact machine contract with failing tests

**Files:**
- Modify: `governance/role-contract.json`
- Modify: `scripts/governance-state.mjs`
- Test: `tests/governance-contract.test.mjs`

**Interfaces:**
- Consumes: existing `AUDIT_POLICY` exact allowlist and `validateGovernanceContract`.
- Produces: `auditPolicy.riskAcceptancePolicy` with exact classifications, severities, containment mechanisms, required fields, follow-up version formats, and nine non-waivable boundaries.

- [ ] **Step 1: Write contract tests that require the complete policy**

Add an expected object with this exact public shape:

```js
const RISK_ACCEPTANCE_POLICY = {
  classifications: [
    "Blocking Risk",
    "Accepted / Contained Risk",
    "Monitored Technical Debt",
    "Low / Won't Fix Now",
  ],
  passEligibleClassifications: [
    "Accepted / Contained Risk",
    "Monitored Technical Debt",
    "Low / Won't Fix Now",
  ],
  severities: ["Critical", "High", "Medium", "Low"],
  acceptedSeverities: ["Medium", "Low"],
  lowWontFixSeverities: ["Low"],
  containmentMechanisms: [
    "isolation",
    "fail-closed",
    "feature-disabled",
    "manual-recovery",
    "known-issue",
    "follow-up-version",
  ],
  requiredRiskFields: [
    "knownIssueId",
    "classification",
    "issue",
    "severity",
    "impactBlastRadius",
    "containment",
    "stopEscalationCondition",
    "plannedFollowUpVersion",
    "nonWaivableBoundary",
  ],
  followUpVersionPatterns: ["^v[0-9]+\\.[0-9]+\\.[0-9]+$", "^governance-[1-9][0-9]*$"],
  noBoundaryValue: "none",
  nonWaivableBoundaries: [
    { id: "governance-state-authorization", description: "governance-state 可越权修改" },
    { id: "ruleset-required-check-integrity", description: "Ruleset 或 required check 可绕过、伪造或由错误集成满足" },
    { id: "candidate-identity-binding", description: "Candidate SHA、Tree、PR 或审计目标无法唯一绑定" },
    { id: "cas-revision-stale-write-protection", description: "CAS 或 revision 无法阻止陈旧覆盖" },
    { id: "failed-audit-forward-progress", description: "审计失败后仍可非法前进" },
    { id: "trusted-writer-boundary", description: "trusted writer 或独立 Gate 的信任边界失效" },
    { id: "write-outcome-integrity", description: "写入失败、未合并或未读回却报告成功" },
    { id: "release-candidate-eligibility", description: "错误 Candidate 获得发布资格" },
    { id: "production-data-security-irreversibility", description: "可能造成生产、数据、安全或不可逆治理错误" },
  ],
};
```

For each boundary, clone the contract, remove that boundary, and assert that `validateGovernanceContract` throws.

- [ ] **Step 2: Run the focused contract tests and confirm failure**

```powershell
node --experimental-strip-types --test --test-name-pattern="risk acceptance|non-waivable" tests/governance-contract.test.mjs
```

Expected: FAIL because `riskAcceptancePolicy` is not yet in the contract and trusted constant.

- [ ] **Step 3: Add the policy to JSON and the trusted constant**

Insert `riskAcceptancePolicy` beneath the existing `approvedCandidateShaRequiredOnPass` field in both `governance/role-contract.json` and `AUDIT_POLICY` in `scripts/governance-state.mjs`. Preserve the existing conclusion and Candidate identity fields byte-for-byte.

- [ ] **Step 4: Run focused tests and commit the contract lock**

```powershell
node --experimental-strip-types --test --test-name-pattern="risk acceptance|non-waivable|audit policy" tests/governance-contract.test.mjs
git diff --check
git add governance/role-contract.json scripts/governance-state.mjs tests/governance-contract.test.mjs
git commit -m "test: lock governance risk acceptance policy"
```

Expected: exact-policy and boundary-deletion tests pass.

### Task 3: Parse and validate fixed Markdown risk entries

**Files:**
- Modify: `scripts/governance-state.mjs`
- Test: `tests/governance-contract.test.mjs`

**Interfaces:**
- Consumes: canonical audit record body and `auditPolicy.riskAcceptancePolicy`.
- Produces: `requireRiskDisposition(record, riskAcceptancePolicy, conclusion)` which returns normalized risk entries or throws `GovernanceValidationError`.

- [ ] **Step 1: Extend test record builders**

Add helpers that produce either `风险项数量：0` or repeated blocks with these exact labels:

```js
function makeRiskDisposition(entries = []) {
  const blocks = entries.flatMap((entry) => [
    "### Known Issue：" + entry.knownIssueId,
    "风险分类：" + entry.classification,
    "Issue：" + entry.issue,
    "Severity：" + entry.severity,
    "Impact / Blast Radius：" + entry.impactBlastRadius,
    "Containment：" + entry.containment,
    "Stop / Escalation Condition：" + entry.stopEscalationCondition,
    "Planned Follow-up Version：" + entry.plannedFollowUpVersion,
    "Non-Waivable Boundary：" + entry.nonWaivableBoundary,
    "",
  ]);
  return ["## 风险处置", "", "风险项数量：" + entries.length, "", ...blocks].join("\n");
}
```

Ensure both plan-audit and RC-audit builders include this section, defaulting to zero entries.

- [ ] **Step 2: Add failing positive and negative builder tests**

Cover:

- isolated `Low` + `known-issue | 仅影响人工排障速度` + boundary `none` passes;
- contained `Medium` passes for the first two accepted classifications;
- `Low / Won't Fix Now` rejects `Medium`;
- `Critical` and `High` accepted entries fail;
- `Blocking Risk` with conclusion `通过` fails;
- each of nine boundary IDs marked Accepted fails;
- missing field, duplicate ID, count mismatch, invalid containment, placeholder value, invalid follow-up version, unknown classification, and unknown boundary fail;
- zero-risk records preserve current pass/fail state mapping;
- `有条件通过` remains invalid.

- [ ] **Step 3: Run the focused tests and confirm failure**

```powershell
node --experimental-strip-types --test --test-name-pattern="risk disposition|accepted Low|Blocking Risk|non-waivable" tests/governance-contract.test.mjs
```

Expected: FAIL because the parser is not implemented.

- [ ] **Step 4: Implement the minimal parser and validator**

Implement these focused functions near the existing audit-field helpers:

```js
const RISK_LABELS = Object.freeze({
  classification: "风险分类",
  issue: "Issue",
  severity: "Severity",
  impactBlastRadius: "Impact / Blast Radius",
  containment: "Containment",
  stopEscalationCondition: "Stop / Escalation Condition",
  plannedFollowUpVersion: "Planned Follow-up Version",
  nonWaivableBoundary: "Non-Waivable Boundary",
});

function auditRiskBlocks(body) {
  const lines = body.split(/\r?\n/u);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*###\s+Known Issue[：:]\s*(\S(?:.*\S)?)\s*$/u.exec(lines[index]);
    if (!match) continue;
    let end = index + 1;
    while (end < lines.length && !/^\s*#{1,3}\s+/u.test(lines[end])) end += 1;
    blocks.push({ knownIssueId: markdownAtom(match[1]), body: lines.slice(index + 1, end).join("\n") });
    index = end - 1;
  }
  return blocks;
}

function riskField(block, label) {
  const values = auditFieldValues(block.body, [label]);
  invariant(values.length === 1 && values[0].length > 0, "风险项必须准确包含一个" + label);
  const value = markdownAtom(values[0]);
  invariant(!/^(?:tbd|todo|unknown|待定|未知|无)$/iu.test(value), "风险项字段不能使用占位值：" + label);
  return value;
}

function requireRiskDisposition(body, policy, conclusion) {
  const countText = markdownAtom(requireAuditField(body, ["风险项数量"], "风险项数量"));
  invariant(/^(?:0|[1-9][0-9]*)$/u.test(countText), "风险项数量格式无效");
  const blocks = auditRiskBlocks(body);
  invariant(Number(countText) === blocks.length, "风险项数量与 Known Issue 块不匹配");
  const boundaryIds = new Set(policy.nonWaivableBoundaries.map(({ id }) => id));
  const seenIds = new Set();
  return blocks.map((block) => {
    invariant(block.knownIssueId.length > 0 && !seenIds.has(block.knownIssueId), "Known Issue ID 必须非空且唯一");
    seenIds.add(block.knownIssueId);
    const entry = { knownIssueId: block.knownIssueId };
    for (const [key, label] of Object.entries(RISK_LABELS)) entry[key] = riskField(block, label);
    invariant(policy.classifications.includes(entry.classification), "风险分类不在允许列表");
    invariant(policy.severities.includes(entry.severity), "Severity 不在允许列表");
    const containment = /^([a-z-]+)\s*\|\s*(\S(?:.*\S)?)$/u.exec(entry.containment);
    invariant(containment && policy.containmentMechanisms.includes(containment[1]), "Containment 必须使用允许的机制和具体措施");
    invariant(policy.followUpVersionPatterns.some((pattern) => new RegExp(pattern, "u").test(entry.plannedFollowUpVersion)), "Planned Follow-up Version 格式无效");
    invariant(entry.nonWaivableBoundary === policy.noBoundaryValue || boundaryIds.has(entry.nonWaivableBoundary), "Non-Waivable Boundary 未知");
    if (policy.passEligibleClassifications.includes(entry.classification)) {
      invariant(policy.acceptedSeverities.includes(entry.severity), "Accepted Risk 只能是 Medium 或 Low");
      if (entry.classification === "Low / Won't Fix Now") {
        invariant(policy.lowWontFixSeverities.includes(entry.severity), "Low / Won't Fix Now 只能是 Low");
      }
      invariant(entry.nonWaivableBoundary === policy.noBoundaryValue, "不可豁免边界不能标记为 Accepted Risk");
    }
    if (conclusion === "通过") {
      invariant(entry.classification !== "Blocking Risk", "Blocking Risk 不得进入通过结论");
      invariant(!["Critical", "High"].includes(entry.severity), "Critical 或 High 风险不得进入通过结论");
    }
    return entry;
  });
}
```

Validation order:

1. require exactly one `风险项数量` integer;
2. require count to equal exact block count;
3. reject duplicate Known Issue IDs;
4. reject blank, multiline, or placeholder field values;
5. enforce classification/severity compatibility;
6. parse `Containment` as `<allowlisted mechanism> | <non-empty detail>`;
7. match follow-up version against one trusted regex;
8. require boundary `none` or one known ID;
9. reject formal pass when any entry is Blocking, Critical/High, or has a non-`none` boundary;
10. return normalized entries without changing state.

Call it from `requireAuditRecord` after the conclusion/target binding and before Candidate identity checks.

- [ ] **Step 5: Run tests and commit the validator**

```powershell
node --experimental-strip-types --test --test-name-pattern="risk disposition|accepted Low|Blocking Risk|non-waivable|binds every formal|binds an RC" tests/governance-contract.test.mjs
git diff --check
git add scripts/governance-state.mjs tests/governance-contract.test.mjs
git commit -m "feat: enforce contained governance risks"
```

Expected: risk tests and existing conclusion/Candidate-binding tests pass.

### Task 4: Update audit roles, workflow text, and handoff templates

**Files:**
- Modify: `governance/README.md`
- Modify: `governance/workflow.md`
- Modify: `governance/roles/super-audit.md`
- Modify: `governance/roles/super-work.md`
- Modify: `governance/handoff/audit-report.md`
- Modify: `governance/handoff/release-candidate.md`
- Test: `tests/governance-contract.test.mjs`

**Interfaces:**
- Consumes: machine policy and fixed Markdown labels from Task 3.
- Produces: human-readable instructions that use the exact same classifications, fields, boundary IDs, and unchanged state semantics.

- [ ] **Step 1: Add failing documentation-contract tests**

Require the README, workflow, audit role, and audit template to contain all four classifications; all nine fixed field labels; explicit “不可豁免” language; and explicit confirmation that accepted low risk does not create a third audit conclusion.

Require the role-3 and Candidate template wording to state that role 3 discloses Known Issues but cannot approve or classify them as accepted on behalf of role 2.

- [ ] **Step 2: Run the focused documentation tests and confirm failure**

```powershell
node --experimental-strip-types --test --test-name-pattern="risk acceptance documentation|roles|handoff" tests/governance-contract.test.mjs
```

Expected: FAIL because the documents do not yet contain the fixed rules.

- [ ] **Step 3: Make the minimal document/template changes**

Use the exact field spellings from Task 3. Do not add a new handoff file or state. Keep the audit template's final conclusion constraints unchanged and place the risk disposition section before `最终结论`.

- [ ] **Step 4: Run tests and commit documentation**

```powershell
node --experimental-strip-types --test --test-name-pattern="risk acceptance documentation|roles|handoff" tests/governance-contract.test.mjs
git diff --check
git add governance/README.md governance/workflow.md governance/roles/super-audit.md governance/roles/super-work.md governance/handoff/audit-report.md governance/handoff/release-candidate.md tests/governance-contract.test.mjs
git commit -m "docs: define governance risk disposition"
```

Expected: documentation and role tests pass.

### Task 5: Prove builder and independent Gate behavior end-to-end

**Files:**
- Modify: `tests/governance-contract.test.mjs`
- No production or workflow file changes.

**Interfaces:**
- Consumes: `buildGovernanceTransition`, `buildProposalEnvelope`, and `verifyProtectedProposal`.
- Produces: end-to-end evidence that the proposal Gate accepts a contained Low risk and rejects accepted blockers without executing proposal code.

- [ ] **Step 1: Add a valid contained-Low proposal test**

Build an exact RC audit proposal with a current Candidate SHA/Tree/PR, final conclusion `通过`, target `RELEASE_APPROVED`, and one complete Low issue with boundary `none`. Verify both the builder result and `verifyProtectedProposal` result succeed.

- [ ] **Step 2: Add accepted-blocker proposal tests**

For `trusted-writer-boundary`, `candidate-identity-binding`, `cas-revision-stale-write-protection`, and `governance-state-authorization`, construct a byte-exact record proposal marked `Accepted / Contained Risk` and assert `verifyProtectedProposal` rejects it.

- [ ] **Step 3: Preserve existing wrong-Candidate and CAS regressions**

Run the existing failed/conditional/wrong-SHA/wrong-tree/wrong-PR Gate tests and protected-state/CAS tests together with the new cases.

- [ ] **Step 4: Run and commit end-to-end tests**

```powershell
node --experimental-strip-types --test --test-name-pattern="independent Gate|contained Low|accepted blocker|wrong-Candidate|CAS|protected" tests/governance-contract.test.mjs
git diff --check
git add tests/governance-contract.test.mjs
git commit -m "test: gate governance risk acceptance"
```

Expected: contained Low passes; every accepted blocker fails; existing trust-root and Candidate regressions remain green.

### Task 6: Run the complete Candidate verification gate

**Files:**
- Verify all changed files only; do not modify product or deployment state.

**Interfaces:**
- Consumes: completed governance implementation.
- Produces: reproducible Candidate evidence and a clean worktree.

- [ ] **Step 1: Governance and syntax verification**

```powershell
npm run governance:validate
node --experimental-strip-types --test tests/governance-contract.test.mjs
node --check scripts/governance-state.mjs
bash -n scripts/governance-protected-write.sh
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/governance-state.yml', aliases: true); puts 'yaml ok'"
git diff --check
```

Expected: all governance tests pass; Node, Bash, YAML, and diff checks pass.

- [ ] **Step 2: Complete repository verification**

```powershell
npm audit --omit=dev --audit-level=high
npm test
npm run lint
npx --no-install tsc --noEmit
npm run db:generate
npx --no-install wrangler deploy --dry-run --keep-vars --config wrangler.jsonc
git diff --exit-code -- wrangler.jsonc
```

Expected: no high/critical production dependency findings; tests, build, lint, types, migration drift, and Wrangler dry-run pass; `wrangler.jsonc` remains unchanged.

- [ ] **Step 3: Verify frozen scope**

```powershell
git diff --name-only origin/main...HEAD
git status --short --branch
```

Expected: only governance contracts/docs, the governance validator, governance tests, and the approved design/plan files differ; no product path is present.

### Task 7: Publish one new Candidate and stop at role 2 audit

**Files:**
- Update PR #13 body with accurate final evidence.
- Write Candidate handoff through the existing protected governance workflow.
- Do not alter production or tags.

**Interfaces:**
- Consumes: clean, verified PR #13 Head and current `governance-state` tip/revision.
- Produces: one immutable Candidate SHA/Tree bound to PR #13 and state `RC_AUDIT_PENDING`.

- [ ] **Step 1: Push the complete branch once local verification is final**

```powershell
git push origin governance/four-role-auto-handoff
git rev-parse HEAD
git rev-parse HEAD^{tree}
```

Expected: PR #13 Head equals local Head and Tree; no force push.

- [ ] **Step 2: Wait for exact-head CI and re-read identity**

Verify PR #13 is open, non-draft, same-repository, and its remote Head/Tree exactly match the local values. Re-run only checks required by an actual Head or dependency change.

- [ ] **Step 3: Perform the legal role-3 state transitions**

Read `governance-state` current tip/revision. Use the exact protected commands on PR #13 to transition:

1. `IMPLEMENTATION_REQUIRED → IMPLEMENTING`
2. after the exact Candidate is final, `IMPLEMENTING → RC_AUDIT_PENDING`

For each transition, require record-first then pointer-second PRs, exact head-bound `governance-state-write` from App id `15368`, CAS merge shape, and final readback. Never push `governance-state` directly.

- [ ] **Step 4: Re-read final Candidate and zero-deployment boundaries**

Confirm:

- state is `RC_AUDIT_PENDING`;
- Candidate SHA/Tree/PR/base/branch match PR #13 exactly;
- Candidate record digest matches the stored record;
- PR #13 remains open and unmerged;
- PR #14 remains unmerged;
- active production deployment and newest Worker Version are unchanged;
- no preview, Worker Version, Release, tag, D1/KV/Secret or production write occurred.

- [ ] **Step 5: Stop and hand off**

Report the exact Candidate SHA, Tree SHA, PR, CI runs, governance-state tip/revision/stage, protected transition PRs/checks, changed paths, validation results, Cloudflare before/after evidence, and any residual Known Issues. State: `下一角色：2（超级审计）`. Do not approve the Candidate and do not enter role 4.
