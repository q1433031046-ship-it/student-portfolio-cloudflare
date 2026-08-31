import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GOVERNANCE_STAGES,
  GovernanceValidationError,
  ROLE_NAMES,
  assertTransition,
  buildGovernanceTransition,
  migrateLegacyBootstrap,
  recoverRole,
  scanGovernanceText,
  validateGovernanceContract,
  validateGovernanceState,
  validateGovernanceTransition,
  validateStateSchema,
  verifyRecordFiles,
  verifyRemoteCandidate,
} from "../scripts/governance-state.mjs";

const readText = (path) => readFile(path, "utf8");
const readJson = async (path) => JSON.parse(await readText(path));
const contractPath = "governance/role-contract.json";
const schemaPath = "governance/state-schema.json";
const digest = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const recordFiles = {
  plan: "01-plan.md",
  planAudit: "02-plan-audit.md",
  releaseCandidate: "04-release-candidate.md",
  rcAudit: "05-rc-audit.md",
  releaseReceipt: "06-release-receipt.md",
  blocked: "07-blocked.md",
};

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
  const candidateSha = overrides.candidateSha ?? "d".repeat(40);
  return stateAt(overrides.stage ?? "RC_AUDIT_PENDING", {
    activeVersion: "governance-1",
    revision: overrides.revision ?? 2,
    lastUpdatedBy: overrides.lastUpdatedBy ?? { roleNumber: 3, roleName: "超级工作" },
    candidateSha,
    candidateContext: {
      branch: "governance/four-role-auto-handoff",
      pullRequest: 13,
      baseSha: "d81785dd51bb0c9be339449566a15d3b3971e02a",
      treeSha: "e".repeat(40),
    },
    records: { planAudit: null, ...overrides.records },
    recordDigests: { planAudit: null, ...overrides.recordDigests },
    bootstrap: {
      isBootstrapCandidate: true,
      candidateSha,
      candidateBranch: "governance/four-role-auto-handoff",
      baseSha: "d81785dd51bb0c9be339449566a15d3b3971e02a",
    },
  });
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
  assertTransition(contract, 2, "PLAN_AUDIT_PENDING", "IMPLEMENTATION_APPROVED");
  assertTransition(contract, 3, "IMPLEMENTING", "RC_AUDIT_PENDING");
  assertTransition(contract, 2, "RC_AUDIT_PENDING", "RELEASE_APPROVED");
  assertTransition(contract, 3, "ROLLED_BACK", "IMPLEMENTATION_REQUIRED");
  assertTransition(contract, 2, "BLOCKED", "RC_AUDIT_PENDING");
  assert.throws(() => assertTransition(contract, 1, "IDLE", "RELEASE_APPROVED"), GovernanceValidationError);
  assert.throws(() => assertTransition(contract, 3, "RC_AUDIT_PENDING", "RELEASE_APPROVED"), GovernanceValidationError);
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
  assert.throws(() => validateGovernanceState(changedBase), /bootstrap Candidate 上下文基线/u);
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

test("allows exactly one legacy bootstrap migration only with a passing audit of PR #13", async () => {
  const contract = await readJson(contractPath);
  const legacy = {
    schemaVersion: 1,
    project: "student-portfolio-cloudflare",
    repository: "q1433031046-ship-it/student-portfolio-cloudflare",
    activeVersion: "governance-1",
    stage: "RC_AUDIT_PENDING",
    taskLevel: "L2",
    revision: 2,
    lastUpdatedBy: { roleNumber: 3, roleName: "超级工作" },
    records: {},
    candidateSha: "7caf24d4c52f1502d43cbf668329701986669a6e",
    releaseTag: null,
    bootstrap: { isBootstrapCandidate: true },
  };
  const sha = "f".repeat(40);
  const repository = legacy.repository;
  const candidatePr = {
    number: 13,
    state: "open",
    draft: false,
    body: "Candidate SHA：" + sha + "\n测试：通过\n生产环境修改：没有\n",
    head: { sha, ref: "governance/four-role-auto-handoff", repo: { full_name: repository } },
    base: { sha: "d81785dd51bb0c9be339449566a15d3b3971e02a", ref: "main", repo: { full_name: repository } },
  };
  const auditPr = {
    number: 21,
    state: "open",
    draft: false,
    body: "审计编号：AUD-GOV-RC-002\n审计对象：" + sha + "\n最终结论：通过\n",
    head: { sha: "1".repeat(40), ref: "governance/audit-002", repo: { full_name: repository } },
    base: { sha: "d81785dd51bb0c9be339449566a15d3b3971e02a", ref: "main", repo: { full_name: repository } },
  };
  const result = migrateLegacyBootstrap(legacy, {
    candidatePullRequest: candidatePr,
    auditPullRequest: auditPr,
    candidateTreeSha: "2".repeat(40),
    planRecord: "规划编号：GOV-PLAN-1\n目标：治理固化\n",
  }, contract);
  assert.equal(result.state.schemaVersion, 2);
  assert.equal(result.state.stage, "RELEASE_APPROVED");
  assert.equal(result.state.revision, 3);
  assert.equal(result.state.candidateSha, sha);
  assert.equal(result.state.records.planAudit, null);

  const failedAudit = structuredClone(auditPr);
  failedAudit.body = "审计编号：AUD-GOV-RC-002\n审计对象：" + sha + "\n最终结论：不通过\n";
  assert.throws(() => migrateLegacyBootstrap(legacy, {
    candidatePullRequest: candidatePr,
    auditPullRequest: failedAudit,
    candidateTreeSha: "2".repeat(40),
    planRecord: "规划编号：GOV-PLAN-1\n目标：治理固化\n",
  }, contract), /没有通过结论|不通过/u);

  const futureLegacy = structuredClone(legacy);
  futureLegacy.activeVersion = "governance-2";
  assert.throws(() => migrateLegacyBootstrap(futureLegacy, {
    candidatePullRequest: candidatePr,
    auditPullRequest: auditPr,
    candidateTreeSha: "2".repeat(40),
    planRecord: "规划编号：GOV-PLAN-1\n目标：治理固化\n",
  }, contract), /旧 bootstrap 阶段不匹配/u);
});

test("ships an owner-only protected writer with mandatory previous state, record-first commits and ref CAS", async () => {
  const workflow = await readText(".github/workflows/governance-state.yml");
  const contract = await readJson(contractPath);
  assert.match(workflow, /issue_comment:\s*\n\s*types: \[created\]/u);
  assert.match(workflow, /COMMENT_ACTOR.*REPOSITORY_OWNER/su);
  assert.match(workflow, /\^\/governance-transition.*\[0-9a-f\]\{40\}/u);
  assert.match(workflow, /ref: main/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /validate-transition.*--previous.*--records-root/su);
  assert.match(workflow, /verify-remote/u);
  assert.match(workflow, /Commit the immutable record before the pointer[\s\S]*Commit current and version snapshot/u);
  assert.match(workflow, /git ls-remote[\s\S]*git .* push/u);
  assert.doesNotMatch(workflow, /governance-state\.mjs[^\n]* \+\s/u);
  assert.doesNotMatch(workflow, /wrangler|cloudflare:deploy|git tag|refs\/tags\//u);
  assert.equal(contract.runtime.directPushAllowed, false);
  assert.equal(contract.runtime.branchProtectionRequired, true);
  assert.equal(contract.runtime.cloudflarePreviewBuildsAllowed, false);
});

test("stops Cloudflare Workers Builds for governance branches before build or version upload", () => {
  for (const branch of ["governance-state", "governance/four-role-auto-handoff"]) {
    const result = spawnSync("bash", ["scripts/build-verified.sh"], {
      encoding: "utf8",
      env: { ...process.env, WORKERS_CI: "1", WORKERS_CI_BRANCH: branch },
    });
    assert.equal(result.status, 78, branch);
    assert.match(result.stderr, /disabled for governance-only branches/u);
    assert.doesNotMatch(result.stdout, /Running bounded vinext build/u);
  }
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
  assert.match(readme, /bootstrap.*governance-1/su);
  assert.match(readme, /进入 main.*不得再次|进入.*main.*禁用/su);
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
