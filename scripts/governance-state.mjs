import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  bootstrapRecoveryCommand: "/governance-bootstrap-recover <expected-tip> 2 13 14 <candidate-sha> <tree-sha> <recovery-head-sha>",
  writeTransport: "protected-pull-request",
  requiredStatusContext: "governance-state-write",
  requiredStatusAppId: 15368,
  statusProducer: "default-branch-repository-dispatch-proposal-gate",
  requiredCheckTransport: "checks-api-head-sha",
  writerRequestsIndependentGate: true,
  authorizationSource: "repository-owner-issue-comment",
  authorizationRevalidatedByGate: true,
  writerMayCreateStatus: false,
  writerMayCreateCheckRun: false,
  proposalVerifierExecutesHeadCode: false,
  pullRequestRequired: true,
  strictUpToDateRequired: true,
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
  failedAuditRecovery: {
    legacyTip: "3e7867d3cdba75045f6dc8aa0448ccaac3547b68",
    legacyRevision: 2,
    legacyCandidateSha: "7caf24d4c52f1502d43cbf668329701986669a6e",
    candidatePullRequest: 13,
    candidateSha: "e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b",
    candidateTreeSha: "a54f47d5f5b5b54e18454d5faa7a4fc3a403228d",
    recoveryPullRequest: 14,
    recoveryBranch: "recovery/governance-rc-audit-r1",
    recoveryHeadSha: "9451ef05fbe289aaade134bb60fb1a57e5eb15a6",
    auditConclusion: "failed",
    targetStage: "IMPLEMENTATION_REQUIRED",
    resultSchemaVersion: 2,
    resultRevision: 3,
    singleUse: true,
    retainCompletedReceipt: true,
  },
});

const AUDIT_POLICY = Object.freeze({
  acceptedConclusions: ["通过", "不通过"],
  conclusionTargets: {
    PLAN_AUDIT_PENDING: {
      "通过": "IMPLEMENTATION_APPROVED",
      "不通过": "PLANNING_REQUIRED",
    },
    RC_AUDIT_PENDING: {
      "通过": "RELEASE_APPROVED",
      "不通过": "IMPLEMENTATION_REQUIRED",
    },
  },
  rcAuditIdentityFields: ["candidateSha", "candidateTreeSha", "candidatePullRequest"],
  approvedCandidateShaRequiredOnPass: true,
  riskAcceptancePolicy: {
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
    followUpVersionPatterns: [
      "^v[0-9]+\\.[0-9]+\\.[0-9]+$",
      "^governance-[1-9][0-9]*$",
    ],
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
  },
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
    const childPath = path + "." + key;
    const isFixedRecoveryIdentity = childPath === "$.bootstrap.recoveryPullRequest"
      || childPath === "$.bootstrap.recoveryHeadSha";
    invariant(isFixedRecoveryIdentity || !FORBIDDEN_RUNTIME_KEY.test(key), "治理状态含禁止字段：" + childPath);
    assertNoForbiddenRuntimeKeys(child, childPath);
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
    "auditPolicy", "bootstrapPolicy", "productionBranch", "project", "repository", "requiredWorkflowStages",
    "roles", "runtime", "schemaVersion",
  ].toSorted(), "role-contract 顶层字段");
  invariant(contract.schemaVersion === 2, "role-contract schemaVersion 必须为 2");
  invariant(contract.project === PROJECT, "role-contract project 不匹配");
  invariant(contract.repository === REPOSITORY, "role-contract repository 不匹配");
  invariant(contract.productionBranch === "main", "生产分支必须保持 main");
  exact(contract.runtime, CANONICAL_RUNTIME, "动态写入合同");
  exact(contract.bootstrapPolicy, BOOTSTRAP_POLICY, "bootstrap 策略");
  exact(contract.auditPolicy, AUDIT_POLICY, "审计结论与 Candidate 绑定策略");
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
  const recovery = policy.failedAuditRecovery;
  invariant(recovery?.singleUse === true && recovery.retainCompletedReceipt === true, "失败审计恢复策略未冻结为一次性回执");
  exact(state.bootstrap, {
    mode: "legacy-failed-audit-recovery",
    completed: true,
    sourceSchemaVersion: 1,
    sourceRevision: recovery.legacyRevision,
    sourceTip: recovery.legacyTip,
    legacyCandidateSha: recovery.legacyCandidateSha,
    candidateSha: recovery.candidateSha,
    candidateBranch: policy.candidateBranch,
    candidateTreeSha: recovery.candidateTreeSha,
    candidatePullRequest: recovery.candidatePullRequest,
    recoveryPullRequest: recovery.recoveryPullRequest,
    recoveryHeadSha: recovery.recoveryHeadSha,
    baseSha: policy.baseSha,
    targetStage: recovery.targetStage,
    auditConclusion: recovery.auditConclusion,
  }, "失败审计恢复回执");
  invariant([
    "IMPLEMENTATION_REQUIRED", "IMPLEMENTING", "RC_AUDIT_PENDING", "RELEASE_APPROVED",
    "PRODUCTION_PREFLIGHT", "RELEASING", "PRODUCTION_VERIFIED", "BLOCKED", "ROLLED_BACK",
  ].includes(state.stage), "失败审计恢复回执只能保留在恢复后的治理阶段");
  if (state.stage === recovery.targetStage && state.candidateSha === recovery.candidateSha) {
    exact(state.candidateContext, {
      branch: policy.candidateBranch,
      pullRequest: recovery.candidatePullRequest,
      baseSha: policy.baseSha,
      treeSha: recovery.candidateTreeSha,
    }, "失败审计恢复 Candidate 上下文");
  }
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
    const relativePath = relative(resolve(root), absolute);
    invariant(relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath), "记录路径越出验证根目录");
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

async function verifyRemoteCandidateObject(state, options = {}) {
  invariant(state.candidateSha && state.candidateContext, "当前阶段没有可核验的 Candidate");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = options.token ?? process.env.GITHUB_TOKEN;
  invariant(typeof token === "string" && token.length > 0, "缺少 GitHub 只读核验凭据");
  const api = "https://api.github.com/repos/" + state.repository;
  const commit = await githubJson(fetchImpl, api + "/git/commits/" + state.candidateSha, token);
  invariant(commit.sha === state.candidateSha, "Candidate 对象不是目标 commit");
  invariant(commit.tree?.sha === state.candidateContext.treeSha, "Candidate tree 不匹配");
  return {
    candidateSha: state.candidateSha,
    treeSha: commit.tree.sha,
  };
}

export async function verifyRemoteCandidate(stateInput, options = {}) {
  const state = validateGovernanceState(stateInput);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const objectEvidence = await verifyRemoteCandidateObject(state, { fetchImpl, token });
  const api = "https://api.github.com/repos/" + state.repository;
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
    ...objectEvidence,
    branch: state.candidateContext.branch,
    pullRequest: state.candidateContext.pullRequest,
    baseSha: state.candidateContext.baseSha,
  };
}

function candidateVerificationMode(next) {
  if (!next.candidateSha) return "none";
  if (next.stage === "IMPLEMENTING") return "historical-object";
  if (next.stage === "BLOCKED" && next.block?.sourceStage === "IMPLEMENTING") {
    return "historical-object";
  }
  return "live";
}

export function remoteCandidateVerificationMode(previousInput, nextInput, contractInput) {
  const next = validateGovernanceTransition(previousInput, nextInput, contractInput);
  return candidateVerificationMode(next);
}

export async function verifyRemoteCandidateTransition(previousInput, nextInput, options = {}) {
  const contract = validateGovernanceContract(options.contract);
  const next = validateGovernanceTransition(previousInput, nextInput, contract);
  const mode = candidateVerificationMode(next);
  if (mode === "none") return { mode, candidateSha: null, treeSha: null };
  if (mode === "historical-object") {
    return {
      mode,
      ...await verifyRemoteCandidateObject(next, options),
    };
  }
  return {
    mode,
    ...await verifyRemoteCandidate(next, options),
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

function canonicalRecordBody(body) {
  invariant(typeof body === "string" && body.trim().length >= 40, "该转换需要非空 PR 交接记录");
  scanGovernanceText(body, "PR 交接记录");
  return body.endsWith("\n") ? body : body + "\n";
}

function markdownAtom(value) {
  return value.trim().replace(/^[`*_]+/u, "").replace(/[`*_。.]+$/u, "");
}

function auditFieldValues(body, labels) {
  const values = [];
  for (const line of body.split(/\r?\n/u)) {
    const plain = line.trim().replace(/^[-+*]\s+/u, "").replaceAll("**", "");
    for (const label of labels) {
      if (plain.startsWith(label + "：") || plain.startsWith(label + ":")) {
        values.push(plain.slice(label.length + 1).trim());
      }
    }
  }
  return values;
}

function requireAuditField(body, labels, description) {
  const values = auditFieldValues(body, labels);
  invariant(values.length === 1 && values[0].length > 0, "审计记录必须准确包含一个" + description);
  return values[0];
}

function auditConclusion(body) {
  const inline = auditFieldValues(body, ["最终结论"]);
  const heading = [];
  const lines = body.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*#{1,6}\s*最终结论\s*$/u.test(lines[index])) continue;
    const next = lines.slice(index + 1).find((line) => line.trim().length > 0);
    if (next) heading.push(next.trim());
  }
  invariant(inline.length + heading.length === 1, "审计记录必须准确包含一个最终结论");
  if (inline.length === 1) {
    const conclusion = markdownAtom(inline[0]);
    invariant(["通过", "不通过", "有条件通过"].includes(conclusion), "审计记录最终结论格式无效");
    return conclusion;
  }
  const narrative = heading[0].replace(/^[`*_]+/u, "");
  const match = /^(有条件通过|不通过|通过)(?=$|[。.;；，,\s`*_])/u.exec(narrative);
  invariant(match, "审计记录最终结论格式无效");
  return match[1];
}

const RISK_FIELD_LABELS = Object.freeze({
  knownIssueId: "Known Issue",
  classification: "风险分类",
  issue: "Issue",
  severity: "Severity",
  impactBlastRadius: "Impact / Blast Radius",
  containment: "Containment",
  stopEscalationCondition: "Stop / Escalation Condition",
  plannedFollowUpVersion: "Planned Follow-up Version",
  nonWaivableBoundary: "Non-Waivable Boundary",
});

function meaningfulRiskValue(value, description) {
  invariant(
    value.length > 0 && !/^(?:TBD|TODO|unknown|待定|未知|无|N\/A|不适用|<[^>]+>)$/iu.test(value),
    description + "不得为空或使用占位值",
  );
  return value;
}

function auditRiskBlocks(body) {
  const lines = body.split(/\r?\n/u);
  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*##\s+风险处置\s*$/u.test(lines[index])) headings.push(index);
  }
  invariant(headings.length === 1, "审计记录必须准确包含一个风险处置区块");

  const start = headings[0] + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const plain = lines[index].trim().replace(/^[-+*]\s+/u, "").replaceAll("**", "");
    if (/^\s*#{1,2}\s+\S/u.test(lines[index]) || /^最终结论[：:]/u.test(plain)) {
      end = index;
      break;
    }
  }
  const sectionLines = lines.slice(start, end);
  const section = sectionLines.join("\n");
  const countText = markdownAtom(requireAuditField(section, ["风险项数量"], "风险项数量"));
  invariant(/^(?:0|[1-9][0-9]*)$/u.test(countText), "风险项数量必须是非负整数");
  const count = Number.parseInt(countText, 10);

  const starts = [];
  for (let index = 0; index < sectionLines.length; index += 1) {
    const match = /^\s*###\s+Known Issue[：:]\s*(\S.*?)\s*$/u.exec(sectionLines[index]);
    if (match) starts.push({ index, knownIssueId: markdownAtom(match[1]) });
  }
  const preamble = sectionLines.slice(0, starts[0]?.index ?? sectionLines.length).filter((line) => line.trim().length > 0);
  invariant(
    preamble.length === 1 && /^(?:[-+*]\s+)?(?:\*\*)?风险项数量(?:\*\*)?[：:]/u.test(preamble[0].trim()),
    "风险处置区块不得包含未声明字段或多行值",
  );
  const blocks = starts.map((item, index) => ({
    knownIssueId: item.knownIssueId,
    body: sectionLines.slice(item.index + 1, starts[index + 1]?.index ?? sectionLines.length).join("\n"),
  }));
  invariant(blocks.length === count, "风险项数量必须与 Known Issue 区块数量准确一致");
  return blocks;
}

function requireRiskDisposition(body, policy, conclusion) {
  invariant(policy && typeof policy === "object", "审计合同缺少风险接受策略");
  exact(policy.requiredRiskFields, Object.keys(RISK_FIELD_LABELS), "风险记录必填字段");
  const blocks = auditRiskBlocks(body);
  const seenIssueIds = new Set();
  const knownBoundaries = new Set(policy.nonWaivableBoundaries.map((boundary) => boundary.id));

  for (const block of blocks) {
    const values = { knownIssueId: meaningfulRiskValue(block.knownIssueId, "Known Issue ID") };
    invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/u.test(values.knownIssueId), "Known Issue ID 格式无效");
    invariant(!seenIssueIds.has(values.knownIssueId), "Known Issue ID 不得重复");
    seenIssueIds.add(values.knownIssueId);

    const fieldLines = block.body.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    invariant(
      fieldLines.length === Object.keys(RISK_FIELD_LABELS).length - 1,
      "风险项不得包含缺失字段、未知字段或多行值",
    );

    for (const [field, label] of Object.entries(RISK_FIELD_LABELS)) {
      if (field === "knownIssueId") continue;
      values[field] = meaningfulRiskValue(markdownAtom(requireAuditField(block.body, [label], label)), label);
    }

    invariant(policy.classifications.includes(values.classification), "风险分类不在治理合同允许范围内");
    invariant(policy.severities.includes(values.severity), "风险 Severity 不在治理合同允许范围内");

    const containment = /^([a-z-]+)\s*\|\s*(.+)$/u.exec(values.containment);
    invariant(containment, "Containment 必须使用“机制 | 具体隔离说明”格式");
    invariant(policy.containmentMechanisms.includes(containment[1]), "Containment 机制不在治理合同允许范围内");
    meaningfulRiskValue(containment[2].trim(), "Containment 具体隔离说明");

    invariant(
      policy.followUpVersionPatterns.some((pattern) => new RegExp(pattern, "u").test(values.plannedFollowUpVersion)),
      "Planned Follow-up Version 格式无效",
    );

    const passEligible = policy.passEligibleClassifications.includes(values.classification);
    if (passEligible) {
      invariant(policy.acceptedSeverities.includes(values.severity), "Accepted 风险仅允许 Medium 或 Low Severity");
    }
    if (values.classification === "Low / Won't Fix Now") {
      invariant(policy.lowWontFixSeverities.includes(values.severity), "Low / Won't Fix Now 仅允许 Low Severity");
    }

    if (values.nonWaivableBoundary !== policy.noBoundaryValue) {
      invariant(knownBoundaries.has(values.nonWaivableBoundary), "Non-Waivable Boundary 不是合同锁定边界");
      invariant(!passEligible, "不可豁免治理边界不得标记为 Accepted、Contained、Technical Debt 或 Won't Fix");
    }

    if (conclusion === "通过") {
      invariant(passEligible, "通过结论不得包含 Blocking Risk");
      invariant(values.nonWaivableBoundary === policy.noBoundaryValue, "通过结论不得包含不可豁免治理边界");
    }
  }
  return blocks;
}

function exactAuditSha(body, label, expected) {
  const actual = markdownAtom(requireAuditField(body, [label], label));
  invariant(SHA40.test(actual) && actual === expected, label + "必须与当前 Candidate 准确匹配");
}

function requireAuditRecord(body, { auditPolicy, fromStage, kind, targetStage, candidateIdentity = null }) {
  const record = canonicalRecordBody(body);
  const auditId = markdownAtom(requireAuditField(record, ["审计编号"], "审计编号"));
  invariant(auditId.length > 0 && !/\s/u.test(auditId), "审计编号格式无效");
  const auditType = markdownAtom(requireAuditField(record, ["审计类型"], "审计类型"));
  invariant(auditType === (kind === "rcAudit" ? "候选版本审计" : "方案审计"), "审计类型与当前审计阶段不匹配");
  const conclusion = auditConclusion(record);
  invariant(auditPolicy.acceptedConclusions.includes(conclusion), "该审计结论不能进入正式治理状态");
  const target = markdownAtom(requireAuditField(record, ["目标状态"], "目标状态"));
  invariant(target === targetStage, "审计记录目标状态与请求目标状态不匹配");
  const expectedTarget = auditPolicy.conclusionTargets[fromStage]?.[conclusion];
  invariant(expectedTarget !== undefined && targetStage === expectedTarget, "审计结论与目标状态不匹配");
  requireRiskDisposition(record, auditPolicy.riskAcceptancePolicy, conclusion);

  if (kind === "rcAudit") {
    exact(auditPolicy.rcAuditIdentityFields, ["candidateSha", "candidateTreeSha", "candidatePullRequest"], "RC 审计 Candidate 绑定字段");
    invariant(auditPolicy.approvedCandidateShaRequiredOnPass === true, "RC 审计通过必须重复绑定批准 Candidate SHA");
    invariant(candidateIdentity && SHA40.test(candidateIdentity.sha) && SHA40.test(candidateIdentity.treeSha), "当前 RC 审计缺少 Candidate 身份");
    invariant(Number.isInteger(candidateIdentity.pullRequest) && candidateIdentity.pullRequest > 0, "当前 RC 审计缺少 Candidate PR 身份");
    exactAuditSha(record, "审计对象 Candidate SHA", candidateIdentity.sha);
    exactAuditSha(record, "审计对象 Tree SHA", candidateIdentity.treeSha);
    const pullRequest = markdownAtom(requireAuditField(record, ["审计对象 PR"], "审计对象 PR"));
    invariant(pullRequest === "#" + candidateIdentity.pullRequest, "审计对象 PR 必须与当前 Candidate 准确匹配");
    const approved = markdownAtom(requireAuditField(record, ["批准 Candidate SHA", "批准 Candidate SHA（候选审计适用）"], "批准 Candidate SHA"));
    if (conclusion === "通过") {
      invariant(approved === candidateIdentity.sha, "通过结论必须批准当前准确 Candidate SHA");
    } else {
      invariant(/^不适用(?:（[^）]*）)?$/u.test(approved), "不通过结论不得批准 Candidate SHA");
    }
  }
  return record;
}

function requireCurrentCandidateSource(previous, pullRequest, treeSha) {
  const identity = previous.candidateContext;
  invariant(previous.candidateSha && identity, "RC 审计缺少当前 Candidate 身份");
  invariant(pullRequest.number === identity.pullRequest, "RC 审计来源 PR 不是当前 Candidate PR");
  invariant(pullRequest.head?.sha === previous.candidateSha, "RC 审计来源 PR head 不是当前 Candidate SHA");
  invariant(pullRequest.head?.ref === identity.branch, "RC 审计来源分支不是当前 Candidate 分支");
  invariant(pullRequest.base?.sha === identity.baseSha, "RC 审计来源 PR 基线不是当前 Candidate 基线");
  invariant(treeSha === identity.treeSha, "RC 审计来源 Tree 不是当前 Candidate Tree");
  return { sha: previous.candidateSha, treeSha: identity.treeSha, pullRequest: identity.pullRequest };
}

function requirePrRecord(body, key, candidateSha) {
  const record = canonicalRecordBody(body);
  if (key === "releaseCandidate") {
    invariant(record.includes(candidateSha), "Candidate 交接记录必须包含准确 PR head SHA");
  }
  return record;
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
    if (key === "planAudit") {
      record = requireAuditRecord(pr.body, { auditPolicy: contract.auditPolicy, fromStage: previous.stage, kind: key, targetStage });
    } else if (key === "rcAudit") {
      const candidateIdentity = requireCurrentCandidateSource(previous, pr, request.treeSha);
      record = requireAuditRecord(pr.body, {
        auditPolicy: contract.auditPolicy,
        fromStage: previous.stage,
        kind: key,
        targetStage,
        candidateIdentity,
      });
    } else {
      record = requirePrRecord(pr.body, key, pr.head.sha);
    }
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

export function migrateFailedBootstrapAudit(previousInput, request, contractInput) {
  const contract = validateGovernanceContract(contractInput);
  const policy = contract.bootstrapPolicy;
  const recovery = policy.failedAuditRecovery;
  const previous = clone(previousInput);

  invariant(recovery.singleUse === true && recovery.retainCompletedReceipt === true, "失败审计恢复必须是保留回执的一次性迁移");
  invariant(previous.schemaVersion === 1, "失败审计恢复只接受旧 Schema 1");
  invariant(previous.project === PROJECT && previous.repository === REPOSITORY, "旧失败审计状态项目身份不匹配");
  invariant(previous.activeVersion === policy.activeVersion && previous.stage === "RC_AUDIT_PENDING", "旧失败审计状态阶段不匹配");
  invariant(previous.taskLevel === "L2", "旧失败审计状态任务等级不匹配");
  invariant(previous.revision === recovery.legacyRevision, "旧失败审计状态 revision 不匹配");
  invariant(previous.lastUpdatedBy?.roleNumber === 3 && previous.lastUpdatedBy?.roleName === ROLE_NAMES[3], "旧失败审计状态最后写入角色不匹配");
  invariant(previous.candidateSha === recovery.legacyCandidateSha, "旧失败审计状态 Candidate 不匹配");
  invariant(previous.bootstrap?.isBootstrapCandidate === true, "旧状态不是受审计的 bootstrap Candidate");
  invariant(previous.records?.plan === pointerFor(policy.activeVersion, "plan"), "旧失败审计状态规划记录指针不匹配");
  invariant(previous.records?.planAudit === null && previous.records?.rcAudit === null, "旧失败审计状态不得伪造审计指针");
  invariant(previous.records?.releaseCandidate === "governance/runtime/records/governance-1/04-release-candidate-r2.md", "旧失败审计状态 Candidate 记录指针不匹配");
  invariant(previous.releaseTag === null, "旧失败审计状态不得含正式 Release Tag");
  invariant(request.legacyTip === recovery.legacyTip, "旧失败审计状态 tip 不匹配");

  const candidatePr = request.candidatePullRequest;
  invariant(candidatePr?.number === recovery.candidatePullRequest && candidatePr.state === "open" && candidatePr.draft === false, "失败审计 Candidate 必须来自开放且非 draft 的固定 PR #13");
  invariant(candidatePr.head?.repo?.full_name === REPOSITORY && candidatePr.base?.repo?.full_name === REPOSITORY, "失败审计 Candidate 禁止来自 fork");
  invariant(candidatePr.head?.sha === recovery.candidateSha, "失败审计 Candidate SHA 不匹配");
  invariant(candidatePr.head?.ref === policy.candidateBranch, "失败审计 Candidate 分支不匹配");
  invariant(candidatePr.base?.ref === "main" && candidatePr.base?.sha === policy.baseSha, "失败审计 Candidate 基线不匹配");
  invariant(request.candidateTreeSha === recovery.candidateTreeSha, "失败审计 Candidate Tree SHA 不匹配");

  const recoveryPr = request.recoveryPullRequest;
  invariant(recoveryPr?.number === recovery.recoveryPullRequest && recoveryPr.state === "open" && recoveryPr.draft === false, "失败审计恢复证据必须来自开放且非 draft 的固定 PR #14");
  invariant(recoveryPr.head?.repo?.full_name === REPOSITORY && recoveryPr.base?.repo?.full_name === REPOSITORY, "失败审计恢复 PR 禁止来自 fork");
  invariant(recoveryPr.head?.sha === recovery.recoveryHeadSha && recoveryPr.head?.ref === recovery.recoveryBranch, "失败审计恢复 PR head 身份不匹配");
  invariant(recoveryPr.base?.ref === contract.runtime.stateBranch && recoveryPr.base?.sha === recovery.legacyTip, "失败审计恢复 PR 基线不是固定 governance-state tip");

  invariant(typeof request.planRecord === "string" && request.planRecord.trim().length > 0, "失败审计恢复缺少规划记录");
  const plan = request.planRecord.endsWith("\n") ? request.planRecord : request.planRecord + "\n";
  scanGovernanceText(plan, "失败审计恢复规划记录");
  const candidate = requirePrRecord(request.releaseCandidateRecord, "releaseCandidate", recovery.candidateSha);
  invariant(candidate.includes(recovery.candidateTreeSha), "失败审计 Candidate 记录必须包含准确 Tree SHA");
  const audit = requireAuditRecord(request.rcAuditRecord, {
    auditPolicy: contract.auditPolicy,
    fromStage: "RC_AUDIT_PENDING",
    kind: "rcAudit",
    targetStage: recovery.targetStage,
    candidateIdentity: {
      sha: recovery.candidateSha,
      treeSha: recovery.candidateTreeSha,
      pullRequest: recovery.candidatePullRequest,
    },
  });

  const state = {
    schemaVersion: recovery.resultSchemaVersion,
    project: PROJECT,
    repository: REPOSITORY,
    activeVersion: policy.activeVersion,
    stage: recovery.targetStage,
    taskLevel: "L2",
    revision: recovery.resultRevision,
    lastUpdatedBy: { roleNumber: 2, roleName: ROLE_NAMES[2] },
    records: {
      plan: pointerFor(policy.activeVersion, "plan"),
      planAudit: null,
      releaseCandidate: pointerFor(policy.activeVersion, "releaseCandidate"),
      rcAudit: pointerFor(policy.activeVersion, "rcAudit"),
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
    candidateSha: recovery.candidateSha,
    candidateContext: {
      branch: policy.candidateBranch,
      pullRequest: recovery.candidatePullRequest,
      baseSha: policy.baseSha,
      treeSha: recovery.candidateTreeSha,
    },
    releaseTag: null,
    block: null,
    bootstrap: {
      mode: "legacy-failed-audit-recovery",
      completed: true,
      sourceSchemaVersion: 1,
      sourceRevision: recovery.legacyRevision,
      sourceTip: recovery.legacyTip,
      legacyCandidateSha: recovery.legacyCandidateSha,
      candidateSha: recovery.candidateSha,
      candidateBranch: policy.candidateBranch,
      candidateTreeSha: recovery.candidateTreeSha,
      candidatePullRequest: recovery.candidatePullRequest,
      recoveryPullRequest: recovery.recoveryPullRequest,
      recoveryHeadSha: recovery.recoveryHeadSha,
      baseSha: policy.baseSha,
      targetStage: recovery.targetStage,
      auditConclusion: recovery.auditConclusion,
    },
  };
  validateGovernanceState(state, { contract });
  return { state, records: { releaseCandidate: candidate, rcAudit: audit } };
}

const PROPOSAL_PHASES = Object.freeze([
  "bootstrap-recovery-records",
  "bootstrap-recovery-pointer",
  "transition-record",
  "transition-pointer",
]);

export function buildProposalEnvelope(input) {
  const envelope = clone(input);
  const requiredFields = ["contentDigests", "expectedRevision", "expectedTip", "paths", "phase", "source"];
  const actualFields = Object.keys(envelope).toSorted();
  const rawFields = requiredFields.toSorted();
  const canonicalFields = [...requiredFields, "schemaVersion"].toSorted();
  invariant(
    JSON.stringify(actualFields) === JSON.stringify(rawFields)
      || JSON.stringify(actualFields) === JSON.stringify(canonicalFields),
    "治理提案授权信封字段必须与冻结允许列表完全一致",
  );
  invariant(envelope.schemaVersion === undefined || envelope.schemaVersion === 1, "治理提案授权信封 schemaVersion 必须为 1");
  invariant(PROPOSAL_PHASES.includes(envelope.phase), "未知治理提案阶段");
  invariant(SHA40.test(envelope.expectedTip), "治理提案 expectedTip 必须是完整 SHA");
  invariant(Number.isInteger(envelope.expectedRevision) && envelope.expectedRevision >= 0, "治理提案 expectedRevision 必须是非负整数");
  invariant(envelope.source && typeof envelope.source === "object" && !Array.isArray(envelope.source), "治理提案缺少不可变来源身份");
  invariant(Array.isArray(envelope.paths) && envelope.paths.length > 0, "治理提案必须声明至少一个路径");
  const paths = [...new Set(envelope.paths)].toSorted();
  invariant(paths.length === envelope.paths.length, "治理提案路径不得重复");
  for (const path of paths) {
    invariant(typeof path === "string" && /^governance\/runtime\/[A-Za-z0-9._/-]+$/u.test(path), "治理提案只能修改 governance/runtime 下的固定路径");
    invariant(!path.includes("..") && !path.endsWith("/"), "治理提案路径必须规范化");
  }
  invariant(envelope.contentDigests && typeof envelope.contentDigests === "object" && !Array.isArray(envelope.contentDigests), "治理提案缺少内容摘要");
  exact(Object.keys(envelope.contentDigests).toSorted(), paths, "治理提案摘要路径");
  const contentDigests = Object.fromEntries(paths.map((path) => {
    const value = envelope.contentDigests[path];
    invariant(SHA256.test(value), "治理提案内容摘要格式无效");
    return [path, value];
  }));
  return {
    schemaVersion: 1,
    phase: envelope.phase,
    expectedTip: envelope.expectedTip,
    expectedRevision: envelope.expectedRevision,
    source: normalized(envelope.source),
    paths,
    contentDigests,
  };
}

async function readProposalTree(root) {
  const files = new Map();
  async function walk(relativeDirectory) {
    const directory = relativeDirectory ? join(root, ...relativeDirectory.split("/")) : root;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDirectory ? relativeDirectory + "/" + entry.name : entry.name;
      const absolutePath = join(root, ...relativePath.split("/"));
      const stat = await lstat(absolutePath);
      invariant(!stat.isSymbolicLink(), "治理提案不得包含符号链接：" + relativePath);
      if (stat.isDirectory()) {
        await walk(relativePath);
      } else {
        invariant(stat.isFile(), "治理提案只允许普通文件：" + relativePath);
        files.set(relativePath, await readFile(absolutePath));
      }
    }
  }
  await walk("");
  return files;
}

function changedProposalPaths(baseFiles, proposalFiles) {
  const allPaths = new Set([...baseFiles.keys(), ...proposalFiles.keys()]);
  return [...allPaths].filter((path) => {
    const before = baseFiles.get(path);
    const after = proposalFiles.get(path);
    return !before || !after || !before.equals(after);
  }).toSorted();
}

async function verifyExpectedProposalFiles(baseRoot, proposalRoot, envelope, expectedFiles) {
  const expectedPaths = [...expectedFiles.keys()].toSorted();
  exact(envelope.paths, expectedPaths, "治理提案阶段路径");
  const expectedDigests = Object.fromEntries(expectedPaths.map((path) => [path, digest(expectedFiles.get(path))]));
  exact(envelope.contentDigests, expectedDigests, "治理提案授权摘要");
  const [baseFiles, proposalFiles] = await Promise.all([
    readProposalTree(baseRoot),
    readProposalTree(proposalRoot),
  ]);
  exact(changedProposalPaths(baseFiles, proposalFiles), expectedPaths, "治理提案完整变更路径");
  for (const [path, expectedBytes] of expectedFiles) {
    const actualBytes = proposalFiles.get(path);
    invariant(actualBytes?.equals(expectedBytes), "治理提案文件字节不匹配：" + path);
  }
  return expectedPaths;
}

export async function verifyProtectedProposal({
  baseRoot,
  proposalRoot,
  proposalBaseSha,
  envelope: envelopeInput,
  candidatePullRequest,
  recoveryPullRequest,
  contract: contractInput,
}) {
  const contract = validateGovernanceContract(contractInput);
  const envelope = buildProposalEnvelope(envelopeInput);
  exact(envelopeInput, envelope, "治理提案授权信封规范形式");
  invariant(proposalBaseSha === envelope.expectedTip, "治理提案父提交与 expectedTip 不匹配");

  const currentPath = contract.runtime.currentPath;
  const currentFile = join(baseRoot, ...currentPath.split("/"));
  const previous = JSON.parse(await readFile(currentFile, "utf8"));
  invariant(previous.revision === envelope.expectedRevision, "治理提案基线 revision 不匹配");

  if (envelope.source.kind === "governance-transition") {
    const sourcePr = candidatePullRequest;
    exact(envelope.source, {
      kind: "governance-transition",
      authorizationComment: envelope.source.authorizationComment,
      stateTip: envelope.source.stateTip,
      pullRequest: sourcePr?.number,
      headSha: sourcePr?.head?.sha,
      treeSha: sourcePr?.treeSha,
      roleNumber: envelope.source.roleNumber,
      targetStage: envelope.source.targetStage,
    }, "治理转换来源身份");
    invariant(Number.isInteger(envelope.source.authorizationComment) && envelope.source.authorizationComment > 0, "治理转换缺少所有者授权评论身份");
    invariant(SHA40.test(envelope.source.stateTip), "治理转换来源状态 tip 无效");
    invariant(envelope.source.stateTip === sourcePr?.stateTip, "治理转换来源状态 tip 与可信输入不匹配");
    invariant(Number.isInteger(envelope.source.roleNumber), "治理转换角色编号无效");
    invariant(GOVERNANCE_STAGES.includes(envelope.source.targetStage), "治理转换目标阶段无效");
    const transition = buildGovernanceTransition(previous, {
      roleNumber: envelope.source.roleNumber,
      targetStage: envelope.source.targetStage,
      pullRequest: sourcePr,
      treeSha: envelope.source.treeSha,
    }, contract);
    const versionPath = contract.runtime.versionStatePattern.replace("<activeVersion>", transition.state.activeVersion);
    let expectedFiles;
    if (envelope.phase === "transition-record") {
      invariant(transition.recordKey && transition.record, "该治理转换没有独立记录阶段");
      invariant(envelope.expectedTip === envelope.source.stateTip, "转换记录必须直接基于来源状态 tip");
      expectedFiles = new Map([[transition.state.records[transition.recordKey], Buffer.from(transition.record, "utf8")]]);
    } else {
      invariant(envelope.phase === "transition-pointer", "普通治理转换只接受 record 或 pointer 阶段");
      if (transition.recordKey) {
        invariant(envelope.expectedTip !== envelope.source.stateTip, "转换指针不得先于不可变记录入库");
        const recordPath = transition.state.records[transition.recordKey];
        const actualRecord = await readFile(join(baseRoot, ...recordPath.split("/")), "utf8").catch(() => null);
        invariant(actualRecord === transition.record, "转换指针基线缺少已验证的不可变记录");
      } else {
        invariant(envelope.expectedTip === envelope.source.stateTip, "无记录转换不得改变指针提案基线");
      }
      const stateBytes = Buffer.from(JSON.stringify(transition.state, null, 2) + "\n", "utf8");
      expectedFiles = new Map([[currentPath, stateBytes], [versionPath, stateBytes]]);
    }
    const paths = await verifyExpectedProposalFiles(baseRoot, proposalRoot, envelope, expectedFiles);
    return { phase: envelope.phase, paths };
  }

  const policy = contract.bootstrapPolicy;
  const recovery = policy.failedAuditRecovery;
  invariant(envelope.expectedRevision === recovery.legacyRevision, "失败审计恢复 revision 不匹配");
  exact(envelope.source, {
    kind: "bootstrap-failed-audit-recovery",
    authorizationComment: envelope.source.authorizationComment,
    legacyTip: recovery.legacyTip,
    candidatePullRequest: recovery.candidatePullRequest,
    candidateSha: recovery.candidateSha,
    candidateTreeSha: recovery.candidateTreeSha,
    recoveryPullRequest: recovery.recoveryPullRequest,
    recoveryHeadSha: recovery.recoveryHeadSha,
  }, "失败审计恢复来源身份");
  invariant(Number.isInteger(envelope.source.authorizationComment) && envelope.source.authorizationComment > 0, "失败审计恢复缺少所有者授权评论身份");

  const planPath = previous.records?.plan;
  invariant(typeof planPath === "string", "失败审计恢复基线缺少规划记录");
  const planRecord = await readFile(join(baseRoot, ...planPath.split("/")), "utf8");
  const sourceRecords = recoveryPullRequest?.records;
  invariant(typeof sourceRecords?.releaseCandidate === "string" && typeof sourceRecords?.rcAudit === "string", "固定恢复 PR 缺少不可变 Candidate 或审计记录");
  const migration = migrateFailedBootstrapAudit(previous, {
    legacyTip: recovery.legacyTip,
    candidatePullRequest,
    recoveryPullRequest,
    candidateTreeSha: recovery.candidateTreeSha,
    planRecord,
    releaseCandidateRecord: sourceRecords.releaseCandidate,
    rcAuditRecord: sourceRecords.rcAudit,
  }, contract);

  const recordPath = migration.state.records.releaseCandidate;
  const auditPath = migration.state.records.rcAudit;
  const versionPath = contract.runtime.versionStatePattern.replace("<activeVersion>", migration.state.activeVersion);
  let expectedFiles;
  if (envelope.phase === "bootstrap-recovery-records") {
    invariant(envelope.expectedTip === recovery.legacyTip, "恢复记录提案必须直接基于固定旧状态 tip");
    expectedFiles = new Map([
      [recordPath, Buffer.from(migration.records.releaseCandidate, "utf8")],
      [auditPath, Buffer.from(migration.records.rcAudit, "utf8")],
    ]);
  } else {
    invariant(envelope.phase === "bootstrap-recovery-pointer", "失败审计恢复只接受 records 或 pointer 阶段");
    invariant(envelope.expectedTip !== recovery.legacyTip, "恢复指针不得先于不可变记录入库");
    for (const [path, expected] of [
      [recordPath, migration.records.releaseCandidate],
      [auditPath, migration.records.rcAudit],
    ]) {
      const actual = await readFile(join(baseRoot, ...path.split("/")), "utf8").catch(() => null);
      invariant(actual === expected, "恢复指针基线缺少已验证的不可变记录：" + path);
    }
    const stateBytes = Buffer.from(JSON.stringify(migration.state, null, 2) + "\n", "utf8");
    expectedFiles = new Map([[currentPath, stateBytes], [versionPath, stateBytes]]);
  }

  const paths = await verifyExpectedProposalFiles(baseRoot, proposalRoot, envelope, expectedFiles);
  return { phase: envelope.phase, paths };
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

function assertKnownOptions(args, allowed) {
  invariant(args.length % 2 === 0, "命令选项必须成对提供");
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    invariant(allowed.includes(name), "未知参数 " + name);
    invariant(!seen.has(name), "参数不得重复 " + name);
    invariant(args[index + 1] && !args[index + 1].startsWith("--"), "缺少参数 " + name);
    seen.add(name);
  }
}

async function main() {
  const [command, statePath, ...args] = process.argv.slice(2);
  const contractPath = args.includes("--contract") ? option(args, "--contract") : "governance/role-contract.json";
  const contract = validateGovernanceContract(await readJson(contractPath));
  if (command === "validate-static" && statePath) {
    assertKnownOptions(args, ["--contract"]);
    const state = validateGovernanceState(await readJson(statePath), { contract });
    process.stdout.write("治理状态结构有效：" + state.activeVersion + " " + state.stage + " revision=" + state.revision + "\n");
    return;
  }
  if (command === "validate-transition" && statePath) {
    assertKnownOptions(args, ["--contract", "--previous", "--records-root"]);
    const previousPath = option(args, "--previous");
    const root = option(args, "--records-root");
    const previous = await readJson(previousPath);
    const next = validateGovernanceTransition(previous, await readJson(statePath), contract);
    await verifyRecordFiles(next, root);
    process.stdout.write("治理状态转换有效：" + previous.stage + " → " + next.stage + " revision=" + next.revision + "\n");
    return;
  }
  if (command === "verify-remote" && statePath) {
    assertKnownOptions(args, ["--contract"]);
    const evidence = await verifyRemoteCandidate(await readJson(statePath));
    process.stdout.write(JSON.stringify(evidence) + "\n");
    return;
  }
  if (command === "verify-remote-transition" && statePath) {
    assertKnownOptions(args, ["--contract", "--previous"]);
    const evidence = await verifyRemoteCandidateTransition(
      await readJson(option(args, "--previous")),
      await readJson(statePath),
      { contract },
    );
    process.stdout.write(JSON.stringify(evidence) + "\n");
    return;
  }
  if (command === "verify-records" && statePath) {
    assertKnownOptions(args, ["--contract", "--records-root"]);
    const root = option(args, "--records-root");
    await verifyRecordFiles(await readJson(statePath), root);
    process.stdout.write("治理记录摘要与无秘密检查通过\n");
    return;
  }
  if (command === "resolve-placeholders" && statePath) {
    assertKnownOptions(args, ["--contract", "--output", "--candidate-sha", "--tree-sha"]);
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
    assertKnownOptions(args, [
      "--contract", "--role", "--target", "--pr", "--tree-sha", "--output",
      "--record-output", "--meta-output",
    ]);
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
  if (command === "build-bootstrap-recovery" && statePath) {
    assertKnownOptions(args, [
      "--contract", "--legacy-tip", "--candidate-pr", "--recovery-pr", "--tree-sha",
      "--plan-record", "--candidate-record", "--audit-record", "--output",
      "--candidate-output", "--audit-output",
    ]);
    const candidatePr = await readJson(option(args, "--candidate-pr"));
    const recoveryPr = await readJson(option(args, "--recovery-pr"));
    const result = migrateFailedBootstrapAudit(await readJson(statePath), {
      legacyTip: option(args, "--legacy-tip"),
      candidatePullRequest: candidatePr,
      recoveryPullRequest: recoveryPr,
      candidateTreeSha: option(args, "--tree-sha"),
      planRecord: await readFile(option(args, "--plan-record"), "utf8"),
      releaseCandidateRecord: await readFile(option(args, "--candidate-record"), "utf8"),
      rcAuditRecord: await readFile(option(args, "--audit-record"), "utf8"),
    }, contract);
    await writeFile(option(args, "--output"), JSON.stringify(result.state, null, 2) + "\n");
    await writeFile(option(args, "--candidate-output"), result.records.releaseCandidate);
    await writeFile(option(args, "--audit-output"), result.records.rcAudit);
    return;
  }
  if (command === "build-proposal-envelope" && statePath) {
    assertKnownOptions(args, ["--contract", "--output"]);
    const envelope = buildProposalEnvelope(await readJson(statePath));
    await writeFile(option(args, "--output"), JSON.stringify(envelope) + "\n");
    return;
  }
  if (command === "verify-protected-proposal" && statePath) {
    assertKnownOptions(args, [
      "--contract", "--base-root", "--proposal-root", "--proposal-base-sha",
      "--candidate-pr", "--recovery-pr",
    ]);
    const result = await verifyProtectedProposal({
      baseRoot: option(args, "--base-root"),
      proposalRoot: option(args, "--proposal-root"),
      proposalBaseSha: option(args, "--proposal-base-sha"),
      envelope: await readJson(statePath),
      candidatePullRequest: await readJson(option(args, "--candidate-pr")),
      recoveryPullRequest: await readJson(option(args, "--recovery-pr")),
      contract,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  throw new GovernanceValidationError(
    "用法：validate-static；validate-transition；verify-records；verify-remote；verify-remote-transition；build-transition；build-bootstrap-recovery；build-proposal-envelope；verify-protected-proposal",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
}
