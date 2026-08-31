import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const ROLE_NAMES = Object.freeze({
  1: "超级规划",
  2: "超级审计",
  3: "超级工作",
  4: "超级发布",
});

export const GOVERNANCE_STAGES = Object.freeze([
  "IDLE",
  "PLANNING",
  "PLAN_AUDIT_PENDING",
  "IMPLEMENTATION_APPROVED",
  "IMPLEMENTING",
  "RC_AUDIT_PENDING",
  "RELEASE_APPROVED",
  "PRODUCTION_PREFLIGHT",
  "RELEASING",
  "PRODUCTION_VERIFIED",
  "IMPLEMENTATION_REQUIRED",
  "PLANNING_REQUIRED",
  "BLOCKED",
  "ROLLED_BACK",
]);

const STAGE_SET = new Set(GOVERNANCE_STAGES);
const RUNTIME_POINTER = /^governance\/runtime\/(?:records|versions)\/[A-Za-z0-9._/-]+$/u;
const CANDIDATE_SHA = /^[0-9a-f]{40}$/u;
const RELEASE_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/u;
const ACTIVE_VERSION = /^(?:[0-9]+\.[0-9]+\.[0-9]+|governance-[a-z0-9][a-z0-9.-]*)$/u;
const FORBIDDEN_RUNTIME_KEY = /secret|password|recovery|token|cookie/iu;

const EXPECTED_CAPABILITIES = Object.freeze({
  1: { canDeployProduction: false, canApproveOwnPlan: false },
  2: { canDeployProduction: false, canAuditReleaseCandidate: true },
  3: { canModifyProductCode: true, canExpandFrozenScope: false, canDeployProduction: false },
  4: {
    canDeployProduction: true,
    canModifyProductCodeDuringRelease: false,
    canDeployUnapprovedCandidate: false,
  },
});

const RECOVERY_RULES = Object.freeze({
  IDLE: { roleNumber: null, action: "当前没有活跃正式版本流程", records: [] },
  PLANNING: { roleNumber: 1, action: "继续规划并完成入库", records: [] },
  PLAN_AUDIT_PENDING: { roleNumber: 2, action: "执行方案审计", records: ["plan"] },
  IMPLEMENTATION_APPROVED: { roleNumber: 3, action: "读取冻结方案并开始实现", records: ["plan", "planAudit"] },
  IMPLEMENTING: { roleNumber: 3, action: "继续实现并生成候选", records: ["plan", "planAudit"] },
  RC_AUDIT_PENDING: { roleNumber: 2, action: "执行候选版本审计", records: ["releaseCandidate"] },
  RELEASE_APPROVED: { roleNumber: 4, action: "读取批准 SHA 并执行生产预检", records: ["releaseCandidate", "rcAudit"] },
  PRODUCTION_PREFLIGHT: { roleNumber: 4, action: "继续生产预检", records: ["releaseCandidate", "rcAudit"] },
  RELEASING: { roleNumber: 4, action: "继续正式发布或安全回滚", records: ["releaseCandidate", "rcAudit"] },
  PRODUCTION_VERIFIED: { roleNumber: 4, action: "核对发布回执并关闭版本", records: ["releaseReceipt"] },
  IMPLEMENTATION_REQUIRED: { roleNumber: 3, action: "读取候选审计并修复实现", records: ["releaseCandidate", "rcAudit"] },
  PLANNING_REQUIRED: { roleNumber: 1, action: "读取方案审计并修订规划", records: ["planAudit"] },
  BLOCKED: { roleNumber: null, action: "按阻断来源恢复", records: [] },
  ROLLED_BACK: { roleNumber: 4, action: "核对回滚证据并移交修复", records: ["releaseReceipt"] },
});

export class GovernanceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "GovernanceValidationError";
  }
}

function invariant(condition, message) {
  if (!condition) throw new GovernanceValidationError(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoForbiddenRuntimeKeys(value, path = "$") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    invariant(!FORBIDDEN_RUNTIME_KEY.test(key), `运行时状态含禁止字段：${path}.${key}`);
    assertNoForbiddenRuntimeKeys(child, `${path}.${key}`);
  }
}

function validateRuntimePointer(pointer, field) {
  invariant(pointer === null || (typeof pointer === "string" && RUNTIME_POINTER.test(pointer)), `${field} 不是允许的 governance/runtime 指针`);
  if (typeof pointer === "string") {
    invariant(!pointer.includes("..") && !pointer.includes("//"), `${field} 含不安全路径片段`);
  }
}

export function validateGovernanceContract(input) {
  const contract = clone(input);
  invariant(contract.schemaVersion === 1, "role-contract schemaVersion 必须为 1");
  invariant(contract.productionBranch === "main", "生产分支必须保持 main");
  invariant(contract.runtime?.stateBranch === "governance-state", "动态协调分支必须为 governance-state");
  invariant(contract.runtime.stateBranch !== contract.productionBranch, "动态协调分支不得等于生产分支");
  invariant(contract.runtime.productionDeploymentTriggeredByStateBranch === false, "动态协调分支不得触发生产部署");
  invariant(Array.isArray(contract.roles) && contract.roles.length === 4, "必须且只能有四个治理角色");

  const numbers = contract.roles.map((role) => role.roleNumber);
  invariant(new Set(numbers).size === 4, "roleNumber 必须唯一");
  invariant(numbers.toSorted().join(",") === "1,2,3,4", "roleNumber 必须固定为 1/2/3/4");

  for (const role of contract.roles) {
    invariant(ROLE_NAMES[role.roleNumber] === role.roleName, `角色 ${role.roleNumber} 名称映射被改变`);
    invariant(role.contractPath === `governance/roles/${role.slug}.md`, `角色 ${role.roleNumber} 合同路径无效`);
    invariant(Array.isArray(role.transitions), `角色 ${role.roleNumber} 缺少状态转换`);
    for (const transition of role.transitions) {
      invariant(STAGE_SET.has(transition.from) && STAGE_SET.has(transition.to), `角色 ${role.roleNumber} 含未知状态转换`);
      invariant(!(transition.from === "PLAN_AUDIT_PENDING" && transition.to === "RELEASE_APPROVED"), "禁止从方案待审直接跳到发布批准");
    }
    for (const [capability, expected] of Object.entries(EXPECTED_CAPABILITIES[role.roleNumber])) {
      invariant(role.capabilities?.[capability] === expected, `角色 ${role.roleNumber} 的 ${capability} 被非法修改`);
    }
  }

  const requiredStages = new Set(contract.requiredWorkflowStages ?? []);
  for (const stage of GOVERNANCE_STAGES) invariant(requiredStages.has(stage), `工作流缺少阶段 ${stage}`);
  invariant(requiredStages.has("PLAN_AUDIT_PENDING"), "工作流缺少方案审计阶段");
  invariant(requiredStages.has("RC_AUDIT_PENDING"), "工作流缺少候选版本审计阶段");

  const role3 = contract.roles.find((role) => role.roleNumber === 3);
  invariant(role3.transitions.every(({ to }) => !["RELEASE_APPROVED", "PRODUCTION_PREFLIGHT", "RELEASING", "PRODUCTION_VERIFIED"].includes(to)), "角色 3 不得直接进入发布阶段");
  const role4 = contract.roles.find((role) => role.roleNumber === 4);
  invariant(role4.transitions.some(({ from, to }) => from === "RELEASE_APPROVED" && to === "PRODUCTION_PREFLIGHT"), "角色 4 必须从已批准候选开始预检");
  invariant(role4.transitions.every(({ from }) => !["PLAN_AUDIT_PENDING", "IMPLEMENTING", "RC_AUDIT_PENDING"].includes(from)), "角色 4 不得绕过候选审计");
  return contract;
}

export function assertTransition(contractInput, roleNumber, from, to) {
  const contract = validateGovernanceContract(contractInput);
  const role = contract.roles.find((item) => item.roleNumber === roleNumber);
  invariant(Boolean(role), `未知角色编号 ${roleNumber}`);
  invariant(role.transitions.some((transition) => transition.from === from && transition.to === to), `角色 ${roleNumber} 无权执行 ${from} → ${to}`);
  return true;
}

export function validateGovernanceState(input, options = {}) {
  const state = clone(input);
  const allowedTopLevel = new Set([
    "schemaVersion",
    "project",
    "repository",
    "activeVersion",
    "stage",
    "taskLevel",
    "revision",
    "lastUpdatedBy",
    "records",
    "candidateSha",
    "releaseTag",
    "bootstrap",
  ]);
  invariant(state && typeof state === "object" && !Array.isArray(state), "current 状态必须是 JSON 对象");
  for (const key of Object.keys(state)) invariant(allowedTopLevel.has(key), `current 状态含未知字段 ${key}`);
  assertNoForbiddenRuntimeKeys(state);
  invariant(state.schemaVersion === 1, "current schemaVersion 必须为 1");
  invariant(state.project === "student-portfolio-cloudflare", "current project 不匹配");
  invariant(state.repository === "q1433031046-ship-it/student-portfolio-cloudflare", "current repository 不匹配");
  invariant(typeof state.activeVersion === "string" && ACTIVE_VERSION.test(state.activeVersion), "activeVersion 格式无效");
  invariant(STAGE_SET.has(state.stage), `未知治理阶段 ${state.stage}`);
  invariant(["L0", "L1", "L2", "L3"].includes(state.taskLevel), "taskLevel 必须为 L0/L1/L2/L3");
  invariant(Number.isInteger(state.revision) && state.revision >= 0, "revision 必须为非负整数");

  const roleNumber = state.lastUpdatedBy?.roleNumber;
  invariant(ROLE_NAMES[roleNumber] === state.lastUpdatedBy?.roleName, "lastUpdatedBy 的编号和名称不匹配");
  const expectedRecordKeys = ["plan", "planAudit", "releaseCandidate", "rcAudit", "releaseReceipt"];
  invariant(state.records && typeof state.records === "object" && !Array.isArray(state.records), "records 必须是对象");
  invariant(Object.keys(state.records).toSorted().join(",") === expectedRecordKeys.toSorted().join(","), "records 字段集合不完整或含未知项");
  for (const key of expectedRecordKeys) validateRuntimePointer(state.records[key], `records.${key}`);
  invariant(state.candidateSha === null || CANDIDATE_SHA.test(state.candidateSha), "candidateSha 必须为空或完整小写 SHA");
  invariant(state.releaseTag === null || RELEASE_TAG.test(state.releaseTag), "releaseTag 必须为空或正式版本标签");

  if (state.stage === "PLAN_AUDIT_PENDING") invariant(typeof state.records.plan === "string", "PLAN_AUDIT_PENDING 必须存在 plan 指针");
  if (state.stage === "RC_AUDIT_PENDING") {
    invariant(typeof state.records.releaseCandidate === "string", "RC_AUDIT_PENDING 必须存在 releaseCandidate 指针");
    invariant(typeof state.candidateSha === "string", "RC_AUDIT_PENDING 必须存在 candidateSha");
  }
  if (["RELEASE_APPROVED", "PRODUCTION_PREFLIGHT", "RELEASING"].includes(state.stage)) {
    invariant(typeof state.records.rcAudit === "string", `${state.stage} 必须存在 rcAudit 指针`);
    invariant(typeof state.candidateSha === "string", `${state.stage} 必须存在 candidateSha`);
  }

  if (options.previous) {
    const previous = validateGovernanceState(options.previous);
    invariant(state.revision === previous.revision + 1, "revision 必须相对上一状态严格 +1");
    if (state.stage !== previous.stage) {
      invariant(options.contract, "验证阶段变化时必须提供 role-contract");
      assertTransition(options.contract, roleNumber, previous.stage, state.stage);
    }
  }
  return state;
}

export function recoverRole(stateInput, roleNumber) {
  const state = validateGovernanceState(stateInput);
  invariant(ROLE_NAMES[roleNumber], `未知角色编号 ${roleNumber}`);
  const rule = RECOVERY_RULES[state.stage];
  if (rule.roleNumber !== null && rule.roleNumber !== roleNumber) {
    const expected = `${rule.roleNumber}（${ROLE_NAMES[rule.roleNumber]}）`;
    throw new GovernanceValidationError(`当前阶段 ${state.stage} 应由 ${expected}接手；上一角色尚未完成所需入库交接时，不得猜测或要求用户搬运文件`);
  }
  const records = [];
  for (const key of ["plan", "planAudit", "releaseCandidate", "rcAudit", "releaseReceipt"]) {
    if (typeof state.records[key] === "string") records.push({ key, path: state.records[key] });
  }
  for (const key of rule.records) invariant(typeof state.records[key] === "string", `${state.stage} 缺少前置记录 ${key}`);
  return {
    roleNumber,
    roleName: ROLE_NAMES[roleNumber],
    activeVersion: state.activeVersion,
    stage: state.stage,
    revision: state.revision,
    action: rule.action,
    records,
    candidateSha: state.candidateSha,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const [command, statePath, ...args] = process.argv.slice(2);
  if (command !== "validate" || !statePath) {
    throw new GovernanceValidationError("用法：node scripts/governance-state.mjs validate <current.json> [--previous <old.json>] [--contract <role-contract.json>]");
  }
  const previousIndex = args.indexOf("--previous");
  const contractIndex = args.indexOf("--contract");
  const previous = previousIndex >= 0 ? await readJson(args[previousIndex + 1]) : undefined;
  const contract = contractIndex >= 0
    ? await readJson(args[contractIndex + 1])
    : await readJson("governance/role-contract.json");
  validateGovernanceContract(contract);
  const state = validateGovernanceState(await readJson(statePath), { previous, contract });
  process.stdout.write(`治理状态有效：${state.activeVersion} ${state.stage} revision=${state.revision}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
