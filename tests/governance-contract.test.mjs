import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  GOVERNANCE_STAGES,
  GovernanceValidationError,
  ROLE_NAMES,
  assertTransition,
  recoverRole,
  validateGovernanceContract,
  validateGovernanceState,
} from "../scripts/governance-state.mjs";

const readText = (path) => readFile(path, "utf8");
const readJson = async (path) => JSON.parse(await readText(path));

const contractPath = "governance/role-contract.json";
const schemaPath = "governance/state-schema.json";

function role(contract, number) {
  return contract.roles.find((item) => item.roleNumber === number);
}

function stateAt(stage, overrides = {}) {
  const records = {
    plan: "governance/runtime/records/v1.3.1/01-plan.md",
    planAudit: "governance/runtime/records/v1.3.1/02-plan-audit.md",
    releaseCandidate: "governance/runtime/records/v1.3.1/04-release-candidate.md",
    rcAudit: "governance/runtime/records/v1.3.1/05-rc-audit.md",
    releaseReceipt: "governance/runtime/records/v1.3.1/06-release-receipt.md",
    ...overrides.records,
  };
  return {
    schemaVersion: 1,
    project: "student-portfolio-cloudflare",
    repository: "q1433031046-ship-it/student-portfolio-cloudflare",
    activeVersion: "1.3.1",
    stage,
    taskLevel: "L2",
    revision: overrides.revision ?? 10,
    lastUpdatedBy: overrides.lastUpdatedBy ?? { roleNumber: 3, roleName: "超级工作" },
    records,
    candidateSha: overrides.candidateSha === undefined ? "a".repeat(40) : overrides.candidateSha,
    releaseTag: overrides.releaseTag ?? null,
  };
}

function assertAgentsEntrypoint(source) {
  assert.match(source, /Four-role governance entry/u);
  assert.match(source, /1=超级规划, 2=超级审计, 3=超级工作, and 4=超级发布/u);
  assert.match(source, /governance\/README\.md/u);
  assert.match(source, /governance\/workflow\.md/u);
  assert.match(source, /governance\/role-contract\.json/u);
  assert.match(source, /governance-state/u);
}

test("fixes the permanent 1/2/3/4 role mapping and hard capabilities", async () => {
  const contract = validateGovernanceContract(await readJson(contractPath));
  assert.deepEqual(
    Object.fromEntries(contract.roles.map((item) => [item.roleNumber, item.roleName])),
    ROLE_NAMES,
  );
  assert.equal(role(contract, 1).capabilities.canDeployProduction, false);
  assert.equal(role(contract, 1).capabilities.canApproveOwnPlan, false);
  assert.equal(role(contract, 2).capabilities.canAuditReleaseCandidate, true);
  assert.equal(role(contract, 2).capabilities.canDeployProduction, false);
  assert.equal(role(contract, 3).capabilities.canModifyProductCode, true);
  assert.equal(role(contract, 3).capabilities.canExpandFrozenScope, false);
  assert.equal(role(contract, 3).capabilities.canDeployProduction, false);
  assert.equal(role(contract, 4).capabilities.canDeployProduction, true);
  assert.equal(role(contract, 4).capabilities.canModifyProductCodeDuringRelease, false);
  assert.equal(role(contract, 4).capabilities.canDeployUnapprovedCandidate, false);
});

test("keeps plan audit and candidate audit as separate mandatory gates", async () => {
  const contract = validateGovernanceContract(await readJson(contractPath));
  assert.ok(contract.requiredWorkflowStages.includes("PLAN_AUDIT_PENDING"));
  assert.ok(contract.requiredWorkflowStages.includes("RC_AUDIT_PENDING"));
  assertTransition(contract, 2, "PLAN_AUDIT_PENDING", "IMPLEMENTATION_APPROVED");
  assertTransition(contract, 3, "IMPLEMENTATION_APPROVED", "IMPLEMENTING");
  assertTransition(contract, 3, "IMPLEMENTING", "RC_AUDIT_PENDING");
  assertTransition(contract, 2, "RC_AUDIT_PENDING", "RELEASE_APPROVED");
  assertTransition(contract, 4, "RELEASE_APPROVED", "PRODUCTION_PREFLIGHT");
  assert.throws(
    () => assertTransition(contract, 3, "RC_AUDIT_PENDING", "RELEASE_APPROVED"),
    GovernanceValidationError,
  );
  assert.throws(
    () => assertTransition(contract, 4, "RC_AUDIT_PENDING", "RELEASING"),
    GovernanceValidationError,
  );
});

test("ships the state schema and validates the runtime examples", async () => {
  const [schema, current, versionState] = await Promise.all([
    readJson(schemaPath),
    readJson("governance/runtime-example/current.json"),
    readJson("governance/runtime-example/version-state.json"),
  ]);
  for (const field of ["activeVersion", "stage", "revision", "lastUpdatedBy", "records", "candidateSha", "releaseTag"]) {
    assert.ok(schema.required.includes(field), `state-schema missing ${field}`);
  }
  assert.deepEqual(schema.properties.stage.enum, GOVERNANCE_STAGES);
  validateGovernanceState(current);
  validateGovernanceState(versionState);
});

test("rejects unsafe state fields, paths, identities, missing pointers and stale revisions", async () => {
  const contract = await readJson(contractPath);
  const unsafeField = stateAt("PLANNING");
  unsafeField.sessionToken = "not-allowed";
  assert.throws(() => validateGovernanceState(unsafeField), /禁止字段|未知字段/u);

  const unsafePath = stateAt("PLAN_AUDIT_PENDING");
  unsafePath.records.plan = "../outside.md";
  assert.throws(() => validateGovernanceState(unsafePath), /允许的 governance\/runtime 指针/u);

  const wrongIdentity = stateAt("PLANNING");
  wrongIdentity.lastUpdatedBy = { roleNumber: 1, roleName: "超级审计" };
  assert.throws(() => validateGovernanceState(wrongIdentity), /编号和名称不匹配/u);

  const missingCandidate = stateAt("RC_AUDIT_PENDING", { candidateSha: null, records: { releaseCandidate: null } });
  assert.throws(() => validateGovernanceState(missingCandidate), /releaseCandidate|candidateSha/u);

  const previous = stateAt("IMPLEMENTATION_APPROVED", {
    revision: 20,
    lastUpdatedBy: { roleNumber: 2, roleName: "超级审计" },
  });
  const stale = stateAt("IMPLEMENTING", { revision: 20 });
  assert.throws(
    () => validateGovernanceState(stale, { previous, contract }),
    /revision 必须相对上一状态严格 \+1/u,
  );
  const next = stateAt("IMPLEMENTING", { revision: 21 });
  validateGovernanceState(next, { previous, contract });
});

test("ships four self-recovering role contracts with all role numbers", async () => {
  const files = ["super-planning.md", "super-audit.md", "super-work.md", "super-release.md"];
  const sources = await Promise.all(files.map((file) => readText(`governance/roles/${file}`)));
  for (const source of sources) {
    assert.match(source, /1=超级规划/u);
    assert.match(source, /2=超级审计/u);
    assert.match(source, /3=超级工作/u);
    assert.match(source, /4=超级发布/u);
    assert.match(source, /自动读取.*current 状态/us);
    assert.match(source, /新对话恢复/u);
    assert.match(source, /不要求用户搬运已有交接文件/u);
    assert.match(source, /写入.*成功|入库.*成功/us);
  }
});

test("ships all six handoff templates and their critical fields", async () => {
  const expected = {
    "plan-handoff.md": ["规划编号", "版本", "目标", "非目标", "Migration", "验收标准", "目标状态"],
    "audit-report.md": ["审计编号", "审计类型", "审计对象", "阻断问题", "高风险问题", "剩余风险", "最终结论"],
    "release-candidate.md": ["Candidate SHA", "分支", "新增 Migration", "测试", "构建", "代码规范检查", "类型检查", "端到端测试", "生产环境修改：没有"],
    "release-receipt.md": ["已批准 Candidate SHA", "实际部署 SHA", "发布标签", "生产", "Migration", "回滚", "最终状态"],
    "progress-report.md": ["当前角色", "当前阶段", "当前版本", "仓库状态 revision", "下一步"],
    "blocked-report.md": ["当前角色", "阻断编号", "为什么必须停止", "当前生产是否受影响", "需要哪个角色接手"],
  };
  const listed = (await readdir("governance/handoff")).toSorted();
  assert.deepEqual(listed, Object.keys(expected).toSorted());
  for (const [file, fields] of Object.entries(expected)) {
    const source = await readText(`governance/handoff/${file}`);
    for (const field of fields) assert.match(source, new RegExp(field, "u"), `${file} missing ${field}`);
  }
});

test("documents automatic handoff, atomic state writes and non-production coordination", async () => {
  const [readme, workflow, contract, workflows] = await Promise.all([
    readText("governance/README.md"),
    readText("governance/workflow.md"),
    readJson(contractPath),
    Promise.all((await readdir(".github/workflows")).map((file) => readText(`.github/workflows/${file}`))),
  ]);
  assert.match(readme, /governance-state/u);
  assert.match(readme, /不要求用户搬运/u);
  assert.match(workflow, /先提交交接记录|先以最新 tip 为父提交写入 records/u);
  assert.match(workflow, /revision \+ 1/u);
  assert.match(workflow, /compare-and-swap/u);
  assert.match(workflow, /方案审计与候选版本审计|方案审计和候选版本审计|方案审计.*候选版本审计/us);
  assert.equal(contract.runtime.productionDeploymentTriggeredByStateBranch, false);
  for (const source of workflows) assert.doesNotMatch(source, /branches:\s*\[[^\]]*governance-state/u);
});

test("root AGENTS contains only the governance navigation contract", async () => {
  const source = await readText("AGENTS.md");
  assertAgentsEntrypoint(source);
  const removed = source.replace(/## Four-role governance entry[\s\S]*$/u, "");
  assert.throws(() => assertAgentsEntrypoint(removed));
});

test("fails closed for every required governance drift mutation", async () => {
  const original = await readJson(contractPath);

  const role3Deploy = structuredClone(original);
  role(role3Deploy, 3).capabilities.canDeployProduction = true;
  assert.throws(() => validateGovernanceContract(role3Deploy), /角色 3.*canDeployProduction/u);

  const role4Edits = structuredClone(original);
  role(role4Edits, 4).capabilities.canModifyProductCodeDuringRelease = true;
  assert.throws(() => validateGovernanceContract(role4Edits), /角色 4.*canModifyProductCodeDuringRelease/u);

  const noRcAudit = structuredClone(original);
  noRcAudit.requiredWorkflowStages = noRcAudit.requiredWorkflowStages.filter((stage) => stage !== "RC_AUDIT_PENDING");
  assert.throws(() => validateGovernanceContract(noRcAudit), /RC_AUDIT_PENDING/u);

  const duplicateNumber = structuredClone(original);
  role(duplicateNumber, 2).roleNumber = 3;
  assert.throws(() => validateGovernanceContract(duplicateNumber), /roleNumber 必须唯一/u);

  const directRelease = structuredClone(original);
  role(directRelease, 2).transitions.push({ from: "PLAN_AUDIT_PENDING", to: "RELEASE_APPROVED" });
  assert.throws(() => validateGovernanceContract(directRelease), /禁止从方案待审直接跳到发布批准/u);
});

test("recovers all four one-sentence handoffs without old chat context", () => {
  const planAudit = recoverRole(stateAt("PLAN_AUDIT_PENDING", {
    candidateSha: null,
    lastUpdatedBy: { roleNumber: 1, roleName: "超级规划" },
    records: { planAudit: null, releaseCandidate: null, rcAudit: null, releaseReceipt: null },
  }), 2);
  assert.equal(planAudit.action, "执行方案审计");
  assert.deepEqual(planAudit.records.map(({ key }) => key), ["plan"]);

  const implementation = recoverRole(stateAt("IMPLEMENTATION_APPROVED", {
    candidateSha: null,
    lastUpdatedBy: { roleNumber: 2, roleName: "超级审计" },
    records: { releaseCandidate: null, rcAudit: null, releaseReceipt: null },
  }), 3);
  assert.equal(implementation.action, "读取冻结方案并开始实现");
  assert.deepEqual(implementation.records.map(({ key }) => key), ["plan", "planAudit"]);

  const candidateAudit = recoverRole(stateAt("RC_AUDIT_PENDING"), 2);
  assert.equal(candidateAudit.action, "执行候选版本审计");
  assert.equal(candidateAudit.candidateSha, "a".repeat(40));
  assert.deepEqual(candidateAudit.records.map(({ key }) => key), ["plan", "planAudit", "releaseCandidate", "rcAudit", "releaseReceipt"]);

  const release = recoverRole(stateAt("RELEASE_APPROVED", {
    lastUpdatedBy: { roleNumber: 2, roleName: "超级审计" },
  }), 4);
  assert.equal(release.action, "读取批准 SHA 并执行生产预检");
  assert.equal(release.candidateSha, "a".repeat(40));
});

test("blocks a role invoked at the wrong stage instead of guessing or asking for files", () => {
  const planning = stateAt("PLANNING", {
    candidateSha: null,
    lastUpdatedBy: { roleNumber: 1, roleName: "超级规划" },
    records: { plan: null, planAudit: null, releaseCandidate: null, rcAudit: null, releaseReceipt: null },
  });
  assert.throws(
    () => recoverRole(planning, 2),
    /应由 1（超级规划）接手.*不得猜测或要求用户搬运文件/u,
  );
});
