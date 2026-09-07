import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";

import {
  GOVERNANCE_STAGES,
  GovernanceValidationError,
  ROLE_NAMES,
  assertTransition,
  buildProposalEnvelope,
  buildGovernanceTransition,
  migrateFailedBootstrapAudit,
  remoteCandidateVerificationMode,
  recoverRole,
  scanGovernanceText,
  validateGovernanceContract,
  validateGovernanceState,
  validateGovernanceTransition,
  validateStateSchema,
  verifyProtectedProposal,
  verifyRecordFiles,
  verifyRemoteCandidate,
  verifyRemoteCandidateTransition,
} from "../scripts/governance-state.mjs";

const readText = (path) => readFile(path, "utf8");
const readJson = async (path) => JSON.parse(await readText(path));
const contractPath = "governance/role-contract.json";
const schemaPath = "governance/state-schema.json";
const digest = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const recordFiles = {
  plan: "01-plan.md",
  planAudit: "02-plan-audit.md",
  releaseCandidate: "04-release-candidate.md",
  rcAudit: "05-rc-audit.md",
  releaseReceipt: "06-release-receipt.md",
  blocked: "07-blocked.md",
};

async function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

function role(contract, number) {
  return contract.roles.find((item) => item.roleNumber === number);
}

function stateAt(stage, overrides = {}) {
  const version = overrides.activeVersion ?? "1.3.1";
  const records = Object.fromEntries(
    Object.entries(recordFiles).map(([key, file]) => [key, "governance/runtime/records/" + version + "/" + file]),
  );
  const recordDigests = Object.fromEntries(Object.keys(recordFiles).map((key) => [key, "a".repeat(64)]));
  return {
    schemaVersion: 2,
    project: "student-portfolio-cloudflare",
    repository: "q1433031046-ship-it/student-portfolio-cloudflare",
    activeVersion: version,
    stage,
    taskLevel: overrides.taskLevel ?? "L2",
    revision: overrides.revision ?? 10,
    lastUpdatedBy: overrides.lastUpdatedBy ?? { roleNumber: 3, roleName: "超级工作" },
    records: { ...records, ...overrides.records },
    recordDigests: { ...recordDigests, ...overrides.recordDigests },
    candidateSha: overrides.candidateSha === undefined ? "a".repeat(40) : overrides.candidateSha,
    candidateContext: overrides.candidateContext === undefined ? {
      branch: "release/v1.3.1",
      pullRequest: 20,
      baseSha: "b".repeat(40),
      treeSha: "c".repeat(40),
    } : overrides.candidateContext,
    releaseTag: overrides.releaseTag ?? null,
    block: overrides.block ?? null,
    bootstrap: overrides.bootstrap ?? null,
  };
}

function bootstrapState(overrides = {}) {
  const candidateSha = overrides.candidateSha ?? "e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b";
  return stateAt(overrides.stage ?? "IMPLEMENTATION_REQUIRED", {
    activeVersion: "governance-1",
    revision: overrides.revision ?? 3,
    lastUpdatedBy: overrides.lastUpdatedBy ?? { roleNumber: 2, roleName: "超级审计" },
    candidateSha,
    candidateContext: {
      branch: "governance/four-role-auto-handoff",
      pullRequest: 13,
      baseSha: "d81785dd51bb0c9be339449566a15d3b3971e02a",
      treeSha: "a54f47d5f5b5b54e18454d5faa7a4fc3a403228d",
    },
    records: { planAudit: null, ...overrides.records },
    recordDigests: { planAudit: null, ...overrides.recordDigests },
    bootstrap: {
      mode: "legacy-failed-audit-recovery",
      completed: true,
      sourceSchemaVersion: 1,
      sourceRevision: 2,
      sourceTip: "3e7867d3cdba75045f6dc8aa0448ccaac3547b68",
      legacyCandidateSha: "7caf24d4c52f1502d43cbf668329701986669a6e",
      candidateSha: "e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b",
      candidateBranch: "governance/four-role-auto-handoff",
      candidateTreeSha: "a54f47d5f5b5b54e18454d5faa7a4fc3a403228d",
      candidatePullRequest: 13,
      recoveryPullRequest: 14,
      recoveryHeadSha: "9451ef05fbe289aaade134bb60fb1a57e5eb15a6",
      baseSha: "d81785dd51bb0c9be339449566a15d3b3971e02a",
      targetStage: "IMPLEMENTATION_REQUIRED",
      auditConclusion: "failed",
    },
  });
}

function makeRcAuditRecord({
  auditId = "AUD-TEST-GOV-RC-001",
  candidateSha,
  candidateTreeSha,
  candidatePullRequest,
  conclusion,
  targetStage,
  format = "inline",
}) {
  const approvedCandidate = conclusion === "通过"
    ? "`" + candidateSha + "`"
    : format === "heading" ? "不适用（本轮不通过）" : "不适用";
  const conclusionLines = format === "heading"
    ? ["## 最终结论", "", "**" + conclusion + "。** 审计结论与目标状态必须保持绑定。"]
    : ["最终结论：" + conclusion];
  return [
    "审计编号：" + auditId,
    "审计类型：候选版本审计",
    "审计对象 Candidate SHA：`" + candidateSha + "`",
    "审计对象 Tree SHA：`" + candidateTreeSha + "`",
    "审计对象 PR：`#" + candidatePullRequest + "`",
    ...conclusionLines,
    "批准 Candidate SHA：" + approvedCandidate,
    "目标状态：`" + targetStage + "`",
    "下一角色：" + (targetStage === "RELEASE_APPROVED" ? "4 / 超级发布" : "3 / 超级工作"),
    "",
  ].join("\n");
}

function makePlanAuditRecord({ conclusion, targetStage }) {
  return [
    "审计编号：AUD-TEST-GOV-PLAN-001",
    "审计类型：方案审计",
    "最终结论：" + conclusion,
    "目标状态：`" + targetStage + "`",
    "",
  ].join("\n");
}

test("enforces the complete frozen role matrix as an exact allowlist", async () => {
  const original = validateGovernanceContract(await readJson(contractPath));
  assert.deepEqual(Object.fromEntries(original.roles.map((item) => [item.roleNumber, item.roleName])), ROLE_NAMES);
  for (const originalRole of original.roles) {
    for (const field of ["roleName", "slug", "contractPath", "handoffTemplate"]) {
      const mutated = structuredClone(original);
      role(mutated, originalRole.roleNumber)[field] += "-forbidden";
      assert.throws(() => validateGovernanceContract(mutated), /完全一致/u, "accepted role mutation " + originalRole.roleNumber + "." + field);
    }
    for (const capability of Object.keys(originalRole.capabilities)) {
      const mutated = structuredClone(original);
      role(mutated, originalRole.roleNumber).capabilities[capability] = !originalRole.capabilities[capability];
      assert.throws(() => validateGovernanceContract(mutated), /完全一致/u, "accepted capability mutation " + originalRole.roleNumber + "." + capability);
    }
    const extraCapability = structuredClone(original);
    role(extraCapability, originalRole.roleNumber).capabilities.canBypassAudit = true;
    assert.throws(() => validateGovernanceContract(extraCapability), /完全一致/u);
    const deletedCapability = structuredClone(original);
    delete role(deletedCapability, originalRole.roleNumber).capabilities.canDeployProduction;
    assert.throws(() => validateGovernanceContract(deletedCapability), /完全一致/u);
    for (const field of ["readStages", "transitions"]) {
      const added = structuredClone(original);
      role(added, originalRole.roleNumber)[field].push(field === "readStages" ? "RELEASING" : { from: "IDLE", to: "RELEASE_APPROVED" });
      assert.throws(() => validateGovernanceContract(added), /完全一致/u, "accepted extra " + field);
      const removed = structuredClone(original);
      role(removed, originalRole.roleNumber)[field].pop();
      assert.throws(() => validateGovernanceContract(removed), /完全一致/u, "accepted removed " + field);
    }
  }
});

test("keeps the two audit gates and every recovery transition explicit", async () => {
  const contract = await readJson(contractPath);
  assert.deepEqual(contract.requiredWorkflowStages, GOVERNANCE_STAGES);
  assert.deepEqual(contract.auditPolicy.acceptedConclusions, ["通过", "不通过"]);
  assert.deepEqual(contract.auditPolicy.conclusionTargets, {
    PLAN_AUDIT_PENDING: { "通过": "IMPLEMENTATION_APPROVED", "不通过": "PLANNING_REQUIRED" },
    RC_AUDIT_PENDING: { "通过": "RELEASE_APPROVED", "不通过": "IMPLEMENTATION_REQUIRED" },
  });
  assert.deepEqual(contract.auditPolicy.rcAuditIdentityFields, ["candidateSha", "candidateTreeSha", "candidatePullRequest"]);
  assertTransition(contract, 2, "PLAN_AUDIT_PENDING", "IMPLEMENTATION_APPROVED");
  assertTransition(contract, 3, "IMPLEMENTING", "RC_AUDIT_PENDING");
  assertTransition(contract, 2, "RC_AUDIT_PENDING", "RELEASE_APPROVED");
  assertTransition(contract, 3, "ROLLED_BACK", "IMPLEMENTATION_REQUIRED");
  assertTransition(contract, 2, "BLOCKED", "RC_AUDIT_PENDING");
  assert.throws(() => assertTransition(contract, 1, "IDLE", "RELEASE_APPROVED"), GovernanceValidationError);
  assert.throws(() => assertTransition(contract, 3, "RC_AUDIT_PENDING", "RELEASE_APPROVED"), GovernanceValidationError);
  const mutated = structuredClone(contract);
  mutated.auditPolicy.conclusionTargets.RC_AUDIT_PENDING["有条件通过"] = "RELEASE_APPROVED";
  assert.throws(() => validateGovernanceContract(mutated), /完全一致/u);
});

test("executes the Draft 2020-12 schema and keeps schema-expressible failures equivalent", async () => {
  const [schema, current, snapshot] = await Promise.all([
    readJson(schemaPath),
    readJson("governance/runtime-example/current.json"),
    readJson("governance/runtime-example/version-state.json"),
  ]);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.properties.stage.enum, GOVERNANCE_STAGES);
  validateStateSchema(current);
  validateGovernanceState(current);
  validateStateSchema(snapshot);
  validateGovernanceState(snapshot);

  const mutations = [
    (state) => { state.schemaVersion = 1; },
    (state) => { state.extra = true; },
    (state) => { state.lastUpdatedBy.roleName = "超级审计"; },
    (state) => { state.recordDigests.plan = "short"; },
    (state) => { state.block = { sourceStage: "UNKNOWN", ownerRoleNumber: 3 }; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(current);
    mutate(invalid);
    assert.throws(() => validateStateSchema(invalid), GovernanceValidationError);
    assert.throws(() => validateGovernanceState(invalid), GovernanceValidationError);
  }
});

test("binds every record to activeVersion, fixed type and matching SHA-256", async () => {
  const valid = stateAt("RC_AUDIT_PENDING");
  validateGovernanceState(valid);

  const crossVersion = structuredClone(valid);
  crossVersion.records.plan = "governance/runtime/records/9.9.9/01-plan.md";
  assert.throws(() => validateGovernanceState(crossVersion), /activeVersion/u);

  const wrongType = structuredClone(valid);
  wrongType.records.rcAudit = "governance/runtime/records/1.3.1/01-plan.md";
  assert.throws(() => validateGovernanceState(wrongType), /固定记录类型/u);

  const missingDigest = structuredClone(valid);
  missingDigest.recordDigests.plan = null;
  assert.throws(() => validateGovernanceState(missingDigest), /Schema|同时为空或同时存在/u);
});

test("requires the complete audit chain and limits bootstrap to the exact governance candidate", () => {
  const normal = stateAt("RC_AUDIT_PENDING");
  normal.records.planAudit = null;
  normal.recordDigests.planAudit = null;
  assert.throws(() => validateGovernanceState(normal), /Schema|planAudit/u);

  validateGovernanceState(bootstrapState());

  const future = bootstrapState({ activeVersion: "governance-2" });
  future.activeVersion = "governance-2";
  for (const key of Object.keys(future.records)) {
    if (future.records[key]) future.records[key] = future.records[key].replace("governance-1", "governance-2");
  }
  assert.throws(() => validateGovernanceState(future), /bootstrap 只能用于固定治理版本/u);

  const changedBase = bootstrapState();
  changedBase.candidateContext.baseSha = "f".repeat(40);
  assert.throws(() => validateGovernanceState(changedBase), /失败审计恢复 Candidate 上下文/u);
});

test("rejects every same-stage write and freezes approved Candidate identity", async () => {
  const contract = await readJson(contractPath);
  const pending = stateAt("RC_AUDIT_PENDING", { revision: 20 });
  const replacement = stateAt("RC_AUDIT_PENDING", {
    revision: 21,
    candidateSha: "f".repeat(40),
    lastUpdatedBy: { roleNumber: 3, roleName: "超级工作" },
  });
  assert.throws(() => validateGovernanceTransition(pending, replacement, contract), /禁止同阶段改写/u);

  const approved = stateAt("RELEASE_APPROVED", {
    revision: 21,
    lastUpdatedBy: { roleNumber: 2, roleName: "超级审计" },
  });
  const preflight = stateAt("PRODUCTION_PREFLIGHT", {
    revision: 22,
    lastUpdatedBy: { roleNumber: 4, roleName: "超级发布" },
    candidateSha: "f".repeat(40),
  });
  assert.throws(() => validateGovernanceTransition(approved, preflight, contract), /不得修改字段 candidateSha|已冻结/u);
});

test("applies a per-transition field allowlist instead of stage-only authorization", async () => {
  const contract = await readJson(contractPath);
  const pending = stateAt("RC_AUDIT_PENDING", { revision: 20 });
  const approved = structuredClone(pending);
  approved.stage = "RELEASE_APPROVED";
  approved.revision = 21;
  approved.lastUpdatedBy = { roleNumber: 2, roleName: "超级审计" };
  approved.recordDigests.rcAudit = "b".repeat(64);
  validateGovernanceTransition(pending, approved, contract);

  const expanded = structuredClone(approved);
  expanded.taskLevel = "L3";
  assert.throws(() => validateGovernanceTransition(pending, expanded, contract), /不得修改字段 taskLevel/u);

  const wrongWriter = structuredClone(approved);
  wrongWriter.lastUpdatedBy = { roleNumber: 3, roleName: "超级工作" };
  assert.throws(() => validateGovernanceTransition(pending, wrongWriter, contract), /无权执行/u);
});

test("recovers BLOCKED only through its recorded owner and source stage", async () => {
  const contract = await readJson(contractPath);
  const implementing = stateAt("IMPLEMENTING", { revision: 30 });
  const blocked = structuredClone(implementing);
  blocked.stage = "BLOCKED";
  blocked.revision = 31;
  blocked.block = { sourceStage: "IMPLEMENTING", ownerRoleNumber: 3 };
  blocked.recordDigests.blocked = "b".repeat(64);
  validateGovernanceTransition(implementing, blocked, contract);
  assert.equal(recoverRole(blocked, 3).action, "按阻断记录恢复到来源对应的安全阶段");
  assert.throws(() => recoverRole(blocked, 4), /应由 3/u);

  const recovered = structuredClone(blocked);
  recovered.stage = "IMPLEMENTING";
  recovered.revision = 32;
  recovered.block = null;
  recovered.records.blocked = null;
  recovered.recordDigests.blocked = null;
  validateGovernanceTransition(blocked, recovered, contract);

  const hijacked = structuredClone(recovered);
  hijacked.lastUpdatedBy = { roleNumber: 1, roleName: "超级规划" };
  assert.throws(() => validateGovernanceTransition(blocked, hijacked, contract), /无权|责任角色/u);
});

test("routes ROLLED_BACK to role 3 and blocks release-role guessing", async () => {
  const contract = await readJson(contractPath);
  const rolledBack = stateAt("ROLLED_BACK", {
    revision: 40,
    lastUpdatedBy: { roleNumber: 4, roleName: "超级发布" },
  });
  const route = recoverRole(rolledBack, 3);
  assert.equal(route.action, "读取回滚回执并修复实现");
  assert.throws(() => recoverRole(rolledBack, 4), /应由 3/u);
  const repair = structuredClone(rolledBack);
  repair.stage = "IMPLEMENTATION_REQUIRED";
  repair.revision = 41;
  repair.lastUpdatedBy = { roleNumber: 3, roleName: "超级工作" };
  validateGovernanceTransition(rolledBack, repair, contract);
});

test("scans state and Markdown records without echoing discovered secret values", async (t) => {
  scanGovernanceText("审计编号：AUD-TEST\n生产资源：已核对\n");
  for (const canary of [
    "github_pat_11abcdefghijklmnop",
    "adminPassword=fictional-canary",
    "student@example.com",
    "resource 0123456789abcdef0123456789abcdef",
    "https://example.test/access?token=fictional-canary",
  ]) {
    assert.throws(() => scanGovernanceText(canary), (error) => {
      assert.doesNotMatch(error.message, /fictional-canary|example\.com|0123456789abcdef/u);
      return true;
    });
  }

  const root = await mkdtemp(join(tmpdir(), "governance-records-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const content = "规划编号：PLAN-1\n目标：治理测试\n";
  const state = stateAt("PLAN_AUDIT_PENDING", {
    candidateSha: null,
    candidateContext: null,
    records: { planAudit: null, releaseCandidate: null, rcAudit: null, releaseReceipt: null, blocked: null },
    recordDigests: {
      plan: digest(content),
      planAudit: null,
      releaseCandidate: null,
      rcAudit: null,
      releaseReceipt: null,
      blocked: null,
    },
    lastUpdatedBy: { roleNumber: 1, roleName: "超级规划" },
  });
  const path = join(root, state.records.plan);
  await mkdir(join(root, "governance/runtime/records/1.3.1"), { recursive: true });
  await writeFile(path, content);
  await verifyRecordFiles(state, root);
  await writeFile(path, content + "password=fictional-canary\n");
  await assert.rejects(() => verifyRecordFiles(state, root), /无秘密检查|摘要不匹配/u);
});

test("verifies Candidate commit, tree, branch, PR and ancestry against GitHub", async () => {
  const state = stateAt("RC_AUDIT_PENDING");
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    let body;
    if (url.includes("/git/commits/")) body = { sha: "a".repeat(40), tree: { sha: "c".repeat(40) } };
    else if (url.includes("/branches/")) body = { commit: { sha: "a".repeat(40) } };
    else if (url.includes("/pulls/")) body = {
      state: "open",
      draft: false,
      head: { sha: "a".repeat(40), ref: "release/v1.3.1", repo: { full_name: state.repository } },
      base: { sha: "b".repeat(40), ref: "main", repo: { full_name: state.repository } },
    };
    else body = { status: "ahead" };
    return { ok: true, status: 200, json: async () => body };
  };
  const evidence = await verifyRemoteCandidate(state, { token: "fictional", fetchImpl });
  assert.equal(evidence.treeSha, "c".repeat(40));
  assert.equal(calls.length, 4);

  const movedBranch = async (url) => {
    if (url.includes("/git/commits/")) return { ok: true, status: 200, json: async () => ({ sha: "a".repeat(40), tree: { sha: "c".repeat(40) } }) };
    return { ok: true, status: 200, json: async () => ({ commit: { sha: "f".repeat(40) } }) };
  };
  await assert.rejects(() => verifyRemoteCandidate(state, { token: "fictional", fetchImpl: movedBranch }), /分支 tip 已变化/u);
});

test("transition-aware remote Candidate verification treats a rejected Candidate as historical only after entering implementation", async () => {
  const contract = await readJson(contractPath);
  const previous = bootstrapState();
  const movedSourcePr = {
    number: 13,
    state: "open",
    draft: false,
    body: "Implementation entry only\n",
    head: {
      sha: "d".repeat(40),
      ref: previous.candidateContext.branch,
      repo: { full_name: previous.repository },
    },
    base: {
      sha: "f".repeat(40),
      ref: "main",
      repo: { full_name: previous.repository },
    },
  };
  const next = buildGovernanceTransition(previous, {
    roleNumber: 3,
    targetStage: "IMPLEMENTING",
    pullRequest: movedSourcePr,
    treeSha: "e".repeat(40),
  }, contract).state;

  assert.equal(remoteCandidateVerificationMode(previous, next, contract), "historical-object");
  const calls = [];
  const objectOnlyFetch = async (url) => {
    calls.push(url);
    assert.match(url, /\/git\/commits\//u);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        sha: previous.candidateSha,
        tree: { sha: previous.candidateContext.treeSha },
      }),
    };
  };
  const evidence = await verifyRemoteCandidateTransition(previous, next, {
    contract,
    token: "fictional",
    fetchImpl: objectOnlyFetch,
  });
  assert.equal(evidence.mode, "historical-object");
  assert.equal(evidence.candidateSha, previous.candidateSha);
  assert.equal(evidence.treeSha, previous.candidateContext.treeSha);
  assert.equal(calls.length, 1);

  const implementation = stateAt("IMPLEMENTING", {
    revision: 20,
    lastUpdatedBy: { roleNumber: 3, roleName: "超级工作" },
  });
  const blocked = buildGovernanceTransition(implementation, {
    roleNumber: 3,
    targetStage: "BLOCKED",
    pullRequest: {
      ...movedSourcePr,
      body: "阻断编号：TEST-IMPLEMENTATION-BLOCK\n原因：实现分支已经移动，必须允许角色 3 失败关闭并保留历史 Candidate 证据。\n",
    },
    treeSha: "e".repeat(40),
  }, contract).state;
  assert.equal(blocked.block.sourceStage, "IMPLEMENTING");
  assert.equal(remoteCandidateVerificationMode(implementation, blocked, contract), "historical-object");

  const wrongTree = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sha: previous.candidateSha, tree: { sha: "0".repeat(40) } }),
  });
  await assert.rejects(() => verifyRemoteCandidateTransition(previous, next, {
    contract,
    token: "fictional",
    fetchImpl: wrongTree,
  }), /Candidate tree 不匹配/u);
});

test("transition-aware remote Candidate verification keeps the complete live gate for a new RC", async () => {
  const contract = await readJson(contractPath);
  const previous = bootstrapState({
    stage: "IMPLEMENTING",
    revision: 4,
    lastUpdatedBy: { roleNumber: 3, roleName: "超级工作" },
  });
  const candidateSha = "d".repeat(40);
  const candidateTreeSha = "e".repeat(40);
  const candidateBaseSha = "f".repeat(40);
  const pr = {
    number: 13,
    state: "open",
    draft: false,
    body: "Candidate SHA：`" + candidateSha + "`\n测试：全部通过\n生产环境修改：没有\n",
    head: {
      sha: candidateSha,
      ref: previous.candidateContext.branch,
      repo: { full_name: previous.repository },
    },
    base: {
      sha: candidateBaseSha,
      ref: "main",
      repo: { full_name: previous.repository },
    },
  };
  const next = buildGovernanceTransition(previous, {
    roleNumber: 3,
    targetStage: "RC_AUDIT_PENDING",
    pullRequest: pr,
    treeSha: candidateTreeSha,
  }, contract).state;

  assert.equal(remoteCandidateVerificationMode(previous, next, contract), "live");
  const calls = [];
  const liveFetch = async (url) => {
    calls.push(url);
    let body;
    if (url.includes("/git/commits/")) body = { sha: candidateSha, tree: { sha: candidateTreeSha } };
    else if (url.includes("/branches/")) body = { commit: { sha: candidateSha } };
    else if (url.includes("/pulls/")) body = {
      state: "open",
      draft: false,
      head: { sha: candidateSha, ref: pr.head.ref, repo: { full_name: previous.repository } },
      base: { sha: candidateBaseSha, ref: "main", repo: { full_name: previous.repository } },
    };
    else body = { status: "ahead" };
    return { ok: true, status: 200, json: async () => body };
  };
  const evidence = await verifyRemoteCandidateTransition(previous, next, {
    contract,
    token: "fictional",
    fetchImpl: liveFetch,
  });
  assert.equal(evidence.mode, "live");
  assert.equal(evidence.candidateSha, candidateSha);
  assert.equal(evidence.treeSha, candidateTreeSha);
  assert.equal(calls.length, 4);

  const liveFetchWith = (mode) => async (url) => {
    if (mode === "moved-branch" && url.includes("/branches/")) {
      return { ok: true, status: 200, json: async () => ({ commit: { sha: "0".repeat(40) } }) };
    }
    if (mode === "wrong-pr-head" && url.includes("/pulls/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          state: "open",
          draft: false,
          head: { sha: "0".repeat(40), ref: pr.head.ref, repo: { full_name: previous.repository } },
          base: { sha: candidateBaseSha, ref: "main", repo: { full_name: previous.repository } },
        }),
      };
    }
    if (mode === "wrong-pr-base" && url.includes("/pulls/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          state: "open",
          draft: false,
          head: { sha: candidateSha, ref: pr.head.ref, repo: { full_name: previous.repository } },
          base: { sha: "0".repeat(40), ref: "main", repo: { full_name: previous.repository } },
        }),
      };
    }
    if (mode === "diverged" && url.includes("/compare/")) {
      return { ok: true, status: 200, json: async () => ({ status: "diverged" }) };
    }
    return liveFetch(url);
  };
  for (const [mode, message] of [
    ["moved-branch", /Candidate 分支 tip 已变化/u],
    ["wrong-pr-head", /Candidate PR head SHA 不匹配/u],
    ["wrong-pr-base", /Candidate PR 基线不匹配/u],
    ["diverged", /Candidate 不是冻结基线的后代/u],
  ]) {
    await assert.rejects(() => verifyRemoteCandidateTransition(previous, next, {
      contract,
      token: "fictional",
      fetchImpl: liveFetchWith(mode),
    }), message);
  }
});

test("builds a Candidate transition only from an immutable same-repository PR", async () => {
  const contract = await readJson(contractPath);
  const previous = stateAt("IMPLEMENTING", { revision: 50 });
  const sha = "d".repeat(40);
  const pr = {
    number: 13,
    state: "open",
    draft: false,
    body: "Candidate SHA：" + sha + "\n测试：全部通过\n生产环境修改：没有\n",
    head: { sha, ref: "governance/four-role-auto-handoff", repo: { full_name: previous.repository } },
    base: { sha: "b".repeat(40), ref: "main", repo: { full_name: previous.repository } },
  };
  const result = buildGovernanceTransition(previous, {
    roleNumber: 3,
    targetStage: "RC_AUDIT_PENDING",
    pullRequest: pr,
    treeSha: "e".repeat(40),
  }, contract);
  assert.equal(result.recordKey, "releaseCandidate");
  assert.equal(result.state.candidateSha, sha);
  assert.equal(result.state.recordDigests.releaseCandidate, digest(result.record));
  assert.equal(result.state.records.rcAudit, null);

  const fork = structuredClone(pr);
  fork.head.repo.full_name = "fork/repository";
  assert.throws(() => buildGovernanceTransition(previous, {
    roleNumber: 3,
    targetStage: "RC_AUDIT_PENDING",
    pullRequest: fork,
    treeSha: "e".repeat(40),
  }, contract), /禁止来自 fork/u);
});

test("binds every formal plan-audit conclusion to its exact target state", async () => {
  const contract = await readJson(contractPath);
  const previous = stateAt("PLAN_AUDIT_PENDING", {
    revision: 50,
    candidateSha: null,
    candidateContext: null,
    records: { planAudit: null, releaseCandidate: null, rcAudit: null, releaseReceipt: null },
    recordDigests: { planAudit: null, releaseCandidate: null, rcAudit: null, releaseReceipt: null },
  });
  const build = (conclusion, targetStage, recordedTarget = targetStage) => buildGovernanceTransition(previous, {
    roleNumber: 2,
    targetStage,
    pullRequest: {
      number: 19,
      state: "open",
      draft: false,
      body: makePlanAuditRecord({ conclusion, targetStage: recordedTarget }),
      head: { sha: "d".repeat(40), ref: "planning/v1.3.1", repo: { full_name: previous.repository } },
      base: { sha: "b".repeat(40), ref: "main", repo: { full_name: previous.repository } },
    },
    treeSha: "e".repeat(40),
  }, contract);

  assert.equal(build("通过", "IMPLEMENTATION_APPROVED").state.stage, "IMPLEMENTATION_APPROVED");
  assert.equal(build("不通过", "PLANNING_REQUIRED").state.stage, "PLANNING_REQUIRED");
  assert.throws(() => build("不通过", "IMPLEMENTATION_APPROVED"), GovernanceValidationError);
  assert.throws(() => build("有条件通过", "IMPLEMENTATION_APPROVED"), GovernanceValidationError);
  assert.throws(() => build("通过", "IMPLEMENTATION_APPROVED", "PLANNING_REQUIRED"), GovernanceValidationError);
});

test("binds an RC audit conclusion and target to the current Candidate SHA, Tree and PR", async () => {
  const contract = await readJson(contractPath);
  const candidateSha = "a".repeat(40);
  const candidateTreeSha = "c".repeat(40);
  const candidatePullRequest = 20;
  const previous = stateAt("RC_AUDIT_PENDING", {
    revision: 51,
    candidateSha,
    candidateContext: {
      branch: "release/v1.3.1",
      pullRequest: candidatePullRequest,
      baseSha: "b".repeat(40),
      treeSha: candidateTreeSha,
    },
  });
  const makePr = (body, overrides = {}) => ({
    number: overrides.number ?? candidatePullRequest,
    state: "open",
    draft: false,
    body,
    head: {
      sha: overrides.headSha ?? candidateSha,
      ref: overrides.headRef ?? previous.candidateContext.branch,
      repo: { full_name: previous.repository },
    },
    base: {
      sha: overrides.baseSha ?? previous.candidateContext.baseSha,
      ref: "main",
      repo: { full_name: previous.repository },
    },
  });
  const build = (conclusion, targetStage, recordOverrides = {}, prOverrides = {}) => buildGovernanceTransition(previous, {
    roleNumber: 2,
    targetStage,
    pullRequest: makePr(makeRcAuditRecord({
      candidateSha: recordOverrides.candidateSha ?? candidateSha,
      candidateTreeSha: recordOverrides.candidateTreeSha ?? candidateTreeSha,
      candidatePullRequest: recordOverrides.candidatePullRequest ?? candidatePullRequest,
      conclusion,
      targetStage: recordOverrides.targetStage ?? targetStage,
    }), prOverrides),
    treeSha: prOverrides.treeSha ?? candidateTreeSha,
  }, contract);

  const approved = build("通过", "RELEASE_APPROVED");
  assert.equal(approved.state.stage, "RELEASE_APPROVED");
  assert.equal(approved.state.candidateSha, candidateSha);
  assert.equal(approved.recordKey, "rcAudit");

  const rejected = build("不通过", "IMPLEMENTATION_REQUIRED");
  assert.equal(rejected.state.stage, "IMPLEMENTATION_REQUIRED");
  assert.equal(rejected.state.candidateContext.treeSha, candidateTreeSha);

  const rejectedInputs = [
    () => build("不通过", "RELEASE_APPROVED"),
    () => build("有条件通过", "RELEASE_APPROVED"),
    () => build("通过", "RELEASE_APPROVED", { candidateSha: "d".repeat(40) }),
    () => build("通过", "RELEASE_APPROVED", { candidateTreeSha: "e".repeat(40) }),
    () => build("通过", "RELEASE_APPROVED", { candidatePullRequest: 21 }),
    () => build("通过", "RELEASE_APPROVED", { targetStage: "IMPLEMENTATION_REQUIRED" }),
    () => build("通过", "RELEASE_APPROVED", {}, { headSha: "d".repeat(40) }),
    () => build("通过", "RELEASE_APPROVED", {}, { treeSha: "e".repeat(40) }),
    () => build("通过", "RELEASE_APPROVED", {}, { number: 21 }),
  ];
  for (const rejectedInput of rejectedInputs) {
    assert.throws(rejectedInput, GovernanceValidationError);
  }
});

test("migrates the fixed failed bootstrap audit to implementation required exactly once", async () => {
  const contract = await readJson(contractPath);
  const repository = "q1433031046-ship-it/student-portfolio-cloudflare";
  const legacyTip = "3e7867d3cdba75045f6dc8aa0448ccaac3547b68";
  const candidateSha = "e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b";
  const candidateTreeSha = "a54f47d5f5b5b54e18454d5faa7a4fc3a403228d";
  const recoveryHeadSha = "9451ef05fbe289aaade134bb60fb1a57e5eb15a6";
  const legacy = {
    schemaVersion: 1,
    project: "student-portfolio-cloudflare",
    repository,
    activeVersion: "governance-1",
    stage: "RC_AUDIT_PENDING",
    taskLevel: "L2",
    revision: 2,
    lastUpdatedBy: { roleNumber: 3, roleName: "超级工作" },
    records: {
      plan: "governance/runtime/records/governance-1/01-plan.md",
      planAudit: null,
      releaseCandidate: "governance/runtime/records/governance-1/04-release-candidate-r2.md",
      rcAudit: null,
      releaseReceipt: null,
    },
    candidateSha: "7caf24d4c52f1502d43cbf668329701986669a6e",
    releaseTag: null,
    bootstrap: { isBootstrapCandidate: true },
  };
  const candidatePullRequest = {
    number: 13,
    state: "open",
    draft: false,
    head: {
      sha: candidateSha,
      ref: "governance/four-role-auto-handoff",
      repo: { full_name: repository },
    },
    base: {
      sha: "d81785dd51bb0c9be339449566a15d3b3971e02a",
      ref: "main",
      repo: { full_name: repository },
    },
  };
  const recoveryPullRequest = {
    number: 14,
    state: "open",
    draft: false,
    head: {
      sha: recoveryHeadSha,
      ref: "recovery/governance-rc-audit-r1",
      repo: { full_name: repository },
    },
    base: {
      sha: legacyTip,
      ref: "governance-state",
      repo: { full_name: repository },
    },
  };
  const request = {
    legacyTip,
    candidatePullRequest,
    recoveryPullRequest,
    candidateTreeSha,
    planRecord: "规划编号：GOV-PLAN-1\n目标：四角色治理固化\n",
    releaseCandidateRecord: [
      "候选编号：GOV-RC-FAILED-1",
      "Candidate SHA：`" + candidateSha + "`",
      "Tree SHA：`" + candidateTreeSha + "`",
      "生产环境修改：没有",
      "",
    ].join("\n"),
    rcAuditRecord: makeRcAuditRecord({
      auditId: "AUD-20260831-GOV-RC-001",
      candidateSha,
      candidateTreeSha,
      candidatePullRequest: 13,
      conclusion: "不通过",
      targetStage: "IMPLEMENTATION_REQUIRED",
      format: "heading",
    }),
  };

  const result = migrateFailedBootstrapAudit(legacy, request, contract);
  assert.equal(result.state.schemaVersion, 2);
  assert.equal(result.state.revision, 3);
  assert.equal(result.state.stage, "IMPLEMENTATION_REQUIRED");
  assert.deepEqual(result.state.lastUpdatedBy, { roleNumber: 2, roleName: "超级审计" });
  assert.equal(result.state.candidateSha, candidateSha);
  assert.deepEqual(result.state.candidateContext, {
    branch: "governance/four-role-auto-handoff",
    pullRequest: 13,
    baseSha: "d81785dd51bb0c9be339449566a15d3b3971e02a",
    treeSha: candidateTreeSha,
  });
  assert.equal(result.state.records.planAudit, null);
  assert.equal(result.state.records.releaseCandidate, "governance/runtime/records/governance-1/04-release-candidate.md");
  assert.equal(result.state.records.rcAudit, "governance/runtime/records/governance-1/05-rc-audit.md");
  assert.equal(result.state.recordDigests.releaseCandidate, digest(request.releaseCandidateRecord));
  assert.equal(result.state.recordDigests.rcAudit, digest(request.rcAuditRecord));
  assert.equal(result.state.bootstrap.mode, "legacy-failed-audit-recovery");
  assert.equal(result.state.bootstrap.completed, true);
  assert.equal(result.state.bootstrap.sourceTip, legacyTip);
  assert.equal(result.state.bootstrap.recoveryHeadSha, recoveryHeadSha);

  const mutations = [
    (input) => { input.legacyTip = "f".repeat(40); },
    (input) => { input.candidateTreeSha = "f".repeat(40); },
    (input) => { input.candidatePullRequest.head.sha = "f".repeat(40); },
    (input) => { input.recoveryPullRequest.head.sha = "f".repeat(40); },
    (input) => { input.rcAuditRecord = input.rcAuditRecord.replace("不通过", "通过"); },
    (input) => { input.rcAuditRecord = input.rcAuditRecord.replace("不通过", "有条件通过"); },
    (input) => { input.rcAuditRecord = input.rcAuditRecord.replace(candidateSha, "f".repeat(40)); },
    (input) => { input.rcAuditRecord = input.rcAuditRecord.replace(candidateTreeSha, "f".repeat(40)); },
    (input) => { input.rcAuditRecord = input.rcAuditRecord.replace("`#13`", "`#12`"); },
    (input) => { input.rcAuditRecord = input.rcAuditRecord.replace("IMPLEMENTATION_REQUIRED", "RELEASE_APPROVED"); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(request);
    mutate(changed);
    assert.throws(() => migrateFailedBootstrapAudit(legacy, changed, contract), GovernanceValidationError);
  }

  const replay = structuredClone(result.state);
  assert.throws(() => migrateFailedBootstrapAudit(replay, request, contract), /Schema 1/u);
});

test("verifies an untrusted protected proposal independently", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "governance-proposal-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseRoot = join(root, "base");
  const recordsRoot = join(root, "records");
  const pointerRoot = join(root, "pointer");
  const earlyPointerRoot = join(root, "early-pointer");
  const repository = "q1433031046-ship-it/student-portfolio-cloudflare";
  const legacyTip = "3e7867d3cdba75045f6dc8aa0448ccaac3547b68";
  const candidateSha = "e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b";
  const candidateTreeSha = "a54f47d5f5b5b54e18454d5faa7a4fc3a403228d";
  const recoveryHeadSha = "9451ef05fbe289aaade134bb60fb1a57e5eb15a6";
  const recordPath = "governance/runtime/records/governance-1/04-release-candidate.md";
  const auditPath = "governance/runtime/records/governance-1/05-rc-audit.md";
  const currentPath = "governance/runtime/current.json";
  const versionPath = "governance/runtime/versions/governance-1.json";
  const planRecord = "规划编号：GOV-PLAN-1\n目标：四角色治理固化\n";
  const releaseCandidateRecord = [
    "候选编号：GOV-RC-FAILED-1",
    "Candidate SHA：`" + candidateSha + "`",
    "Tree SHA：`" + candidateTreeSha + "`",
    "生产环境修改：没有",
    "",
  ].join("\n");
  const rcAuditRecord = makeRcAuditRecord({
    auditId: "AUD-20260831-GOV-RC-001",
    candidateSha,
    candidateTreeSha,
    candidatePullRequest: 13,
    conclusion: "不通过",
    targetStage: "IMPLEMENTATION_REQUIRED",
    format: "heading",
  });
  const legacy = {
    schemaVersion: 1,
    project: "student-portfolio-cloudflare",
    repository,
    activeVersion: "governance-1",
    stage: "RC_AUDIT_PENDING",
    taskLevel: "L2",
    revision: 2,
    lastUpdatedBy: { roleNumber: 3, roleName: "超级工作" },
    records: {
      plan: "governance/runtime/records/governance-1/01-plan.md",
      planAudit: null,
      releaseCandidate: "governance/runtime/records/governance-1/04-release-candidate-r2.md",
      rcAudit: null,
      releaseReceipt: null,
    },
    candidateSha: "7caf24d4c52f1502d43cbf668329701986669a6e",
    releaseTag: null,
    bootstrap: { isBootstrapCandidate: true },
  };
  const candidatePullRequest = {
    number: 13,
    state: "open",
    draft: false,
    head: { sha: candidateSha, ref: "governance/four-role-auto-handoff", repo: { full_name: repository } },
    base: { sha: "d81785dd51bb0c9be339449566a15d3b3971e02a", ref: "main", repo: { full_name: repository } },
  };
  const recoveryPullRequest = {
    number: 14,
    state: "open",
    draft: false,
    head: { sha: recoveryHeadSha, ref: "recovery/governance-rc-audit-r1", repo: { full_name: repository } },
    base: { sha: legacyTip, ref: "governance-state", repo: { full_name: repository } },
    records: { releaseCandidate: releaseCandidateRecord, rcAudit: rcAuditRecord },
  };
  const contract = await readJson(contractPath);
  const baseFiles = {
    [currentPath]: JSON.stringify(legacy, null, 2) + "\n",
    "governance/runtime/records/governance-1/01-plan.md": planRecord,
    "governance/runtime/records/governance-1/04-release-candidate-r2.md": "旧 Candidate 记录\n",
    [recordPath]: "旧的未审计 Candidate 记录\n",
  };
  await writeTree(baseRoot, baseFiles);
  await writeTree(recordsRoot, { ...baseFiles, [recordPath]: releaseCandidateRecord, [auditPath]: rcAuditRecord });
  const source = {
    kind: "bootstrap-failed-audit-recovery",
    authorizationComment: 1001,
    legacyTip,
    candidatePullRequest: 13,
    candidateSha,
    candidateTreeSha,
    recoveryPullRequest: 14,
    recoveryHeadSha,
  };
  const recordsEnvelope = buildProposalEnvelope({
    phase: "bootstrap-recovery-records",
    expectedTip: legacyTip,
    expectedRevision: 2,
    source,
    paths: [recordPath, auditPath],
    contentDigests: {
      [recordPath]: digest(releaseCandidateRecord),
      [auditPath]: digest(rcAuditRecord),
    },
  });
  await verifyProtectedProposal({
    baseRoot,
    proposalRoot: recordsRoot,
    proposalBaseSha: legacyTip,
    envelope: recordsEnvelope,
    candidatePullRequest,
    recoveryPullRequest,
    contract,
  });

  const migration = migrateFailedBootstrapAudit(legacy, {
    legacyTip,
    candidatePullRequest,
    recoveryPullRequest,
    candidateTreeSha,
    planRecord,
    releaseCandidateRecord,
    rcAuditRecord,
  }, contract);
  const stateText = JSON.stringify(migration.state, null, 2) + "\n";
  const pointerBaseTip = "b".repeat(40);
  const recordsFiles = { ...baseFiles, [recordPath]: releaseCandidateRecord, [auditPath]: rcAuditRecord };
  await writeTree(pointerRoot, { ...recordsFiles, [currentPath]: stateText, [versionPath]: stateText });
  await writeTree(earlyPointerRoot, { ...baseFiles, [currentPath]: stateText, [versionPath]: stateText });
  const pointerEnvelope = buildProposalEnvelope({
    phase: "bootstrap-recovery-pointer",
    expectedTip: pointerBaseTip,
    expectedRevision: 2,
    source,
    paths: [currentPath, versionPath],
    contentDigests: { [currentPath]: digest(stateText), [versionPath]: digest(stateText) },
  });
  await verifyProtectedProposal({
    baseRoot: recordsRoot,
    proposalRoot: pointerRoot,
    proposalBaseSha: pointerBaseTip,
    envelope: pointerEnvelope,
    candidatePullRequest,
    recoveryPullRequest,
    contract,
  });

  await writeFile(join(recordsRoot, "governance/runtime/extra.md"), "extra\n");
  await assert.rejects(() => verifyProtectedProposal({ baseRoot, proposalRoot: recordsRoot, proposalBaseSha: legacyTip, envelope: recordsEnvelope, candidatePullRequest, recoveryPullRequest, contract }), GovernanceValidationError);
  await rm(join(recordsRoot, "governance/runtime/extra.md"));

  await rm(join(recordsRoot, ...auditPath.split("/")));
  await assert.rejects(() => verifyProtectedProposal({ baseRoot, proposalRoot: recordsRoot, proposalBaseSha: legacyTip, envelope: recordsEnvelope, candidatePullRequest, recoveryPullRequest, contract }), GovernanceValidationError);
  await writeTree(recordsRoot, { [auditPath]: rcAuditRecord });

  await writeTree(recordsRoot, { [recordPath]: releaseCandidateRecord + "篡改\n" });
  await assert.rejects(() => verifyProtectedProposal({ baseRoot, proposalRoot: recordsRoot, proposalBaseSha: legacyTip, envelope: recordsEnvelope, candidatePullRequest, recoveryPullRequest, contract }), GovernanceValidationError);
  await writeTree(recordsRoot, { [recordPath]: releaseCandidateRecord });

  const wrongDigest = structuredClone(recordsEnvelope);
  wrongDigest.contentDigests[recordPath] = "f".repeat(64);
  await assert.rejects(() => verifyProtectedProposal({ baseRoot, proposalRoot: recordsRoot, proposalBaseSha: legacyTip, envelope: wrongDigest, candidatePullRequest, recoveryPullRequest, contract }), GovernanceValidationError);
  const wrongPhase = structuredClone(recordsEnvelope);
  wrongPhase.phase = "bootstrap-recovery-pointer";
  await assert.rejects(() => verifyProtectedProposal({ baseRoot, proposalRoot: recordsRoot, proposalBaseSha: legacyTip, envelope: wrongPhase, candidatePullRequest, recoveryPullRequest, contract }), GovernanceValidationError);
  const wrongTip = structuredClone(recordsEnvelope);
  wrongTip.expectedTip = "f".repeat(40);
  await assert.rejects(() => verifyProtectedProposal({ baseRoot, proposalRoot: recordsRoot, proposalBaseSha: legacyTip, envelope: wrongTip, candidatePullRequest, recoveryPullRequest, contract }), GovernanceValidationError);
  const wrongSource = structuredClone(recordsEnvelope);
  wrongSource.source.recoveryHeadSha = "f".repeat(40);
  await assert.rejects(() => verifyProtectedProposal({ baseRoot, proposalRoot: recordsRoot, proposalBaseSha: legacyTip, envelope: wrongSource, candidatePullRequest, recoveryPullRequest, contract }), GovernanceValidationError);
  await assert.rejects(() => verifyProtectedProposal({ baseRoot, proposalRoot: earlyPointerRoot, proposalBaseSha: pointerBaseTip, envelope: pointerEnvelope, candidatePullRequest, recoveryPullRequest, contract }), GovernanceValidationError);

  const recordTarget = join(recordsRoot, ...recordPath.split("/"));
  await rm(recordTarget);
  try {
    await symlink(join(baseRoot, ...recordPath.split("/")), recordTarget, "file");
    await assert.rejects(() => verifyProtectedProposal({ baseRoot, proposalRoot: recordsRoot, proposalBaseSha: legacyTip, envelope: recordsEnvelope, candidatePullRequest, recoveryPullRequest, contract }), /符号链接/u);
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
  } finally {
    await rm(recordTarget, { force: true });
    await writeTree(recordsRoot, { [recordPath]: releaseCandidateRecord });
  }
});

test("reconstructs normal record and pointer proposals from the owner-authorized transition", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "governance-transition-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseRoot = join(root, "base");
  const recordRoot = join(root, "record");
  const pointerRoot = join(root, "pointer");
  const contract = await readJson(contractPath);
  const stateTip = "9".repeat(40);
  const pointerTip = "8".repeat(40);
  const candidateSha = "d".repeat(40);
  const treeSha = "e".repeat(40);
  const previous = stateAt("IMPLEMENTING", { revision: 50 });
  const sourcePr = {
    number: 20,
    state: "open",
    draft: false,
    body: "Candidate SHA：" + candidateSha + "\nTree SHA：" + treeSha + "\n测试：全部通过\n生产环境修改：没有\n",
    head: { sha: candidateSha, ref: "release/v1.3.1", repo: { full_name: previous.repository } },
    base: { sha: "b".repeat(40), ref: "main", repo: { full_name: previous.repository } },
    treeSha,
    stateTip,
  };
  const source = {
    kind: "governance-transition",
    authorizationComment: 2001,
    stateTip,
    pullRequest: 20,
    headSha: candidateSha,
    treeSha,
    roleNumber: 3,
    targetStage: "RC_AUDIT_PENDING",
  };
  const transition = buildGovernanceTransition(previous, {
    roleNumber: 3,
    targetStage: "RC_AUDIT_PENDING",
    pullRequest: sourcePr,
    treeSha,
  }, contract);
  const currentPath = "governance/runtime/current.json";
  const recordPath = transition.state.records.releaseCandidate;
  const versionPath = "governance/runtime/versions/1.3.1.json";
  const baseFiles = {
    [currentPath]: JSON.stringify(previous, null, 2) + "\n",
    [recordPath]: "previous Candidate record\n",
  };
  await writeTree(baseRoot, baseFiles);
  await writeTree(recordRoot, { ...baseFiles, [recordPath]: transition.record });
  const recordEnvelope = buildProposalEnvelope({
    phase: "transition-record",
    expectedTip: stateTip,
    expectedRevision: 50,
    source,
    paths: [recordPath],
    contentDigests: { [recordPath]: digest(transition.record) },
  });
  await verifyProtectedProposal({
    baseRoot,
    proposalRoot: recordRoot,
    proposalBaseSha: stateTip,
    envelope: recordEnvelope,
    candidatePullRequest: sourcePr,
    recoveryPullRequest: {},
    contract,
  });

  const nextText = JSON.stringify(transition.state, null, 2) + "\n";
  await writeTree(pointerRoot, {
    ...baseFiles,
    [recordPath]: transition.record,
    [currentPath]: nextText,
    [versionPath]: nextText,
  });
  const pointerEnvelope = buildProposalEnvelope({
    phase: "transition-pointer",
    expectedTip: pointerTip,
    expectedRevision: 50,
    source,
    paths: [currentPath, versionPath],
    contentDigests: { [currentPath]: digest(nextText), [versionPath]: digest(nextText) },
  });
  await verifyProtectedProposal({
    baseRoot: recordRoot,
    proposalRoot: pointerRoot,
    proposalBaseSha: pointerTip,
    envelope: pointerEnvelope,
    candidatePullRequest: sourcePr,
    recoveryPullRequest: {},
    contract,
  });
});

test("independent Gate rejects failed, conditional and wrong-Candidate RC approval proposals", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "governance-rc-audit-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseRoot = join(root, "base");
  const contract = await readJson(contractPath);
  const stateTip = "9".repeat(40);
  const candidateSha = "a".repeat(40);
  const candidateTreeSha = "c".repeat(40);
  const candidatePullRequest = 20;
  const previous = stateAt("RC_AUDIT_PENDING", {
    revision: 52,
    candidateSha,
    candidateContext: {
      branch: "release/v1.3.1",
      pullRequest: candidatePullRequest,
      baseSha: "b".repeat(40),
      treeSha: candidateTreeSha,
    },
  });
  const currentPath = contract.runtime.currentPath;
  const recordPath = previous.records.rcAudit;
  const baseFiles = { [currentPath]: JSON.stringify(previous, null, 2) + "\n" };
  await writeTree(baseRoot, baseFiles);

  const source = {
    kind: "governance-transition",
    authorizationComment: 3001,
    stateTip,
    pullRequest: candidatePullRequest,
    headSha: candidateSha,
    treeSha: candidateTreeSha,
    roleNumber: 2,
    targetStage: "RELEASE_APPROVED",
  };
  const verifyRecord = async (name, body, prOverrides = {}) => {
    const proposalRoot = join(root, name);
    await writeTree(proposalRoot, { ...baseFiles, [recordPath]: body });
    const sourcePr = {
      number: prOverrides.number ?? candidatePullRequest,
      state: "open",
      draft: false,
      body,
      head: {
        sha: prOverrides.headSha ?? candidateSha,
        ref: previous.candidateContext.branch,
        repo: { full_name: previous.repository },
      },
      base: {
        sha: previous.candidateContext.baseSha,
        ref: "main",
        repo: { full_name: previous.repository },
      },
      treeSha: prOverrides.treeSha ?? candidateTreeSha,
      stateTip,
    };
    const envelope = buildProposalEnvelope({
      phase: "transition-record",
      expectedTip: stateTip,
      expectedRevision: previous.revision,
      source,
      paths: [recordPath],
      contentDigests: { [recordPath]: digest(body) },
    });
    return verifyProtectedProposal({
      baseRoot,
      proposalRoot,
      proposalBaseSha: stateTip,
      envelope,
      candidatePullRequest: sourcePr,
      recoveryPullRequest: {},
      contract,
    });
  };
  const validRecord = makeRcAuditRecord({
    candidateSha,
    candidateTreeSha,
    candidatePullRequest,
    conclusion: "通过",
    targetStage: "RELEASE_APPROVED",
  });
  await verifyRecord("valid", validRecord);

  const rejectedRecords = [
    ["failed", makeRcAuditRecord({ candidateSha, candidateTreeSha, candidatePullRequest, conclusion: "不通过", targetStage: "RELEASE_APPROVED" })],
    ["conditional", makeRcAuditRecord({ candidateSha, candidateTreeSha, candidatePullRequest, conclusion: "有条件通过", targetStage: "RELEASE_APPROVED" })],
    ["wrong-sha", makeRcAuditRecord({ candidateSha: "d".repeat(40), candidateTreeSha, candidatePullRequest, conclusion: "通过", targetStage: "RELEASE_APPROVED" })],
    ["wrong-tree", makeRcAuditRecord({ candidateSha, candidateTreeSha: "e".repeat(40), candidatePullRequest, conclusion: "通过", targetStage: "RELEASE_APPROVED" })],
    ["wrong-pr", makeRcAuditRecord({ candidateSha, candidateTreeSha, candidatePullRequest: 21, conclusion: "通过", targetStage: "RELEASE_APPROVED" })],
  ];
  for (const [name, body] of rejectedRecords) {
    await assert.rejects(() => verifyRecord(name, body), GovernanceValidationError);
  }
  await assert.rejects(() => verifyRecord("wrong-source-head", validRecord, { headSha: "d".repeat(40) }), GovernanceValidationError);
  await assert.rejects(() => verifyRecord("wrong-source-tree", validRecord, { treeSha: "e".repeat(40) }), GovernanceValidationError);
  await assert.rejects(() => verifyRecord("wrong-source-pr", validRecord, { number: 21 }), GovernanceValidationError);
});

function assertProtectedWriterSurface(workflow, writer, contract) {
  const checkoutPin = "d23441a48e516b6c34aea4fa41551a30e30af803";
  const checkoutUses = workflow.match(/uses: actions\/checkout@[^\s]+/gu) ?? [];
  assert.equal(checkoutUses.length, 3);
  assert.ok(checkoutUses.every((entry) => entry === "uses: actions/checkout@" + checkoutPin));
  assert.match(workflow, /issue_comment:\s*\n\s*types: \[created\]/u);
  assert.match(workflow, /pull_request_target:/u);
  assert.match(workflow, /repository_dispatch:\s*\n\s*types: \[governance-proposal\]/u);
  assert.match(workflow, /governance-proposal-gate:/u);
  assert.match(workflow, /checks: write/u);
  assert.equal((workflow.match(/checks: write/gu) ?? []).length, 1);
  assert.equal((workflow.match(/actions: write/gu) ?? []).length, 0);
  assert.match(workflow, /repos\/\$REPOSITORY\/check-runs["']? --method POST/u);
  assert.match(workflow, /name=governance-state-write/u);
  assert.match(workflow, /head_sha=\$head_sha/u);
  assert.match(workflow, /EXPECTED_PROPOSAL_HEAD/u);
  assert.match(workflow, /check-runs\/\$CHECK_ID["']? --method PATCH/u);
  assert.match(workflow, /COMMENT_ACTOR.*REPOSITORY_OWNER/su);
  assert.match(workflow, /\^\/governance-transition.*\[0-9a-f\]\{40\}/u);
  assert.match(workflow, /ref: main/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /verify-protected-proposal/u);
  assert.match(workflow, /issues\/comments\/\$authorization_comment/u);
  assert.match(workflow, /\.user\.login == \$owner/u);
  assert.match(workflow, /Write the immutable record through a protected pull request[\s\S]*Write current and version snapshot through a protected pull request/u);
  assert.match(workflow, /pull-requests: write/u);
  assert.match(workflow, /governance-protected-write\.sh/u);
  assert.equal((workflow.match(/verify-remote-transition "\$next"/gu) ?? []).length, 1);
  assert.match(workflow, /verify-remote-transition "\$next"[\s\S]*--previous "\$PREVIOUS_PATH"/u);
  assert.equal((workflow.match(/verify-remote "\$next"/gu) ?? []).length, 1);
  assert.match(workflow, /Build the exact failed-audit migration[\s\S]*verify-remote "\$next"/u);
  assert.doesNotMatch(workflow, /candidateSha \/\/ empty[\s\S]{0,200}verify-remote "\$next"/u);
  assert.match(writer, /governance-state-write/u);
  assert.match(writer, /repos\/\$REPOSITORY\/dispatches/u);
  assert.match(writer, /\{event_type:"governance-proposal",client_payload:\{proposal_pr:\$proposal_pr\}\}/u);
  assert.match(writer, /REQUIRED_STATUS_APP_ID=15368/u);
  assert.match(writer, /commits\/\$head_sha\/check-runs/u);
  assert.match(writer, /\.app\.id == \$app_id/u);
  assert.match(writer, /\.app\.slug == "github-actions"/u);
  assert.match(writer, /\.head_sha == \$head/u);
  assert.match(writer, /repos\/\$REPOSITORY\/pulls/u);
  assert.match(writer, /pulls\/\$pull_request\/merge/u);
  assert.equal((writer.match(/if \[\[ "\$remote_tip" != "\$EXPECTED_TIP" \]\]; then/gu) ?? []).length, 3);
  assert.match(writer, /base=governance-state|base_ref.*governance-state/u);
  assert.doesNotMatch(workflow, /push origin HEAD:refs\/heads\/governance-state/u);
  assert.doesNotMatch(writer, /HEAD:refs\/heads\/governance-state/u);
  assert.doesNotMatch(workflow + writer, /statuses: write|repos\/\$REPOSITORY\/statuses\//u);
  assert.doesNotMatch(writer, /check-runs["']?\s+--method\s+(POST|PATCH)/u);
  assert.doesNotMatch(workflow, /governance-state\.mjs[^\n]* \+\s/u);
  assert.doesNotMatch(workflow + writer, /wrangler|cloudflare:deploy|git tag|refs\/tags\//u);
  assert.equal(contract.runtime.writeTransport, "protected-pull-request");
  assert.equal(contract.runtime.requiredStatusContext, "governance-state-write");
  assert.equal(contract.runtime.requiredStatusAppId, 15368);
  assert.equal(contract.runtime.statusProducer, "default-branch-repository-dispatch-proposal-gate");
  assert.equal(contract.runtime.requiredCheckTransport, "checks-api-head-sha");
  assert.equal(contract.runtime.writerRequestsIndependentGate, true);
  assert.equal(contract.runtime.authorizationSource, "repository-owner-issue-comment");
  assert.equal(contract.runtime.authorizationRevalidatedByGate, true);
  assert.equal(contract.runtime.writerMayCreateStatus, false);
  assert.equal(contract.runtime.writerMayCreateCheckRun, false);
  assert.equal(contract.runtime.proposalVerifierExecutesHeadCode, false);
  assert.equal(contract.runtime.pullRequestRequired, true);
  assert.equal(contract.runtime.strictUpToDateRequired, true);
  assert.equal(contract.runtime.directPushAllowed, false);
  assert.equal(contract.runtime.branchProtectionRequired, true);
  assert.equal(contract.runtime.cloudflarePreviewBuildsAllowed, false);
}

test("ships an owner-only protected writer through two independently checked pull requests", async () => {
  const [workflow, writer, contract] = await Promise.all([
    readText(".github/workflows/governance-state.yml"),
    readText("scripts/governance-protected-write.sh"),
    readJson(contractPath),
  ]);
  assertProtectedWriterSurface(workflow, writer, contract);
});

test("detects protected writer drift before Candidate creation", async () => {
  const [workflow, writer, contract] = await Promise.all([
    readText(".github/workflows/governance-state.yml"),
    readText("scripts/governance-protected-write.sh"),
    readJson(contractPath),
  ]);
  const mutations = [
    [workflow, writer.replace("governance-state-write", "untrusted-status"), contract],
    [workflow, writer.replace("REQUIRED_STATUS_APP_ID=15368", "REQUIRED_STATUS_APP_ID=1"), contract],
    [workflow, writer.replace('app.slug == "github-actions"', 'app.slug == "other"'), contract],
    [workflow, writer.replace("base=governance-state", "base=main"), contract],
    [workflow, writer.replace('if [[ "$remote_tip" != "$EXPECTED_TIP" ]]; then', "if false; then"), contract],
    [workflow + "\ngit push origin HEAD:refs/heads/governance-state\n", writer, contract],
    [
      workflow
        .replace("Write the immutable record through a protected pull request", "TEMP_POINTER")
        .replace("Write current and version snapshot through a protected pull request", "Write the immutable record through a protected pull request")
        .replace("TEMP_POINTER", "Write current and version snapshot through a protected pull request"),
      writer,
      contract,
    ],
    [workflow + "\npermissions:\n  statuses: write\n", writer, contract],
    [workflow.replace("checks: write", "checks: read"), writer, contract],
    [workflow, writer.replace('event_type:"governance-proposal"', 'event_type:"other"'), contract],
    [workflow.replaceAll("actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803", "actions/checkout@v6"), writer, contract],
    [workflow.replace("verify-remote-transition", "verify-remote"), writer, contract],
  ];
  for (const mutation of mutations) {
    assert.throws(() => assertProtectedWriterSurface(...mutation), assert.AssertionError);
  }
});

test("waits for the pinned GitHub Actions check and merges the exact protected proposal", async (t) => {
  const bashProbe = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (bashProbe.error?.code === "ENOENT") {
    t.skip("Bash integration runs on the Linux GitHub Actions runner");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "governance-protected-writer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  const bin = join(root, "bin");
  const runnerTemp = join(root, "runner");
  const output = join(root, "github-output");
  await mkdir(work, { recursive: true });
  await mkdir(bin, { recursive: true });
  await mkdir(runnerTemp, { recursive: true });

  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { encoding: "utf8", ...options });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    return result.stdout.trim();
  };
  run("git", ["init", "--bare", remote]);
  run("git", ["init", work]);
  run("git", ["-C", work, "config", "user.name", "Governance Test"]);
  run("git", ["-C", work, "config", "user.email", "governance-test@users.noreply.github.com"]);
  await mkdir(join(work, "governance/runtime"), { recursive: true });
  await writeFile(join(work, "governance/runtime/current.json"), "{}\n");
  run("git", ["-C", work, "add", "governance/runtime/current.json"]);
  run("git", ["-C", work, "commit", "-m", "Initialize governance state"]);
  run("git", ["-C", work, "remote", "add", "origin", remote]);
  run("git", ["-C", work, "push", "origin", "HEAD:refs/heads/governance-state"]);
  const expectedTip = run("git", ["--git-dir", remote, "rev-parse", "refs/heads/governance-state"]);

  const recordPath = "governance/runtime/records/1.3.1/01-plan.md";
  await mkdir(join(work, "governance/runtime/records/1.3.1"), { recursive: true });
  const record = "规划编号：TEST-1\n";
  await writeFile(join(work, recordPath), record);
  const envelopePath = join(root, "envelope.json");
  const envelope = buildProposalEnvelope({
    phase: "transition-record",
    expectedTip,
    expectedRevision: 1,
    source: { kind: "transition-test" },
    paths: [recordPath],
    contentDigests: { [recordPath]: digest(record) },
  });
  await writeFile(envelopePath, JSON.stringify(envelope) + "\n");

  const fakeGh = `#!/usr/bin/env bash
set -euo pipefail
endpoint="$2"
shift 2
method="GET"
jq_filter=""
input_path=""
declare -A fields=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --method) method="$2"; shift 2 ;;
    --jq) jq_filter="$2"; shift 2 ;;
    --input) input_path="$2"; shift 2 ;;
    -f) fields["\${2%%=*}"]="\${2#*=}"; shift 2 ;;
    *) shift ;;
  esac
done
if [[ "$endpoint" == "repos/$REPOSITORY/pulls" && "$method" == "POST" ]]; then
  head_ref="\${fields[head]}"
  head_sha="$(git --git-dir="$TEST_REMOTE" rev-parse "refs/heads/$head_ref")"
  printf '{"number":42,"state":"open","draft":false,"base":{"ref":"governance-state","repo":{"full_name":"%s"}},"head":{"ref":"%s","sha":"%s","repo":{"full_name":"%s"}}}\n' "$REPOSITORY" "$head_ref" "$head_sha" "$REPOSITORY"
elif [[ "$endpoint" == "repos/$REPOSITORY/dispatches" && "$method" == "POST" ]]; then
  jq -e '.event_type == "governance-proposal" and .client_payload.proposal_pr == "42"' "$input_path" >/dev/null
  exit 0
elif [[ "$endpoint" == "repos/$REPOSITORY/commits/"*"/check-runs?per_page=100" ]]; then
  head_sha="\${endpoint#repos/$REPOSITORY/commits/}"
  head_sha="\${head_sha%/check-runs?per_page=100}"
  printf '{"check_runs":[{"id":9001,"name":"governance-state-write","status":"completed","conclusion":"success","head_sha":"%s","app":{"id":15368,"slug":"github-actions"}}]}\n' "$head_sha"
elif [[ "$endpoint" == "repos/$REPOSITORY/pulls/42" && "$jq_filter" == ".mergeable" ]]; then
  printf 'true\n'
elif [[ "$endpoint" == "repos/$REPOSITORY/pulls/42" ]]; then
  head_ref="governance-write/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-transition-record"
  head_sha="$(git --git-dir="$TEST_REMOTE" rev-parse "refs/heads/$head_ref")"
  printf '{"number":42,"state":"open","draft":false,"base":{"ref":"governance-state","repo":{"full_name":"%s"}},"head":{"ref":"%s","sha":"%s","repo":{"full_name":"%s"}}}\n' "$REPOSITORY" "$head_ref" "$head_sha" "$REPOSITORY"
elif [[ "$endpoint" == "repos/$REPOSITORY/pulls/42/merge" && "$method" == "PUT" ]]; then
  head_sha="\${fields[sha]}"
  base_sha="$(git --git-dir="$TEST_REMOTE" rev-parse refs/heads/governance-state)"
  tree_sha="$(git --git-dir="$TEST_REMOTE" rev-parse "$head_sha^{tree}")"
  merge_sha="$(printf 'Merge protected governance proposal\n' | GIT_AUTHOR_NAME='GitHub' GIT_AUTHOR_EMAIL='noreply@github.com' GIT_COMMITTER_NAME='GitHub' GIT_COMMITTER_EMAIL='noreply@github.com' git --git-dir="$TEST_REMOTE" commit-tree "$tree_sha" -p "$base_sha" -p "$head_sha")"
  git --git-dir="$TEST_REMOTE" update-ref refs/heads/governance-state "$merge_sha" "$base_sha"
  printf '{"merged":true,"sha":"%s"}\n' "$merge_sha"
else
  echo "Unexpected fake gh call: $endpoint $method $jq_filter" >&2
  exit 1
fi
`;
  const ghPath = join(bin, "gh");
  await writeFile(ghPath, fakeGh);
  await chmod(ghPath, 0o755);

  run("bash", [
    "scripts/governance-protected-write.sh",
    work,
    expectedTip,
    "transition-record",
    "Record verified governance transition",
    "Record verified governance transition",
    envelopePath,
    recordPath,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: bin + delimiter + process.env.PATH,
      GH_TOKEN: "fictional",
      REPOSITORY: "owner/repo",
      REPOSITORY_OWNER: "owner",
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: runnerTemp,
      TEST_REMOTE: remote,
      GOVERNANCE_CHECK_ATTEMPTS: "1",
      GOVERNANCE_CHECK_INTERVAL_SECONDS: "0",
      GOVERNANCE_MERGEABLE_ATTEMPTS: "1",
      GOVERNANCE_MERGEABLE_INTERVAL_SECONDS: "0",
    },
  });
  const mergedTip = run("git", ["--git-dir", remote, "rev-parse", "refs/heads/governance-state"]);
  assert.match(await readFile(output, "utf8"), new RegExp("tip=" + mergedTip, "u"));
  assert.equal(run("git", ["--git-dir", remote, "show", mergedTip + ":" + recordPath]), "规划编号：TEST-1");
  assert.equal(run("git", ["--git-dir", remote, "rev-list", "--parents", "-n", "1", mergedTip]).split(" ").length, 3);
});

test("rejects wrong-app, wrong-head, failed, and missing governance checks without merging", async (t) => {
  const bashProbe = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (bashProbe.error?.code === "ENOENT") {
    t.skip("Bash integration runs on the Linux GitHub Actions runner");
    return;
  }
  const suiteRoot = await mkdtemp(join(tmpdir(), "governance-check-rejection-"));
  t.after(() => rm(suiteRoot, { recursive: true, force: true }));

  for (const mode of ["wrong-app", "wrong-head", "failure", "timeout"]) {
    const root = join(suiteRoot, mode);
    const remote = join(root, "remote.git");
    const work = join(root, "work");
    const bin = join(root, "bin");
    const runnerTemp = join(root, "runner");
    const output = join(root, "github-output");
    const calls = join(root, "gh-calls");
    await mkdir(work, { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(runnerTemp, { recursive: true });
    const runGit = (args) => {
      const result = spawnSync("git", args, { encoding: "utf8" });
      assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
      return result.stdout.trim();
    };
    runGit(["init", "--bare", remote]);
    runGit(["init", work]);
    runGit(["-C", work, "config", "user.name", "Governance Test"]);
    runGit(["-C", work, "config", "user.email", "governance-test@users.noreply.github.com"]);
    await writeTree(work, { "governance/runtime/current.json": "{}\n" });
    runGit(["-C", work, "add", "governance/runtime/current.json"]);
    runGit(["-C", work, "commit", "-m", "Initialize governance state"]);
    runGit(["-C", work, "remote", "add", "origin", remote]);
    runGit(["-C", work, "push", "origin", "HEAD:refs/heads/governance-state"]);
    const expectedTip = runGit(["--git-dir", remote, "rev-parse", "refs/heads/governance-state"]);
    const recordPath = "governance/runtime/records/1.3.1/01-plan.md";
    const record = "规划编号：TEST-REJECT\n";
    await writeTree(work, { [recordPath]: record });
    const envelopePath = join(root, "envelope.json");
    await writeFile(envelopePath, JSON.stringify(buildProposalEnvelope({
      phase: "transition-record",
      expectedTip,
      expectedRevision: 1,
      source: { kind: "transition-test" },
      paths: [recordPath],
      contentDigests: { [recordPath]: digest(record) },
    })) + "\n");
    const fakeGh = `#!/usr/bin/env bash
set -euo pipefail
endpoint="$2"
printf '%s\n' "$endpoint" >> "$TEST_CALLS"
shift 2
method="GET"
input_path=""
declare -A fields=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --method) method="$2"; shift 2 ;;
    --input) input_path="$2"; shift 2 ;;
    -f) fields["\${2%%=*}"]="\${2#*=}"; shift 2 ;;
    *) shift ;;
  esac
done
if [[ "$endpoint" == "repos/$REPOSITORY/pulls" && "$method" == "POST" ]]; then
  head_ref="\${fields[head]}"
  head_sha="$(git --git-dir="$TEST_REMOTE" rev-parse "refs/heads/$head_ref")"
  printf '{"number":42,"state":"open","draft":false,"base":{"ref":"governance-state","repo":{"full_name":"%s"}},"head":{"ref":"%s","sha":"%s","repo":{"full_name":"%s"}}}\n' "$REPOSITORY" "$head_ref" "$head_sha" "$REPOSITORY"
elif [[ "$endpoint" == "repos/$REPOSITORY/dispatches" && "$method" == "POST" ]]; then
  jq -e '.event_type == "governance-proposal" and .client_payload.proposal_pr == "42"' "$input_path" >/dev/null
  exit 0
elif [[ "$endpoint" == "repos/$REPOSITORY/commits/"*"/check-runs?per_page=100" ]]; then
  head_sha="\${endpoint#repos/$REPOSITORY/commits/}"
  head_sha="\${head_sha%/check-runs?per_page=100}"
  case "$TEST_CHECK_MODE" in
    wrong-app) app_id=1; check_head="$head_sha"; conclusion=success ;;
    wrong-head) app_id=15368; check_head=ffffffffffffffffffffffffffffffffffffffff; conclusion=success ;;
    failure) app_id=15368; check_head="$head_sha"; conclusion=failure ;;
    timeout) printf '{"check_runs":[]}\n'; exit 0 ;;
  esac
  printf '{"check_runs":[{"id":9001,"name":"governance-state-write","status":"completed","conclusion":"%s","head_sha":"%s","app":{"id":%s,"slug":"github-actions"}}]}\n' "$conclusion" "$check_head" "$app_id"
else
  echo "Unexpected fake gh call: $endpoint" >&2
  exit 1
fi
`;
    const ghPath = join(bin, "gh");
    await writeFile(ghPath, fakeGh);
    await chmod(ghPath, 0o755);
    const result = spawnSync("bash", [
      "scripts/governance-protected-write.sh",
      work,
      expectedTip,
      "transition-record",
      "Record rejected governance transition",
      "Record rejected governance transition",
      envelopePath,
      recordPath,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: bin + delimiter + process.env.PATH,
        GH_TOKEN: "fictional",
        REPOSITORY: "owner/repo",
        REPOSITORY_OWNER: "owner",
        GITHUB_RUN_ID: "12" + mode.length,
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: runnerTemp,
        TEST_REMOTE: remote,
        TEST_CALLS: calls,
        TEST_CHECK_MODE: mode,
        GOVERNANCE_CHECK_ATTEMPTS: "1",
        GOVERNANCE_CHECK_INTERVAL_SECONDS: "0",
      },
    });
    assert.equal(result.status, 75, mode + ": " + (result.stderr || result.stdout));
    assert.doesNotMatch(await readFile(calls, "utf8"), /\/merge/u, mode);
  }
});

test("blocks every governance-only Workers Build before build or version upload", async (t) => {
  const bashProbe = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (bashProbe.error?.code === "ENOENT") {
    t.skip("Bash integration runs on the Linux GitHub Actions runner");
    return;
  }
  for (const branch of [
    "governance-state",
    "governance/four-role-auto-handoff",
    "governance/bootstrap-trust-root",
    "governance-write/123-1-bootstrap-recovery-records",
  ]) {
    const result = spawnSync("bash", ["scripts/build-verified.sh"], {
      encoding: "utf8",
      env: { ...process.env, WORKERS_CI: "1", WORKERS_CI_BRANCH: branch },
    });
    assert.equal(result.status, 78, branch);
    assert.match(result.stderr, /disabled for a verified governance-only event/u);
    assert.doesNotMatch(result.stdout, /Running bounded vinext build/u);
  }

  const root = await mkdtemp(join(tmpdir(), "governance-workers-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const run = (args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  run(["init"]);
  run(["config", "user.name", "Governance Test"]);
  run(["config", "user.email", "governance-test@users.noreply.github.com"]);
  await writeTree(root, { "AGENTS.md": "baseline\n", "app/product.txt": "product baseline\n" });
  run(["add", "."]);
  run(["commit", "-m", "Initial baseline"]);
  run(["branch", "-M", "main"]);
  run(["checkout", "-b", "governance/bootstrap-trust-root"]);
  const trustRootPaths = {
    ".github/workflows/governance-state.yml": "trusted workflow\n",
    "AGENTS.md": "baseline\ntrusted governance entry\n",
    "docs/plans/protected-write.md": "protected write plan\n",
    "docs/superpowers/plans/trust-root.md": "trust root plan\n",
    "docs/superpowers/specs/trust-root.md": "trust root design\n",
    "governance/README.md": "trusted governance\n",
    "package-lock.json": "{}\n",
    "package.json": "{}\n",
    "scripts/build-verified.sh": "trusted build guard\n",
    "scripts/governance-protected-write.sh": "trusted writer\n",
    "scripts/governance-state.mjs": "trusted verifier\n",
    "tests/governance-contract.test.mjs": "trusted tests\n",
  };
  await writeTree(root, trustRootPaths);
  run(["add", ...Object.keys(trustRootPaths)]);
  run(["commit", "-m", "Install governance trust root"]);
  run(["checkout", "main"]);
  run(["merge", "--no-ff", "governance/bootstrap-trust-root", "-m", "Merge pull request #15 from governance/bootstrap-trust-root"]);
  const trustRootMerge = run(["rev-parse", "HEAD"]);
  const guardedMerge = spawnSync("bash", [join(process.cwd(), "scripts/build-verified.sh")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      WORKERS_CI: "1",
      WORKERS_CI_BRANCH: "main",
      WORKERS_CI_COMMIT_SHA: trustRootMerge,
    },
  });
  assert.equal(guardedMerge.status, 78);
  assert.match(guardedMerge.stderr, /disabled for a verified governance-only event/u);
  assert.doesNotMatch(guardedMerge.stdout, /Running bounded vinext build/u);

  run(["checkout", "-b", "marked-product-change"]);
  await writeTree(root, { "app/product.txt": "changed product\n" });
  run(["add", "app/product.txt"]);
  run(["commit", "-m", "Change product"]);
  run(["checkout", "main"]);
  run(["merge", "--no-ff", "marked-product-change", "-m", "Governance trust root: invalid product change"]);
  const mismatchedMerge = run(["rev-parse", "HEAD"]);
  const mismatch = spawnSync("bash", [join(process.cwd(), "scripts/build-verified.sh")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      WORKERS_CI: "1",
      WORKERS_CI_BRANCH: "main",
      WORKERS_CI_COMMIT_SHA: mismatchedMerge,
    },
  });
  assert.equal(mismatch.status, 78);
  assert.match(mismatch.stderr, /governance trust-root path mismatch/u);
  assert.doesNotMatch(mismatch.stdout, /Running bounded vinext build/u);

  run(["checkout", "-b", "ordinary-product-change"]);
  await writeTree(root, { "app/product.txt": "ordinary product\n" });
  run(["add", "app/product.txt"]);
  run(["commit", "-m", "Ordinary product change"]);
  const ordinaryCommit = run(["rev-parse", "HEAD"]);
  const ordinary = spawnSync("bash", [join(process.cwd(), "scripts/build-verified.sh")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      WORKERS_CI: "1",
      WORKERS_CI_BRANCH: "main",
      WORKERS_CI_COMMIT_SHA: ordinaryCommit,
      SITES_ENV_READY: "1",
      SITES_PROJECT_ROOT: root,
    },
  });
  assert.equal(ordinary.status, 69);
  assert.doesNotMatch(ordinary.stderr, /governance-only|trust-root path mismatch/u);

  run(["checkout", "main"]);
  await writeTree(root, { ".github/workflows/governance-state.yml": "unreviewed direct trust-root change\n" });
  run(["add", ".github/workflows/governance-state.yml"]);
  run(["commit", "-m", "Change governance workflow directly"]);
  const oneParentTrustRoot = run(["rev-parse", "HEAD"]);
  const invalidShape = spawnSync("bash", [join(process.cwd(), "scripts/build-verified.sh")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      WORKERS_CI: "1",
      WORKERS_CI_BRANCH: "main",
      WORKERS_CI_COMMIT_SHA: oneParentTrustRoot,
    },
  });
  assert.equal(invalidShape.status, 78);
  assert.match(invalidShape.stderr, /trust-root merge shape cannot be resolved/u);
  assert.doesNotMatch(invalidShape.stdout, /Running bounded vinext build/u);
});

test("documents protected writes, bootstrap retirement and no-preview activation gates", async () => {
  const [readme, workflow, agents, roles] = await Promise.all([
    readText("governance/README.md"),
    readText("governance/workflow.md"),
    readText("AGENTS.md"),
    Promise.all(["super-planning.md", "super-audit.md", "super-work.md", "super-release.md"].map((file) => readText("governance/roles/" + file))),
  ]);
  for (const source of [readme, workflow]) {
    assert.match(source, /受保护|protected/u);
    assert.match(source, /Cloudflare.*预览|Worker.*预览/u);
    assert.match(source, /compare-and-swap|CAS/u);
    assert.match(source, /无秘密|泄密/u);
  }
  assert.match(readme, /一次性失败审计恢复.*governance-1/su);
  assert.match(readme, /trust-root.*main/su);
  assert.match(readme, /Schema 2.*revision 3.*IMPLEMENTATION_REQUIRED/su);
  assert.match(readme + workflow + agents, /15368/u);
  assert.match(workflow, /IMPLEMENTING.*历史证据.*commit.*Tree.*分支 tip.*RC_AUDIT_PENDING.*完整远端核验/su);
  assert.match(workflow, /IMPLEMENTING.*BLOCKED.*失败关闭.*不能授予任何审计或发布资格/su);
  assert.match(agents, /Four-role governance entry/u);
  for (const source of roles) {
    assert.match(source, /受保护/u);
    assert.match(source, /不要求用户搬运已有交接文件/u);
  }
});

test("keeps all six handoff templates and the governance-only product freeze", async () => {
  const candidate = await readText("governance/handoff/release-candidate.md");
  const blocked = await readText("governance/handoff/blocked-report.md");
  assert.match(candidate, /Candidate SHA/u);
  assert.match(candidate, /端到端测试/u);
  assert.match(candidate, /生产环境修改：没有/u);
  assert.match(blocked, /阻断编号/u);
  const changedPaths = [
    "AGENTS.md",
    "governance/",
    "package.json",
    "package-lock.json",
    "scripts/governance-state.mjs",
    "tests/governance-contract.test.mjs",
    ".github/workflows/governance-state.yml",
  ];
  assert.ok(changedPaths.every((path) => !path.startsWith("app/") && !path.startsWith("db/") && !path.startsWith("drizzle/")));
});

test("publishes the exact Super Hub v1.1 names while keeping four version domains separate", async () => {
  const [readme, workflow, agents, packageJson, contract, schema] = await Promise.all([
    readText("governance/README.md"),
    readText("governance/workflow.md"),
    readText("AGENTS.md"),
    readJson("package.json"),
    readJson(contractPath),
    readJson(schemaPath),
  ]);
  for (const name of ["作品集展示网站", "超级中枢", "生产环境", "中枢进度状态"]) {
    assert.match(readme, new RegExp(name, "u"));
    assert.match(agents, new RegExp(name, "u"));
  }
  assert.match(readme, /Active Student Production Baseline = 作品集展示网站 v1\.3\.0/u);
  assert.match(readme, /超级中枢 v1\.1/u);
  assert.match(readme, /`governance-1`、`governance-state`/u);
  assert.match(readme, /`schemaVersion: 2`/u);
  assert.match(workflow, /默认人工审核模式.*不得根据旧 `activeVersion`.*授予实施或发布资格/su);
  assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+)?$/u);
  assert.notEqual(packageJson.version, "1.1");
  assert.equal(contract.schemaVersion, 2);
  assert.equal(schema.properties.schemaVersion.const, 2);
  assert.equal(contract.runtime.stateBranch, "governance-state");
  assert.equal(contract.bootstrapPolicy.activeVersion, "governance-1");
});

test("keeps the machine trust contract byte-identical while product versions evolve independently", async () => {
  const frozenSha256 = {
    "governance/role-contract.json": "79b7592ba03d3c41fa76695ab17f51f8a50d41b5581b0d7667ea152027657650",
    "governance/state-schema.json": "be53d6339f7915e670d335e9530a41d77f374443cbd92790eec8b5abdb570151",
    "scripts/governance-state.mjs": "5d362bf36ad676370981a889ba5e92dbe7acaa8ac9df81e97b41b7b6ad6070b4",
    ".github/workflows/governance-state.yml": "5986ffd8ec63715169553a3372a718f968a96805e66fa4c0ff3e840c1da5a0ae",
  };
  for (const [path, expected] of Object.entries(frozenSha256)) {
    assert.equal(digest((await readText(path)).replaceAll("\r\n", "\n")), expected, path + " drifted from the implementation Base");
  }
});

test("requires every role and handoff template to expose the unified milestone reply", async () => {
  const fields = [
    "当前角色：",
    "当前状态：",
    "标准主路径：",
    "当前所在位置：",
    "当前预计路径：",
    "最低剩余主步骤：",
    "下一步：",
    "下一角色：",
    "推荐思考程度：",
    "原因：",
  ];
  const rolePaths = ["super-planning.md", "super-audit.md", "super-work.md", "super-release.md"]
    .map((file) => "governance/roles/" + file);
  const handoffPaths = [
    "plan-handoff.md",
    "audit-report.md",
    "release-candidate.md",
    "release-receipt.md",
    "blocked-report.md",
    "progress-report.md",
  ].map((file) => "governance/handoff/" + file);
  for (const path of [...rolePaths, ...handoffPaths]) {
    const source = await readText(path);
    for (const field of fields) assert.match(source, new RegExp(field, "u"), path + " is missing " + field);
  }
  const audit = await readText("governance/roles/super-audit.md");
  assert.match(audit, /2（方案审计）/u);
  assert.match(audit, /2（Candidate 审计）/u);
  assert.doesNotMatch(audit, /当前角色：\s*2\s*$/mu);
});

test("defines one dynamic path table with bounded remaining-step and next-role rules", async () => {
  const workflow = await readText("governance/workflow.md");
  assert.equal((workflow.match(/^## 动态路径规则$/gmu) ?? []).length, 1);
  for (const scenario of [
    "正常产品发布",
    "规划返工",
    "实现返工",
    "BLOCKED",
    "回滚",
    "不需要生产发布的治理或文档任务",
    "已经结束的流程",
  ]) assert.match(workflow, new RegExp("\\| " + escapeRegExp(scenario) + " \\|", "u"));

  const governanceSection = /### 不需要生产发布的治理或文档任务\n([\s\S]*?)\n### 最低剩余主步骤/u.exec(workflow)?.[1];
  assert.ok(governanceSection);
  const completePath = /完整路径为：\n\n([\s\S]*?)\n\n3 完成实施/u.exec(governanceSection)?.[1];
  const candidatePath = /当前预计路径为：\n\n([\s\S]*?)\n\nCandidate 审计通过/u.exec(governanceSection)?.[1];
  for (const path of [completePath, candidatePath]) {
    assert.ok(path);
    assert.doesNotMatch(path, /4（超级发布）|Cloudflare|Worker|生产部署/u);
  }
  assert.match(completePath, /2（方案审计）[\s\S]*3（实施）[\s\S]*2（Candidate 审计）[\s\S]*合入准确治理 Candidate/u);
  assert.match(candidatePath, /2（Candidate 审计）[\s\S]*合入准确治理 Candidate/u);
  assert.match(workflow, /最低剩余主步骤为 3/u);
  assert.match(workflow, /Candidate 已冻结并等待审计时为 2/u);
  assert.match(workflow, /流程完成时为 0/u);
  assert.match(workflow, /待阻断解除后重新计算/u);
  for (const route of [
    "规划待审计 | 2（方案审计）",
    "方案不通过 | 1（超级规划）",
    "方案通过 | 3（超级工作）",
    "实现完成 | 2（Candidate 审计）",
    "Candidate 不通过 | 3（超级工作）",
    "产品 Candidate 通过且需要生产发布 | 4（超级发布）",
    "纯治理或文档 Candidate 通过 | 3（超级工作），仅合入准确获批 Candidate",
    "回滚后的实现修复 | 3（超级工作）",
    "流程完成 | 无（流程结束）",
  ]) assert.match(workflow, new RegExp(escapeRegExp(route), "u"));
  assert.match(workflow, /待阻断解除后确认/u);
});

test("requires a self-contained handoff with Writing Block fallback and bounded risk display", async () => {
  const [workflow, auditTemplate, ...handoffs] = await Promise.all([
    readText("governance/workflow.md"),
    readText("governance/handoff/audit-report.md"),
    ...["plan-handoff.md", "release-candidate.md", "release-receipt.md", "blocked-report.md", "progress-report.md"]
      .map((file) => readText("governance/handoff/" + file)),
  ]);
  assert.match(workflow, /自包含/u);
  assert.match(workflow, /Writing Block \/ 写作块.*独立代码块/su);
  assert.match(workflow, /不得依赖“见上文”/u);
  assert.match(workflow, /密码、Token、Cookie、恢复码、Secret、二维码访问链接、私人信息或生产资源原始 ID/u);
  for (const handoff of [auditTemplate, ...handoffs]) {
    assert.match(handoff, /## 一键复制交接词/u);
    assert.match(handoff, /Writing Block \/ 写作块.*独立代码块/su);
  }
  for (const field of ["阻断风险：", "已接受风险：", "已知问题：", "是否阻断："]) {
    assert.match(auditTemplate, new RegExp(field, "u"));
  }
  assert.match(workflow, /只陈述当前已有审计结果/u);
  assert.match(workflow, /不得由此引入风险数据库、自动风险评分、Known Issue 平台、监控系统、新治理状态或新状态机分支/u);
});

test("preserves every machine-used handoff field and fixed path", async () => {
  const contract = await readJson(contractPath);
  const requiredFields = {
    "governance/handoff/plan-handoff.md": ["记录 ID：", "规划编号：", "目标状态：PLAN_AUDIT_PENDING", "下一角色：2（超级审计）"],
    "governance/handoff/audit-report.md": ["审计编号：", "审计类型：", "最终结论：", "批准 Candidate SHA（候选审计适用）：", "目标状态："],
    "governance/handoff/release-candidate.md": ["Candidate SHA：", "分支：", "基准提交：", "生产环境修改：没有", "目标状态：RC_AUDIT_PENDING"],
    "governance/handoff/release-receipt.md": ["已批准 Candidate SHA：", "实际部署 SHA：", "最终状态："],
    "governance/handoff/blocked-report.md": ["阻断编号：", "阻断阶段：", "需要哪个角色接手："],
    "governance/handoff/progress-report.md": ["当前阶段：", "仓库状态 revision：", "下一步："],
  };
  for (const [path, fields] of Object.entries(requiredFields)) {
    const source = await readText(path);
    for (const field of fields) assert.match(source, new RegExp(field, "u"), path + " lost " + field);
  }
  assert.deepEqual(contract.roles.map((item) => item.slug), ["super-planning", "super-audit", "super-work", "super-release"]);
  assert.deepEqual(contract.roles.map((item) => item.handoffTemplate), [
    "governance/handoff/plan-handoff.md",
    "governance/handoff/audit-report.md",
    "governance/handoff/release-candidate.md",
    "governance/handoff/release-receipt.md",
  ]);
  assert.equal(contract.runtime.writeWorkflow, ".github/workflows/governance-state.yml");
  assert.equal(contract.runtime.currentPath, "governance/runtime/current.json");
});
