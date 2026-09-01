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

固定失败审计恢复完成后，governance-1 可凭不可变完成回执保留历史上不存在的 planAudit；回执绑定旧状态 tip/revision、PR #13 commit/tree 和 PR #14 head。该例外不能用于其他版本，也不能再次执行迁移。

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

1. 所有者在同仓库开放 PR 上提交精确 governance-transition 指令，携带刚读取的 tip、revision、角色和目标阶段；授权信封绑定这条评论的 GitHub ID。
2. 评论编排器从 `main` 读取可信代码，只生成 record 或 pointer 提案；PR 正文、分支和文件始终按未信任输入处理。
3. 提案 PR 建立后，Writer 用本来就需要的 `contents: write` 发出固定 `repository_dispatch` 事件，并把准确 PR 编号交给独立 Gate；它没有 `checks: write`。同一 Gate 也接受自然发生的 `pull_request_target` 事件作为补充入口。
4. Gate 先从 GitHub 读取开放、同仓库、bot 创建的准确 PR head，并通过 Checks API 在该 head SHA 上创建进行中的 `governance-state-write` Check；第二次读取 PR 时必须仍为同一 head，避免检查与验证对象发生竞态。
5. Gate 重新读取授权评论，核对所有者、命令全文和来源 PR；它只执行 `main` 的验证器，不执行提案树代码，并重建 Draft 2020-12 Schema、角色允许列表、字段差异、完整审计链、固定记录路径、摘要、无秘密检查和 Candidate 身份的唯一预期结果。正式审计还必须按机器合同绑定结论与目标状态；候选审计逐字段匹配 current 中的 Candidate SHA、Tree SHA 和 PR。Gate 最后比较完整路径集与逐字节内容。
6. Gate 无论成功或失败都完成同一 Check；只有成功结论且名称、head SHA、App id `15368`、App slug、完成状态全部匹配时才可继续。Writer 只能轮询，不能创建或完成该 Check。
7. Writer 再次读取 PR head 与目标 tip，使用准确 head SHA 和 `merge` 方法合并，并验证返回 tip 是以旧 tip 和提案 head 为双亲的合并提交，以此完成 compare-and-swap（CAS）。
8. 记录阶段完成后，从其准确合并 tip 创建 current 与版本快照提案；Gate 验证记录已经逐字节入库后才允许第二阶段。
9. 任一步评论、身份、tip、Check、路径或字节验证失败立即停止；已合并记录不改变 current，后续恢复从仓库事实继续。

普通用户、管理员和插件不得直接更新 governance-state。规则集绕过名单为空，并要求 PR、固定状态、目标分支最新、禁止删除和禁止强制推送。

## Cloudflare 隔离

治理写入启用前必须关闭非生产治理分支的 Workers Builds，或用分支/Build watch paths 排除治理运行时路径。即使远端构建被误开，`scripts/build-verified.sh` 也必须根据 Cloudflare 官方 `WORKERS_CI`、`WORKERS_CI_BRANCH` 和提交身份，对 `governance-state`、`governance/*`、`governance-write/*`，以及 `main` 上修改 trust-root workflow 且完整路径允许列表验证通过的双亲合并，在任何构建和 Worker Version 创建之前以状态 78 失败关闭。此判断不依赖 GitHub 的 merge title 设置；`Governance trust root:` 标记是额外信号。形状、父提交或路径无法证明，或混入产品路径时，必须失败关闭并报告 trust-root path mismatch。

验收必须分别保存 trust-root 合并与两次真实治理写入前后的 Workers Builds、Worker Versions、deployments、active version、preview aliases、GitHub Cloudflare Check 和部署评论快照。通过条件是零新增 Worker Version、零预览、生产活动版本不变且治理工作流没有 Wrangler；“没有 Build 记录”和“有一条在构建前失败关闭的 Build 记录”必须分别陈述。

治理工作流不得包含 Wrangler、Cloudflare 部署、标签创建或生产资源权限。

## 校验命令

结构与 Schema 使用 npm run governance:validate。

正式转换必须执行 validate-transition，并同时提供 previous、完整 records-root 和 role-contract。previous 不能省略，同阶段写入不允许。
