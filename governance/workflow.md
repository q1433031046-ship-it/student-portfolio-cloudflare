# 超级中枢 v1.1｜治理工作流

## 正式里程碑回复合同

每个角色在正式里程碑回复中必须完整提供以下字段，字段值只能来自已验证事实：

- 当前角色：
- 当前状态：
- 标准主路径：`1 → 2（方案审计）→ 3 → 2（Candidate 审计）→ 4`
- 当前所在位置：
- 当前预计路径：
- 最低剩余主步骤：
- 下一步：
- 下一角色：
- 推荐思考程度：
- 原因：

角色 2 必须按实际门禁写成 `2（方案审计）` 或 `2（Candidate 审计）`，不能只写编号 2。“当前状态”不得把进行中写成已完成；“当前所在位置”不得越过尚未验证的里程碑。标准主路径始终解释完整产品治理流程，当前预计路径则按本节的动态规则生成。

用户可见思考程度只有 `高`、`极高`、`最高`；客户端真实存在 Ultra 且任务属于极端复杂或不可逆风险时才使用 Ultra。普通实现与固定流程推荐高；规划、审计、治理、数据库、Migration、认证与安全推荐极高；生产异常、回滚、资源身份冲突或不可逆风险推荐最高。

## 动态路径规则

路径推导按以下优先级执行：

1. 明确启用且可信的治理 stage；
2. 当前任务类型；
3. 已经验证完成的里程碑；
4. BLOCKED 的来源阶段和责任角色；
5. 回滚回执和当前恢复责任。

默认人工审核模式下，若 `governance-state` 未被明确重新启用，不得根据旧 `activeVersion` 自动授予实施或发布资格。此时只使用当前任务的准确 GitHub 与审计证据。

| 场景 | 当前预计路径的推导 | 下一角色规则 |
| --- | --- | --- |
| 正常产品发布 | 从第一个未完成里程碑继续：1 → 2（方案审计）→ 3 → 2（Candidate 审计）→ 4 | 取路径中的下一未完成角色 |
| 规划返工 | 1（规划返工）→ 2（方案审计）→ 3 → 2（Candidate 审计）→ 4 | 方案不通过回到 1（超级规划） |
| 实现返工 | 3（实现返工）→ 2（Candidate 审计）→ 4 | Candidate 不通过回到 3（超级工作） |
| BLOCKED | 先由阻断记录中的责任角色解除；解除后重新读取来源阶段并推导路径 | 使用 `block.ownerRoleNumber`；无法可信确定时写“待阻断解除后确认” |
| 回滚 | 3（实现修复）→ 2（Candidate 审计）→ 4 | 回滚后的实现修复由 3（超级工作）接手 |
| 不需要生产发布的治理或文档任务 | 2（方案审计）→ 3（实施）→ 2（Candidate 审计）→ 合入准确治理 Candidate | Candidate 审计通过后由 3（超级工作）只合入准确获批 Candidate |
| 已经结束的流程 | 无后续路径 | 无（流程结束） |

### 不需要生产发布的治理或文档任务

这类任务的当前预计路径必须随已完成里程碑收缩。完整路径为：

2（方案审计）
→ 3（实施）
→ 2（Candidate 审计）
→ 合入准确治理 Candidate

3 完成实施并冻结 Candidate 后，当前预计路径为：

2（Candidate 审计）
→ 合入准确治理 Candidate

Candidate 审计通过后，下一角色是 `3（超级工作）`，下一步是“仅合入角色 2 批准的准确 Candidate，不再修改 Candidate 内容”。合入完成后，下一角色是“无（流程结束）”。

### 最低剩余主步骤

最低剩余主步骤只计算当前所在位置之后尚未完成的主里程碑；当前门已经验证完成时不重复计算，正在进行且尚未完成的里程碑仍计入。例如，方案审计已通过而实施尚未完成时，`3（实施）→ 2（Candidate 审计）→ 合入治理合同` 的最低剩余主步骤为 3；Candidate 已冻结并等待审计时为 2；流程完成时为 0。

BLOCKED 且解除后的真实路径无法可靠判断时，必须显示：`待阻断解除后重新计算`，不得猜数字。

### 下一角色推导

| 可信事实 | 下一角色 |
| --- | --- |
| 规划待审计 | 2（方案审计） |
| 方案不通过 | 1（超级规划） |
| 方案通过 | 3（超级工作） |
| 实现完成 | 2（Candidate 审计） |
| Candidate 不通过 | 3（超级工作） |
| 产品 Candidate 通过且需要生产发布 | 4（超级发布） |
| 纯治理或文档 Candidate 通过 | 3（超级工作），仅合入准确获批 Candidate |
| 回滚后的实现修复 | 3（超级工作） |
| BLOCKED | 已记录的责任角色；无法确定时为“待阻断解除后确认” |
| 流程完成 | 无（流程结束） |

### 一键复制交接

只有确实需要用户把指令发送给下一角色时，才生成单独、完整且自包含的交接词。交接词必须写明下一角色、任务、从 GitHub 读取最新事实、准确审计或 Candidate 身份、允许范围和停止边界；不得依赖“见上文”，不得要求用户搬运仓库已有材料，也不得包含密码、Token、Cookie、恢复码、Secret、二维码访问链接、私人信息或生产资源原始 ID。

客户端支持 Writing Block / 写作块时优先使用 Writing Block；不可用时使用独立代码块。真正需要复制的交接内容不得埋在普通正文中。

每份交接词至少按以下结构生成，并用当前任务的准确事实完整填充：

```text
下一角色：
任务：
开始前从 GitHub 读取：
准确任务、审计或 Candidate 身份：
允许范围：
停止边界：
完成后必须返回：
```

### 风险显示边界

正式审计回复必须显示 `阻断风险`、`已接受风险`、`已知问题`、`是否阻断`，只陈述当前已有审计结果。影响正确性、生产、数据、安全、Candidate 身份或可逆性的风险必须阻断；已经隔离的中低风险可以记录并接受。不得由此引入风险数据库、自动风险评分、Known Issue 平台、监控系统、新治理状态或新状态机分支。

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

进入 `IMPLEMENTING` 后，上一轮被驳回的 Candidate 身份只作为历史证据保留。可信 writer 必须继续核验该 commit 与 Tree 对象，但不得要求旧分支 tip、旧 PR head 或旧 `main` Base 仍保持活动绑定；实现分支正是在这个阶段允许前进。`IMPLEMENTING → RC_AUDIT_PENDING` 必须重新绑定新 Candidate，并恢复 commit、Tree、分支 tip、开放非 draft 同仓 PR、准确 Base 与祖先关系的完整远端核验。由 `IMPLEMENTING` 进入 `BLOCKED` 时沿用历史对象核验，使角色 3 在分支已移动后仍能失败关闭；这项例外不能授予任何审计或发布资格。

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

角色收到交接词后自动读取 main 合同与当前任务必需的 GitHub 记录及摘要。动态治理状态明确启用时再读取受保护状态。Candidate 阶段还要核对远端 commit/tree、分支 tip、开放 PR、main 基线和祖先关系。错误角色接手时指出应由哪个编号继续，不猜测，也不要求用户搬运已有交接文件。

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
