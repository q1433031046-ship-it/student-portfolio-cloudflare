# 四角色治理工作流

## 状态与接手角色

| 状态 | 接手角色 | 必需证据 |
| --- | --- | --- |
| IDLE / PLANNING / PLANNING_REQUIRED | 1 | 规划链 |
| PLAN_AUDIT_PENDING | 2 | plan |
| IMPLEMENTATION_APPROVED / IMPLEMENTING / IMPLEMENTATION_REQUIRED | 3 | plan + planAudit；退回时加 rcAudit |
| RC_AUDIT_PENDING | 2 | plan + planAudit + releaseCandidate |
| RELEASE_APPROVED / PRODUCTION_PREFLIGHT / RELEASING | 4 | 完整双审计链与固定 Candidate |
| PRODUCTION_VERIFIED | 4 | releaseReceipt |
| ROLLED_BACK | 3 | releaseReceipt 与完整审计链 |
| BLOCKED | block.ownerRoleNumber | 来源阶段证据 + blocked |

首次 governance-1 bootstrap 可缺少不存在的 planAudit，但必须绑定固定分支、基线和远端 Candidate；该例外不能用于其他版本。

## 标准转换

1. 角色 1：IDLE/PLANNING_REQUIRED → PLANNING → PLAN_AUDIT_PENDING。
2. 角色 2：PLAN_AUDIT_PENDING → IMPLEMENTATION_APPROVED/PLANNING_REQUIRED/BLOCKED。
3. 角色 3：IMPLEMENTATION_APPROVED/IMPLEMENTATION_REQUIRED → IMPLEMENTING → RC_AUDIT_PENDING/BLOCKED。
4. 角色 2：RC_AUDIT_PENDING → RELEASE_APPROVED/IMPLEMENTATION_REQUIRED/BLOCKED。
5. 角色 4：RELEASE_APPROVED → PRODUCTION_PREFLIGHT → RELEASING → PRODUCTION_VERIFIED/ROLLED_BACK/BLOCKED。
6. ROLLED_BACK → IMPLEMENTATION_REQUIRED 只能由角色 3 接手。

同阶段 revision 更新一律禁止。每条转换都有独立字段允许列表；进入 RELEASE_APPROVED 后，activeVersion、candidateSha、Candidate 上下文、releaseCandidate 和 rcAudit 全部冻结。

## BLOCKED 恢复

进入 BLOCKED 时必须保存 sourceStage、责任角色和 07-blocked.md。只有记录的责任角色能恢复，而且只能回到来源对应的最小安全阶段：

- 规划来源 → PLANNING
- 方案审计来源 → PLAN_AUDIT_PENDING
- 实现来源 → IMPLEMENTING
- 候选审计来源 → RC_AUDIT_PENDING
- 发布批准/预检来源 → PRODUCTION_PREFLIGHT
- 发布中来源 → RELEASING

正常恢复和越权恢复都由测试覆盖。

## 新对话自动恢复

角色收到短句后自动读取 main 合同、受保护状态、必需记录及摘要。Candidate 阶段还要核对远端 commit/tree、分支 tip、开放 PR、main 基线和祖先关系。错误角色接手时指出应由哪个编号继续，不猜测，也不要求用户搬运已有交接文件。

## 受保护的两阶段 PR 协议

1. 所有者在同仓库开放 PR 上提交精确 governance-transition 指令，携带刚读取的 tip、revision、角色和目标阶段。
2. 默认分支上的可信工作流解析指令；PR 内容始终按未信任输入处理。
3. 工作流读取 governance-state 并严格比对 expected tip/revision。
4. 运行 Draft 2020-12 Schema、角色允许列表、转换字段差异、完整审计链、固定记录路径、摘要和无秘密/泄密检查。
5. 对 Candidate 回读 GitHub commit、tree、branch、PR、base 与 ancestry。
6. 从准确 previous tip 创建记录提交和短期提案分支，打开第一个目标为 governance-state 的 PR；写入固定 `governance-state-write` 状态，重读目标 tip 后才允许受保护合并，以此执行 compare-and-swap（CAS）。
7. 从第一个 PR 的准确合并 tip 创建 current 与版本快照提交，再以相同状态门禁和最新分支要求合并第二个 PR。
8. 任一步 tip 竞争、状态门禁或验证失败立即停止；已合并记录不改变 current，后续恢复从仓库事实继续。

普通用户、管理员和插件不得直接更新 governance-state。规则集绕过名单为空，并要求 PR、固定状态、目标分支最新、禁止删除和禁止强制推送。

## Cloudflare 隔离

治理写入启用前必须关闭 governance-state 的 Workers Builds，或用分支/Build watch paths 排除治理运行时路径。即使远端分支构建被误开，`scripts/build-verified.sh` 也必须根据 Cloudflare 官方 `WORKERS_CI` 与 `WORKERS_CI_BRANCH` 在任何构建、`wrangler versions upload` 和 Worker Version 创建之前失败关闭。必须以一次真实治理分支提交证明 Cloudflare 检查停在该门禁，没有 Worker Version 或预览别名；仅仅“不切生产流量”不算关闭此项。

治理工作流不得包含 Wrangler、Cloudflare 部署、标签创建或生产资源权限。

## 校验命令

结构与 Schema 使用 npm run governance:validate。

正式转换必须执行 validate-transition，并同时提供 previous、完整 records-root 和 role-contract。previous 不能省略，同阶段写入不允许。
