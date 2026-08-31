import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

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

const PROJECT = "student-portfolio-cloudflare";
const REPOSITORY = "q1433031046-ship-it/student-portfolio-cloudflare";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const VERSION = /^(?:[0-9]+\.[0-9]+\.[0-9]+|governance-[a-z0-9][a-z0-9.-]*)$/u;
const RELEASE_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/u;
const FORBIDDEN_RUNTIME_KEY = /secret|password|recovery|token|cookie|credential|privateKey/iu;
const RECORD_KEYS = Object.freeze(["plan", "planAudit", "releaseCandidate", "rcAudit", "releaseReceipt", "blocked"]);
const RECORD_FILES = Object.freeze({
  plan: "01-plan.md",
  planAudit: "02-plan-audit.md",
  releaseCandidate: "04-release-candidate.md",
  rcAudit: "05-rc-audit.md",
  releaseReceipt: "06-release-receipt.md",
  blocked: "07-blocked.md",
});

const CAPABILITIES = Object.freeze({
  1: {
    canModifyProductCode: false,
    canExpandFrozenScope: false,
    canApproveOwnPlan: false,
    canAuditReleaseCandidate: false,
    canDeployProduction: false,
    canModifyProductCodeDuringRelease: false,
    canDeployUnapprovedCandidate: false,
  },
  2: {
    canModifyProductCode: false,
    canExpandFrozenScope: false,
    canApproveOwnPlan: false,
    canAuditReleaseCandidate: true,
    canDeployProduction: false,
    canModifyProductCodeDuringRelease: false,
    canDeployUnapprovedCandidate: false,
  },
  3: {
    canModifyProductCode: true,
    canExpandFrozenScope: false,
    canApproveOwnPlan: false,
    canAuditReleaseCandidate: false,
    canDeployProduction: false,
    canModifyProductCodeDuringRelease: false,
    canDeployUnapprovedCandidate: false,
  },
  4: {
    canModifyProductCode: false,
    canExpandFrozenScope: false,
    canApproveOwnPlan: false,
    canAuditReleaseCandidate: false,
    canDeployProduction: true,
    canModifyProductCodeDuringRelease: false,
    canDeployUnapprovedCandidate: false,
  },
});

const CANONICAL_ROLES = Object.freeze([
  {
    roleNumber: 1,
    roleName: "超级规划",
    slug: "super-planning",
    contractPath: "governance/roles/super-planning.md",
    handoffTemplate: "governance/handoff/plan-handoff.md",
    capabilities: CAPABILITIES[1],
    readStages: ["IDLE", "PLANNING", "PLANNING_REQUIRED", "BLOCKED"],
    transitions: [
      { from: "IDLE", to: "PLANNING" },
      { from: "PLANNING_REQUIRED", to: "PLANNING" },
      { from: "PLANNING", to: "PLAN_AUDIT_PENDING" },
      { from: "BLOCKED", to: "PLANNING" },
    ],
  },
  {
    roleNumber: 2,
    roleName: "超级审计",
    slug: "super-audit",
    contractPath: "governance/roles/super-audit.md",
    handoffTemplate: "governance/handoff/audit-report.md",
    capabilities: CAPABILITIES[2],
    readStages: ["PLAN_AUDIT_PENDING", "RC_AUDIT_PENDING", "BLOCKED"],
    transitions: [
      { from: "PLAN_AUDIT_PENDING", to: "IMPLEMENTATION_APPROVED" },
      { from: "PLAN_AUDIT_PENDING", to: "PLANNING_REQUIRED" },
      { from: "PLAN_AUDIT_PENDING", to: "BLOCKED" },
      { from: "RC_AUDIT_PENDING", to: "RELEASE_APPROVED" },
      { from: "RC_AUDIT_PENDING", to: "IMPLEMENTATION_REQUIRED" },
      { from: "RC_AUDIT_PENDING", to: "BLOCKED" },
      { from: "BLOCKED", to: "PLAN_AUDIT_PENDING" },
      { from: "BLOCKED", to: "RC_AUDIT_PENDING" },
    ],
  },
  {
    roleNumber: 3,
    roleName: "超级工作",
    slug: "super-work",
    contractPath: "governance/roles/super-work.md",
    handoffTemplate: "governance/handoff/release-candidate.md",
    capabilities: CAPABILITIES[3],
    readStages: ["IMPLEMENTATION_APPROVED", "IMPLEMENTATION_REQUIRED", "IMPLEMENTING", "BLOCKED", "ROLLED_BACK"],
    transitions: [
      { from: "IMPLEMENTATION_APPROVED", to: "IMPLEMENTING" },
      { from: "IMPLEMENTATION_REQUIRED", to: "IMPLEMENTING" },
      { from: "IMPLEMENTING", to: "RC_AUDIT_PENDING" },
      { from: "IMPLEMENTING", to: "BLOCKED" },
      { from: "BLOCKED", to: "IMPLEMENTING" },
      { from: "ROLLED_BACK", to: "IMPLEMENTATION_REQUIRED" },
    ],
  },
  {
    roleNumber: 4,
    roleName: "超级发布",
    slug: "super-release",
    contractPath: "governance/roles/super-release.md",
    handoffTemplate: "governance/handoff/release-receipt.md",
    capabilities: CAPABILITIES[4],
    readStages: ["RELEASE_APPROVED", "PRODUCTION_PREFLIGHT", "RELEASING", "BLOCKED"],
    transitions: [
      { from: "RELEASE_APPROVED", to: "PRODUCTION_PREFLIGHT" },
      { from: "PRODUCTION_PREFLIGHT", to: "RELEASING" },
      { from: "PRODUCTION_PREFLIGHT", to: "BLOCKED" },
      { from: "RELEASING", to: "PRODUCTION_VERIFIED" },
      { from: "RELEASING", to: "ROLLED_BACK" },
      { from: "RELEASING", to: "BLOCKED" },
      { from: "BLOCKED", to: "PRODUCTION_PREFLIGHT" },
      { from: "BLOCKED", to: "RELEASING" },
    ],
  },
]);

const CANONICAL_RUNTIME = Object.freeze({
  stateBranch: "governance-state",
  currentPath: "governance/runtime/current.json",
  versionStatePattern: "governance/runtime/versions/<activeVersion>.json",
  recordsRoot: "governance/runtime/records/",
  productionDeploymentTriggeredByStateBranch: false,
  writeWorkflow: ".github/workflows/governance-state.yml",
  writeCommand: "/governance-transition <expected-tip> <expected-revision> <role-number> <target-stage>",
  bootstrapWriteCommand: "/governance-bootstrap <expected-tip> <expected-revision> <candidate-pr-number>",
  directPushAllowed: false,
  branchProtectionRequired: true,
  cloudflarePreviewBuildsAllowed: false,
  recordFirstThenPointer: true,
  compareAndSwapRequired: true,
});

const BOOTSTRAP_POLICY = Object.freeze({
  activeVersion: "governance-1",
  candidateBranch: "governance/four-role-auto-handoff",
  baseSha: "d81785dd51bb0c9be339449566a15d3b3971e02a",
  planAuditMayBeNull: true,
  disableAfterContractOnMain: true,
});

const RECORD_REQUIREMENTS = Object.freeze({
  IDLE: [],
  PLANNING: [],
  PLAN_AUDIT_PENDING: ["plan"],
  IMPLEMENTATION_APPROVED: ["plan", "planAudit"],
  IMPLEMENTING: ["plan", "planAudit"],
  RC_AUDIT_PENDING: ["plan", "planAudit", "releaseCandidate"],
  RELEASE_APPROVED: ["plan", "planAudit", "releaseCandidate", "rcAudit"],
  PRODUCTION_PREFLIGHT: ["plan", "planAudit", "releaseCandidate", "rcAudit"],
  RELEASING: ["plan", "planAudit", "releaseCandidate", "rcAudit"],
  PRODUCTION_VERIFIED: ["plan", "planAudit", "releaseCandidate", "rcAudit", "releaseReceipt"],
  IMPLEMENTATION_REQUIRED: ["plan", "planAudit", "releaseCandidate", "rcAudit"],
  PLANNING_REQUIRED: ["plan", "planAudit"],
  BLOCKED: ["blocked"],
  ROLLED_BACK: ["plan", "planAudit", "releaseCandidate", "rcAudit", "releaseReceipt"],
});

const RECOVERY_RULES = Object.freeze({
  IDLE: { roleNumber: null, action: "当前没有活跃正式版本流程" },
  PLANNING: { roleNumber: 1, action: "继续规划并完成入库" },
  PLAN_AUDIT_PENDING: { roleNumber: 2, action: "执行方案审计" },
  IMPLEMENTATION_APPROVED: { roleNumber: 3, action: "读取冻结方案并开始实现" },
  IMPLEMENTING: { roleNumber: 3, action: "继续实现并生成候选" },
  RC_AUDIT_PENDING: { roleNumber: 2, action: "执行候选版本审计" },
  RELEASE_APPROVED: { roleNumber: 4, action: "读取批准 SHA 并执行生产预检" },
  PRODUCTION_PREFLIGHT: { roleNumber: 4, action: "继续生产预检" },
  RELEASING: { roleNumber: 4, action: "继续正式发布或安全回滚" },
  PRODUCTION_VERIFIED: { roleNumber: 4, action: "核对发布回执并关闭版本" },
  IMPLEMENTATION_REQUIRED: { roleNumber: 3, action: "读取候选审计并修复实现" },
  PLANNING_REQUIRED: { roleNumber: 1, action: "读取方案审计并修订规划" },
  ROLLED_BACK: { roleNumber: 3, action: "读取回滚回执并修复实现" },
});

const BASE_ALLOWED_FIELDS = Object.freeze(["stage", "revision", "lastUpdatedBy"]);
const BLOCK_FIELDS = Object.freeze(["block", "records.blocked", "recordDigests.blocked"]);
const TRANSITION_FIELDS = Object.freeze({
  "1:IDLE->PLANNING": [
    "activeVersion", "taskLevel", "records.*", "recordDigests.*", "candidateSha",
    "candidateContext", "releaseTag", "bootstrap", "block",
  ],
  "1:PLANNING_REQUIRED->PLANNING": [
    "records.plan", "recordDigests.plan", "records.planAudit", "recordDigests.planAudit",
    "records.releaseCandidate", "recordDigests.releaseCandidate", "records.rcAudit",
    "recordDigests.rcAudit", "records.releaseReceipt", "recordDigests.releaseReceipt",
    "candidateSha", "candidateContext", "releaseTag", "bootstrap",
  ],
  "1:PLANNING->PLAN_AUDIT_PENDING": ["records.plan", "recordDigests.plan"],
  "1:BLOCKED->PLANNING": BLOCK_FIELDS,
  "2:PLAN_AUDIT_PENDING->IMPLEMENTATION_APPROVED": ["records.planAudit", "recordDigests.planAudit"],
  "2:PLAN_AUDIT_PENDING->PLANNING_REQUIRED": ["records.planAudit", "recordDigests.planAudit"],
  "2:PLAN_AUDIT_PENDING->BLOCKED": BLOCK_FIELDS,
  "2:RC_AUDIT_PENDING->RELEASE_APPROVED": ["records.rcAudit", "recordDigests.rcAudit"],
  "2:RC_AUDIT_PENDING->IMPLEMENTATION_REQUIRED": ["records.rcAudit", "recordDigests.rcAudit"],
  "2:RC_AUDIT_PENDING->BLOCKED": BLOCK_FIELDS,
  "2:BLOCKED->PLAN_AUDIT_PENDING": BLOCK_FIELDS,
  "2:BLOCKED->RC_AUDIT_PENDING": BLOCK_FIELDS,
  "3:IMPLEMENTATION_APPROVED->IMPLEMENTING": [],
  "3:IMPLEMENTATION_REQUIRED->IMPLEMENTING": [],
  "3:IMPLEMENTING->RC_AUDIT_PENDING": [
    "records.releaseCandidate", "recordDigests.releaseCandidate", "records.rcAudit",
    "recordDigests.rcAudit", "candidateSha", "candidateContext", "bootstrap",
  ],
  "3:IMPLEMENTING->BLOCKED": BLOCK_FIELDS,
  "3:BLOCKED->IMPLEMENTING": BLOCK_FIELDS,
  "3:ROLLED_BACK->IMPLEMENTATION_REQUIRED": [],
  "4:RELEASE_APPROVED->PRODUCTION_PREFLIGHT": [],
  "4:PRODUCTION_PREFLIGHT->RELEASING": [],
  "4:PRODUCTION_PREFLIGHT->BLOCKED": BLOCK_FIELDS,
  "4:RELEASING->PRODUCTION_VERIFIED": [
    "records.releaseReceipt", "recordDigests.releaseReceipt", "releaseTag",
  ],
  "4:RELEASING->ROLLED_BACK": ["records.releaseReceipt", "recordDigests.releaseReceipt"],
  "4:RELEASING->BLOCKED": BLOCK_FIELDS,
  "4:BLOCKED->PRODUCTION_PREFLIGHT": BLOCK_FIELDS,
  "4:BLOCKED->RELEASING": BLOCK_FIELDS,
});

const BLOCK_RECOVERY_TARGETS = Object.freeze({
  "1:PLANNING": "PLANNING",
  "1:PLANNING_REQUIRED": "PLANNING",
  "2:PLAN_AUDIT_PENDING": "PLAN_AUDIT_PENDING",
  "2:RC_AUDIT_PENDING": "RC_AUDIT_PENDING",
  "3:IMPLEMENTATION_APPROVED": "IMPLEMENTING",
  "3:IMPLEMENTING": "IMPLEMENTING",
  "3:IMPLEMENTATION_REQUIRED": "IMPLEMENTING",
  "4:RELEASE_APPROVED": "PRODUCTION_PREFLIGHT",
  "4:PRODUCTION_PREFLIGHT": "PRODUCTION_PREFLIGHT",
  "4:RELEASING": "RELEASING",
});

const FROZEN_CANDIDATE_STAGES = new Set([
  "RELEASE_APPROVED",
  "PRODUCTION_PREFLIGHT",
  "RELEASING",
  "PRODUCTION_VERIFIED",
  "ROLLED_BACK",
]);

const SECRET_PATTERNS = Object.freeze([
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["github-token", /(?:github_pat_|gh[pousr]_|ghs_)[A-Za-z0-9_]{12,}/u],
  ["jwt", /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u],
  ["credential-assignment", /(?:password|recovery(?:[_ -]?code)?|admin(?:[_ -]?code)?|secret|token)\s*[:=]\s*[^\s<]{6,}/iu],
  ["private-contact", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu],
  ["network-address", /\b(?:\d{1,3}\.){3}\d{1,3}\b/u],
  ["production-resource-id", /\b[0-9a-f]{32}\b/u],
  ["access-link", /https?:\/\/[^\s)]+(?:access|redeem|qr)[^\s)]*(?:[?&](?:token|code|key)=)/iu],
]);

const moduleRoot = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(moduleRoot, "../governance/state-schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
const validateSchema = ajv.compile(schema);

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

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).toSorted().map((key) => [key, normalized(value[key])]));
  }
  return value;
}

function exact(actual, expected, label) {
  invariant(JSON.stringify(normalized(actual)) === JSON.stringify(normalized(expected)), label + " 必须与冻结允许列表完全一致");
}

function assertNoForbiddenRuntimeKeys(value, path = "$") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    invariant(!FORBIDDEN_RUNTIME_KEY.test(key), "治理状态含禁止字段：" + path + "." + key);
    assertNoForbiddenRuntimeKeys(child, path + "." + key);
  }
}

function pointerFor(version, key) {
  return "governance/runtime/records/" + version + "/" + RECORD_FILES[key];
}

function digest(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function schemaError() {
  const first = validateSchema.errors?.[0];
  const location = first?.instancePath || "$";
  const keyword = first?.keyword || "schema";
  return "状态 Schema 校验失败：" + location + " (" + keyword + ")";
}

export function validateStateSchema(input) {
  const state = clone(input);
  invariant(validateSchema(state), schemaError());
  return state;
}

export function validateGovernanceContract(input) {
  const contract = clone(input);
  exact(Object.keys(contract).toSorted(), [
    "bootstrapPolicy", "productionBranch", "project", "repository", "requiredWorkflowStages",
    "roles", "runtime", "schemaVersion",
  ].toSorted(), "role-contract 顶层字段");
  invariant(contract.schemaVersion === 2, "role-contract schemaVersion 必须为 2");
  invariant(contract.project === PROJECT, "role-contract project 不匹配");
  invariant(contract.repository === REPOSITORY, "role-contract repository 不匹配");
  invariant(contract.productionBranch === "main", "生产分支必须保持 main");
  exact(contract.runtime, CANONICAL_RUNTIME, "动态写入合同");
  exact(contract.bootstrapPolicy, BOOTSTRAP_POLICY, "bootstrap 策略");
  exact(contract.requiredWorkflowStages, GOVERNANCE_STAGES, "治理阶段");
  exact(contract.roles, CANONICAL_ROLES, "四角色权限、读取阶段与转换");
  return contract;
}

export function assertTransition(contractInput, roleNumber, from, to) {
  const contract = validateGovernanceContract(contractInput);
  const role = contract.roles.find((item) => item.roleNumber === roleNumber);
  invariant(Boolean(role), "未知角色编号 " + roleNumber);
  invariant(role.transitions.some((transition) => transition.from === from && transition.to === to), "角色 " + roleNumber + " 无权执行 " + from + " → " + to);
  return true;
}

function isBootstrap(state, contract) {
  if (state.bootstrap === null) return false;
  const policy = contract?.bootstrapPolicy ?? BOOTSTRAP_POLICY;
  invariant(state.activeVersion === policy.activeVersion, "bootstrap 只能用于固定治理版本");
  invariant(state.stage === "RC_AUDIT_PENDING" || state.stage === "RELEASE_APPROVED", "bootstrap 只能处于治理候选审计阶段");
  invariant(state.bootstrap.candidateSha === state.candidateSha, "bootstrap candidateSha 必须与状态一致");
  invariant(state.bootstrap.candidateBranch === policy.candidateBranch, "bootstrap 候选分支不匹配");
  invariant(state.bootstrap.baseSha === policy.baseSha, "bootstrap 基线不匹配");
  invariant(state.candidateContext?.branch === policy.candidateBranch, "bootstrap Candidate 上下文分支不匹配");
  invariant(state.candidateContext?.baseSha === policy.baseSha, "bootstrap Candidate 上下文基线不匹配");
  return true;
}

function requiredRecordsFor(state, bootstrap) {
  const required = [...RECORD_REQUIREMENTS[state.stage]];
  if (bootstrap && BOOTSTRAP_POLICY.planAuditMayBeNull) {
    const index = required.indexOf("planAudit");
    if (index >= 0) required.splice(index, 1);
  }
  if (state.stage === "BLOCKED" && state.block) {
    for (const key of RECORD_REQUIREMENTS[state.block.sourceStage] ?? []) {
      if (!required.includes(key)) required.push(key);
    }
  }
  return required;
}

export function validateGovernanceState(input, options = {}) {
  const state = validateStateSchema(input);
  const contract = options.contract ? validateGovernanceContract(options.contract) : undefined;
  assertNoForbiddenRuntimeKeys(state);
  invariant(state.project === PROJECT && state.repository === REPOSITORY, "治理状态项目身份不匹配");
  invariant(VERSION.test(state.activeVersion), "activeVersion 格式无效");
  invariant(GOVERNANCE_STAGES.includes(state.stage), "未知治理阶段 " + state.stage);
  invariant(Number.isInteger(state.revision) && state.revision >= 0, "revision 必须为非负整数");
  invariant(ROLE_NAMES[state.lastUpdatedBy.roleNumber] === state.lastUpdatedBy.roleName, "lastUpdatedBy 的编号和名称不匹配");
  invariant(state.candidateSha === null || SHA40.test(state.candidateSha), "candidateSha 必须为空或完整小写 SHA");
  invariant(state.releaseTag === null || RELEASE_TAG.test(state.releaseTag), "releaseTag 必须为空或正式版本标签");

  for (const key of RECORD_KEYS) {
    const pointer = state.records[key];
    const recordDigest = state.recordDigests[key];
    invariant(pointer === null || pointer === pointerFor(state.activeVersion, key), "records." + key + " 必须绑定当前 activeVersion 与固定记录类型");
    invariant(recordDigest === null || SHA256.test(recordDigest), "recordDigests." + key + " 格式无效");
    invariant((pointer === null) === (recordDigest === null), "records." + key + " 与摘要必须同时为空或同时存在");
  }

  const bootstrap = isBootstrap(state, contract);
  for (const key of requiredRecordsFor(state, bootstrap)) {
    invariant(typeof state.records[key] === "string", state.stage + " 缺少必需记录 " + key);
  }
  if (["RC_AUDIT_PENDING", "RELEASE_APPROVED", "PRODUCTION_PREFLIGHT", "RELEASING", "PRODUCTION_VERIFIED", "IMPLEMENTATION_REQUIRED", "ROLLED_BACK"].includes(state.stage)) {
    invariant(typeof state.candidateSha === "string" && state.candidateContext, state.stage + " 必须绑定 Candidate 远端身份");
  }
  if (state.stage === "BLOCKED") {
    invariant(state.block && state.block.ownerRoleNumber === state.lastUpdatedBy.roleNumber, "BLOCKED 必须绑定阻断来源和负责角色");
  } else {
    invariant(state.block === null, "非 BLOCKED 状态不得保留 block");
  }

  if (options.previous) {
    invariant(contract, "验证状态写入时必须提供 role-contract");
    validateGovernanceTransition(options.previous, state, contract);
  }
  return state;
}

function changedPaths(before, after, prefix = "") {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const bothObjects = before && after && typeof before === "object" && typeof after === "object"
    && !Array.isArray(before) && !Array.isArray(after);
  if (!bothObjects) return [prefix];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key) => changedPaths(before[key], after[key], prefix ? prefix + "." + key : key));
}

function fieldAllowed(path, allowed) {
  return allowed.some((entry) => entry.endsWith(".*")
    ? path.startsWith(entry.slice(0, -1))
    : path === entry || path.startsWith(entry + "."));
}

function validateBlockedTransition(previous, next, roleNumber) {
  if (next.stage === "BLOCKED") {
    invariant(next.block?.sourceStage === previous.stage, "BLOCKED sourceStage 必须等于前一阶段");
    invariant(next.block?.ownerRoleNumber === roleNumber, "BLOCKED ownerRoleNumber 必须等于写入角色");
  }
  if (previous.stage === "BLOCKED") {
    invariant(previous.block?.ownerRoleNumber === roleNumber, "只有阻断责任角色可以恢复 BLOCKED");
    const expectedTarget = BLOCK_RECOVERY_TARGETS[roleNumber + ":" + previous.block.sourceStage];
    invariant(next.stage === expectedTarget, "BLOCKED 必须恢复到来源对应的最小安全阶段");
    invariant(next.block === null, "离开 BLOCKED 时必须清空 block");
  }
}

export function validateGovernanceTransition(previousInput, nextInput, contractInput) {
  const contract = validateGovernanceContract(contractInput);
  const previous = validateGovernanceState(previousInput, { contract });
  const next = validateGovernanceState(nextInput, { contract });
  const roleNumber = next.lastUpdatedBy.roleNumber;
  invariant(next.revision === previous.revision + 1, "revision 必须相对上一状态严格 +1");
  invariant(next.stage !== previous.stage, "禁止同阶段改写；必须执行明确的允许转换");
  assertTransition(contract, roleNumber, previous.stage, next.stage);
  validateBlockedTransition(previous, next, roleNumber);

  const policyKey = roleNumber + ":" + previous.stage + "->" + next.stage;
  const allowed = [...BASE_ALLOWED_FIELDS, ...(TRANSITION_FIELDS[policyKey] ?? [])];
  invariant(policyKey in TRANSITION_FIELDS, "缺少转换字段允许列表 " + policyKey);
  const changed = changedPaths(previous, next);
  for (const path of changed) invariant(fieldAllowed(path, allowed), "转换 " + policyKey + " 不得修改字段 " + path);

  if (FROZEN_CANDIDATE_STAGES.has(previous.stage)) {
    for (const path of ["activeVersion", "candidateSha", "candidateContext", "records.releaseCandidate", "recordDigests.releaseCandidate", "records.rcAudit", "recordDigests.rcAudit"]) {
      invariant(!changed.some((item) => item === path || item.startsWith(path + ".")), "候选审计通过后字段已冻结：" + path);
    }
  }
  if (next.stage === "RELEASE_APPROVED") {
    invariant(previous.candidateSha === next.candidateSha, "审计通过不得替换 candidateSha");
    invariant(previous.records.releaseCandidate === next.records.releaseCandidate, "审计通过不得替换 Candidate 记录");
  }
  return next;
}

export function scanGovernanceText(text, label = "record") {
  invariant(typeof text === "string", "泄密扫描输入必须为文本");
  for (const [kind, pattern] of SECRET_PATTERNS) {
    invariant(!pattern.test(text), label + " 未通过无秘密检查（" + kind + "）");
  }
  return true;
}

export async function verifyRecordFiles(stateInput, root) {
  const state = validateGovernanceState(stateInput);
  for (const key of RECORD_KEYS) {
    if (state.records[key] === null) continue;
    const absolute = resolve(root, state.records[key]);
    invariant(absolute.startsWith(resolve(root) + "/"), "记录路径越出验证根目录");
    let content;
    try {
      content = await readFile(absolute, "utf8");
    } catch {
      throw new GovernanceValidationError("找不到必需记录 " + key);
    }
    scanGovernanceText(content, "记录 " + key);
    invariant(digest(content) === state.recordDigests[key], "记录摘要不匹配 " + key);
  }
  scanGovernanceText(JSON.stringify(state), "治理状态");
  return true;
}

async function githubJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  invariant(response.ok, "Candidate 远端核验失败（HTTP " + response.status + "）");
  return response.json();
}

export async function verifyRemoteCandidate(stateInput, options = {}) {
  const state = validateGovernanceState(stateInput);
  invariant(state.candidateSha && state.candidateContext, "当前阶段没有可核验的 Candidate");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = options.token ?? process.env.GITHUB_TOKEN;
  invariant(typeof token === "string" && token.length > 0, "缺少 GitHub 只读核验凭据");
  const api = "https://api.github.com/repos/" + state.repository;
  const commit = await githubJson(fetchImpl, api + "/git/commits/" + state.candidateSha, token);
  invariant(commit.sha === state.candidateSha, "Candidate 对象不是目标 commit");
  invariant(commit.tree?.sha === state.candidateContext.treeSha, "Candidate tree 不匹配");
  const branch = await githubJson(fetchImpl, api + "/branches/" + encodeURIComponent(state.candidateContext.branch), token);
  invariant(branch.commit?.sha === state.candidateSha, "Candidate 分支 tip 已变化");
  const pr = await githubJson(fetchImpl, api + "/pulls/" + state.candidateContext.pullRequest, token);
  invariant(pr.state === "open" && pr.draft === false, "Candidate PR 必须开放且非 draft");
  invariant(pr.head?.repo?.full_name === state.repository && pr.head?.ref === state.candidateContext.branch, "Candidate PR head 身份不匹配");
  invariant(pr.head?.sha === state.candidateSha, "Candidate PR head SHA 不匹配");
  invariant(pr.base?.repo?.full_name === state.repository && pr.base?.ref === "main", "Candidate PR 必须指向本仓库 main");
  invariant(pr.base?.sha === state.candidateContext.baseSha, "Candidate PR 基线不匹配");
  const comparison = await githubJson(fetchImpl, api + "/compare/" + state.candidateContext.baseSha + "..." + state.candidateSha, token);
  invariant(["ahead", "identical"].includes(comparison.status), "Candidate 不是冻结基线的后代");
  return {
    candidateSha: state.candidateSha,
    treeSha: commit.tree.sha,
    branch: state.candidateContext.branch,
    pullRequest: state.candidateContext.pullRequest,
    baseSha: state.candidateContext.baseSha,
  };
}

function transitionRecordKey(previousStage, nextStage) {
  if (nextStage === "BLOCKED") return "blocked";
  if (previousStage === "PLANNING" && nextStage === "PLAN_AUDIT_PENDING") return "plan";
  if (previousStage === "PLAN_AUDIT_PENDING") return "planAudit";
  if (previousStage === "IMPLEMENTING" && nextStage === "RC_AUDIT_PENDING") return "releaseCandidate";
  if (previousStage === "RC_AUDIT_PENDING") return "rcAudit";
  if (previousStage === "RELEASING" && ["PRODUCTION_VERIFIED", "ROLLED_BACK"].includes(nextStage)) return "releaseReceipt";
  return null;
}

function requirePrRecord(body, key, candidateSha) {
  invariant(typeof body === "string" && body.trim().length >= 40, "该转换需要非空 PR 交接记录");
  scanGovernanceText(body, "PR 交接记录");
  if (key === "releaseCandidate") {
    invariant(body.includes(candidateSha), "Candidate 交接记录必须包含准确 PR head SHA");
  }
  if (key === "planAudit" || key === "rcAudit") invariant(/审计编号/u.test(body), "审计记录必须包含审计编号");
  return body.endsWith("\n") ? body : body + "\n";
}

export function buildGovernanceTransition(previousInput, request, contractInput) {
  const contract = validateGovernanceContract(contractInput);
  const previous = validateGovernanceState(previousInput, { contract });
  const roleNumber = Number(request.roleNumber);
  const targetStage = request.targetStage;
  const pr = request.pullRequest;
  invariant(pr && pr.state === "open" && pr.draft === false, "状态提案必须来自开放且非 draft 的 PR");
  invariant(pr.head?.repo?.full_name === REPOSITORY && pr.base?.repo?.full_name === REPOSITORY, "状态提案禁止来自 fork");
  invariant(pr.base?.ref === "main", "状态提案 PR 必须指向 main");
  assertTransition(contract, roleNumber, previous.stage, targetStage);

  const next = clone(previous);
  next.schemaVersion = 2;
  next.stage = targetStage;
  next.revision = previous.revision + 1;
  next.lastUpdatedBy = { roleNumber, roleName: ROLE_NAMES[roleNumber] };
  const key = transitionRecordKey(previous.stage, targetStage);
  let record = null;
  if (key) {
    record = requirePrRecord(pr.body, key, pr.head.sha);
    next.records[key] = pointerFor(next.activeVersion, key);
    next.recordDigests[key] = digest(record);
  }
  if (previous.stage === "IMPLEMENTING" && targetStage === "RC_AUDIT_PENDING") {
    invariant(SHA40.test(pr.head.sha) && SHA40.test(request.treeSha), "Candidate PR 缺少 commit/tree 身份");
    next.candidateSha = pr.head.sha;
    next.candidateContext = {
      branch: pr.head.ref,
      pullRequest: pr.number,
      baseSha: pr.base.sha,
      treeSha: request.treeSha,
    };
    next.records.rcAudit = null;
    next.recordDigests.rcAudit = null;
    if (next.bootstrap) {
      next.bootstrap.candidateSha = pr.head.sha;
      next.bootstrap.candidateBranch = pr.head.ref;
      next.bootstrap.baseSha = pr.base.sha;
    }
  }
  if (targetStage === "BLOCKED") {
    next.block = { sourceStage: previous.stage, ownerRoleNumber: roleNumber };
  }
  if (previous.stage === "BLOCKED") {
    next.block = null;
    next.records.blocked = null;
    next.recordDigests.blocked = null;
  }
  if (previous.stage === "PLANNING_REQUIRED" && targetStage === "PLANNING") {
    for (const item of ["planAudit", "releaseCandidate", "rcAudit", "releaseReceipt", "blocked"]) {
      next.records[item] = null;
      next.recordDigests[item] = null;
    }
    next.candidateSha = null;
    next.candidateContext = null;
    next.releaseTag = null;
    next.bootstrap = null;
  }
  validateGovernanceTransition(previous, next, contract);
  return { state: next, recordKey: key, record };
}

export function migrateLegacyBootstrap(previousInput, request, contractInput) {
  const contract = validateGovernanceContract(contractInput);
  const previous = clone(previousInput);
  invariant(previous.schemaVersion === 1, "bootstrap 迁移只接受旧 Schema 1");
  invariant(previous.project === PROJECT && previous.repository === REPOSITORY, "旧 bootstrap 项目身份不匹配");
  invariant(previous.activeVersion === "governance-1" && previous.stage === "RC_AUDIT_PENDING", "旧 bootstrap 阶段不匹配");
  invariant(previous.revision === 2, "旧 bootstrap revision 必须精确为 2");
  invariant(previous.candidateSha === "7caf24d4c52f1502d43cbf668329701986669a6e", "旧 bootstrap Candidate 不匹配");
  invariant(previous.bootstrap?.isBootstrapCandidate === true, "旧状态不是受审计的一次性 bootstrap");

  const candidatePr = request.candidatePullRequest;
  const auditPr = request.auditPullRequest;
  invariant(candidatePr?.number === 13 && candidatePr.state === "open" && candidatePr.draft === false, "bootstrap Candidate 必须来自开放的 PR #13");
  invariant(candidatePr.head?.repo?.full_name === REPOSITORY && candidatePr.base?.repo?.full_name === REPOSITORY, "bootstrap Candidate 禁止来自 fork");
  invariant(candidatePr.head?.ref === BOOTSTRAP_POLICY.candidateBranch && candidatePr.base?.ref === "main", "bootstrap Candidate 分支或基线分支不匹配");
  invariant(candidatePr.base?.sha === BOOTSTRAP_POLICY.baseSha, "bootstrap Candidate 基线 SHA 不匹配");
  invariant(SHA40.test(candidatePr.head?.sha) && SHA40.test(request.candidateTreeSha), "bootstrap Candidate 缺少 commit/tree 身份");
  invariant(auditPr?.state === "open" && auditPr.draft === false, "bootstrap 审计记录必须来自开放且非 draft 的 PR");
  invariant(auditPr.head?.repo?.full_name === REPOSITORY && auditPr.base?.repo?.full_name === REPOSITORY && auditPr.base?.ref === "main", "bootstrap 审计 PR 身份不匹配");

  const plan = request.planRecord;
  const candidate = requirePrRecord(candidatePr.body, "releaseCandidate", candidatePr.head.sha);
  const audit = requirePrRecord(auditPr.body, "rcAudit", candidatePr.head.sha);
  scanGovernanceText(plan, "bootstrap 规划记录");
  invariant(/最终结论\s*[:：]\s*(?:通过|有条件通过)/u.test(audit), "bootstrap 审计记录没有通过结论");
  invariant(!/最终结论\s*[:：]\s*不通过/u.test(audit), "bootstrap 审计结论不通过");

  const state = {
    schemaVersion: 2,
    project: PROJECT,
    repository: REPOSITORY,
    activeVersion: "governance-1",
    stage: "RELEASE_APPROVED",
    taskLevel: "L2",
    revision: 3,
    lastUpdatedBy: { roleNumber: 2, roleName: ROLE_NAMES[2] },
    records: {
      plan: pointerFor("governance-1", "plan"),
      planAudit: null,
      releaseCandidate: pointerFor("governance-1", "releaseCandidate"),
      rcAudit: pointerFor("governance-1", "rcAudit"),
      releaseReceipt: null,
      blocked: null,
    },
    recordDigests: {
      plan: digest(plan),
      planAudit: null,
      releaseCandidate: digest(candidate),
      rcAudit: digest(audit),
      releaseReceipt: null,
      blocked: null,
    },
    candidateSha: candidatePr.head.sha,
    candidateContext: {
      branch: candidatePr.head.ref,
      pullRequest: candidatePr.number,
      baseSha: candidatePr.base.sha,
      treeSha: request.candidateTreeSha,
    },
    releaseTag: null,
    block: null,
    bootstrap: {
      isBootstrapCandidate: true,
      candidateSha: candidatePr.head.sha,
      candidateBranch: candidatePr.head.ref,
      baseSha: candidatePr.base.sha,
    },
  };
  validateGovernanceState(state, { contract });
  return { state, records: { releaseCandidate: candidate, rcAudit: audit } };
}

export function recoverRole(stateInput, roleNumber, contractInput) {
  const state = validateGovernanceState(stateInput, contractInput ? { contract: contractInput } : {});
  invariant(ROLE_NAMES[roleNumber], "未知角色编号 " + roleNumber);
  const rule = state.stage === "BLOCKED"
    ? { roleNumber: state.block.ownerRoleNumber, action: "按阻断记录恢复到来源对应的安全阶段" }
    : RECOVERY_RULES[state.stage];
  if (rule.roleNumber !== null && rule.roleNumber !== roleNumber) {
    const expected = rule.roleNumber + "（" + ROLE_NAMES[rule.roleNumber] + "）";
    throw new GovernanceValidationError("当前阶段 " + state.stage + " 应由 " + expected + "接手；不得猜测或要求用户搬运文件");
  }
  const records = RECORD_KEYS
    .filter((key) => typeof state.records[key] === "string")
    .map((key) => ({ key, path: state.records[key], sha256: state.recordDigests[key] }));
  return {
    roleNumber,
    roleName: ROLE_NAMES[roleNumber],
    activeVersion: state.activeVersion,
    stage: state.stage,
    revision: state.revision,
    action: rule.action,
    records,
    candidateSha: state.candidateSha,
    candidateContext: state.candidateContext,
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function option(args, name) {
  const index = args.indexOf(name);
  invariant(index >= 0 && args[index + 1], "缺少参数 " + name);
  return args[index + 1];
}

async function main() {
  const [command, statePath, ...args] = process.argv.slice(2);
  const contractPath = args.includes("--contract") ? option(args, "--contract") : "governance/role-contract.json";
  const contract = validateGovernanceContract(await readJson(contractPath));
  if (command === "validate-static" && statePath) {
    const state = validateGovernanceState(await readJson(statePath), { contract });
    process.stdout.write("治理状态结构有效：" + state.activeVersion + " " + state.stage + " revision=" + state.revision + "\n");
    return;
  }
  if (command === "validate-transition" && statePath) {
    const previousPath = option(args, "--previous");
    const root = option(args, "--records-root");
    const previous = await readJson(previousPath);
    const next = validateGovernanceTransition(previous, await readJson(statePath), contract);
    await verifyRecordFiles(next, root);
    process.stdout.write("治理状态转换有效：" + previous.stage + " → " + next.stage + " revision=" + next.revision + "\n");
    return;
  }
  if (command === "verify-remote" && statePath) {
    const evidence = await verifyRemoteCandidate(await readJson(statePath));
    process.stdout.write(JSON.stringify(evidence) + "\n");
    return;
  }
  if (command === "verify-records" && statePath) {
    const root = option(args, "--records-root");
    await verifyRecordFiles(await readJson(statePath), root);
    process.stdout.write("治理记录摘要与无秘密检查通过\n");
    return;
  }
  if (command === "resolve-placeholders" && statePath) {
    const outputPath = option(args, "--output");
    const candidateSha = option(args, "--candidate-sha");
    const treeSha = option(args, "--tree-sha");
    const source = await readFile(statePath, "utf8");
    const resolved = source.replaceAll("PR_HEAD", candidateSha).replaceAll("PR_TREE", treeSha);
    await writeFile(outputPath, resolved);
    validateStateSchema(JSON.parse(resolved));
    return;
  }
  if (command === "build-transition" && statePath) {
    const roleNumber = Number(option(args, "--role"));
    const targetStage = option(args, "--target");
    const prPath = option(args, "--pr");
    const treeSha = option(args, "--tree-sha");
    const outputPath = option(args, "--output");
    const recordOutput = option(args, "--record-output");
    const metaOutput = option(args, "--meta-output");
    const result = buildGovernanceTransition(await readJson(statePath), {
      roleNumber,
      targetStage,
      pullRequest: await readJson(prPath),
      treeSha,
    }, contract);
    await writeFile(outputPath, JSON.stringify(result.state, null, 2) + "\n");
    if (result.recordKey) await writeFile(recordOutput, result.record);
    await writeFile(metaOutput, JSON.stringify({ recordKey: result.recordKey, recordPath: result.recordKey ? result.state.records[result.recordKey] : null }) + "\n");
    return;
  }
  if (command === "build-bootstrap" && statePath) {
    const candidatePr = await readJson(option(args, "--candidate-pr"));
    const auditPr = await readJson(option(args, "--audit-pr"));
    const candidateTreeSha = option(args, "--tree-sha");
    const planRecord = await readFile(option(args, "--plan-record"), "utf8");
    const outputPath = option(args, "--output");
    const candidateOutput = option(args, "--candidate-output");
    const auditOutput = option(args, "--audit-output");
    const result = migrateLegacyBootstrap(await readJson(statePath), {
      candidatePullRequest: candidatePr,
      auditPullRequest: auditPr,
      candidateTreeSha,
      planRecord,
    }, contract);
    await writeFile(outputPath, JSON.stringify(result.state, null, 2) + "\n");
    await writeFile(candidateOutput, result.records.releaseCandidate);
    await writeFile(auditOutput, result.records.rcAudit);
    return;
  }
  throw new GovernanceValidationError(
    "用法：validate-static；validate-transition；verify-records；verify-remote；build-transition；build-bootstrap",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
}
