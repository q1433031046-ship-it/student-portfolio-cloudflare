# 四角色治理工作流

## 状态与责任角色

| 状态 | 含义 | 主要角色 |
| --- | --- | --- |
| `IDLE` | 当前无活跃正式版本流程 | 任意 |
| `PLANNING` | 正在规划 | 1 |
| `PLAN_AUDIT_PENDING` | 规划已入库，等待方案审计 | 2 |
| `IMPLEMENTATION_APPROVED` | 方案审计通过，允许实现 | 3 |
| `IMPLEMENTING` | 正在实现 | 3 |
| `RC_AUDIT_PENDING` | Candidate 已入库，等待候选审计 | 2 |
| `RELEASE_APPROVED` | 候选审计通过，允许生产预检 | 4 |
| `PRODUCTION_PREFLIGHT` | 正在生产预检 | 4 |
| `RELEASING` | 正在正式发布 | 4 |
| `PRODUCTION_VERIFIED` | 生产验证通过，版本关闭 | 4 |
| `IMPLEMENTATION_REQUIRED` | 候选审计退回实现 | 3 |
| `PLANNING_REQUIRED` | 方案审计退回规划 | 1 |
| `BLOCKED` | 存在阻断 | 按阻断来源 |
| `ROLLED_BACK` | 发布已回滚并冻结 | 4 / 3 |

完整允许转换以 `role-contract.json` 为准。角色 3 不得直接跳到角色 4；必须同时存在方案审计与候选版本审计。角色 4 的第一步只能从 `RELEASE_APPROVED` 进入 `PRODUCTION_PREFLIGHT`。

## 标准流程

1. 角色 1：`IDLE/PLANNING_REQUIRED → PLANNING → PLAN_AUDIT_PENDING`。
2. 角色 2：方案审计后进入 `IMPLEMENTATION_APPROVED`、`PLANNING_REQUIRED` 或 `BLOCKED`。
3. 角色 3：`IMPLEMENTATION_APPROVED/IMPLEMENTATION_REQUIRED → IMPLEMENTING → RC_AUDIT_PENDING`。
4. 角色 2：候选审计后进入 `RELEASE_APPROVED`、`IMPLEMENTATION_REQUIRED` 或 `BLOCKED`。
5. 角色 4：`RELEASE_APPROVED → PRODUCTION_PREFLIGHT → RELEASING → PRODUCTION_VERIFIED/ROLLED_BACK/BLOCKED`。

## 新对话自动恢复

角色收到“角色编号 + 接手”后必须：

1. 自动读取 `main` 的治理入口、工作流、机器合同和本角色合同。
2. 自动读取 `governance-state` 的 current 状态。
3. 按 records 指针加载本阶段需要的交接记录。
4. 核对 Candidate SHA、版本与审计结论（如适用）。
5. 使用进度模板说明恢复阶段并立即继续。

如果 current 是 `PLANNING` 而用户要求角色 2 审计，角色 2 必须指出“角色 1 尚未写入 PLAN_AUDIT_PENDING，请让 1 完成交接入库”。它不能猜测，也不能要求用户搬运上一角色的长文。

## 一句话交接场景

| 用户只说 | 当前合法状态 | 角色自动读取 | 结果 |
| --- | --- | --- | --- |
| 对 2：“规划已经OK了，去检查。” | `PLAN_AUDIT_PENDING` | plan | 执行方案审计 |
| 对 3：“审计通过了，开始做。” | `IMPLEMENTATION_APPROVED` | plan + planAudit | 确认冻结范围并实现 |
| 对 2：“候选做好了，去检查。” | `RC_AUDIT_PENDING` | plan、planAudit、releaseCandidate | 自动识别候选审计并锁定 SHA |
| 对 4：“审计通过了，发布。” | `RELEASE_APPROVED` | releaseCandidate + rcAudit | 只预检并发布批准 SHA |

## 动态协调分支写入协议

1. 读取 `refs/heads/governance-state` 的最新 tip、current 与目标版本快照。
2. 运行状态校验；确认当前角色允许读取该 stage。
3. 生成无秘密的交接记录，先以最新 tip 为父提交写入 records 路径。
4. 重新读取分支 tip 与 current；发现 stage/revision 已变化就停止并重新加载。
5. 生成 `revision + 1` 的新 current，并在一个提交中同步 current 与版本快照。
6. 以重新读取的 tip 做 compare-and-swap 更新；失败就丢弃旧状态更新并重试读取。
7. 再次读取并验证记录、current、版本快照和分支 tip，成功后才宣布交接完成。

孤立但未被 current 引用的记录不会改变正式阶段，可以由后续治理维护安全清理；不得为了清理而覆盖并发写入。

## 协调通道不会发布生产

- 动态分支固定为 `governance-state`，生产分支固定为 `main`。
- 状态分支不创建发布标签、不合并产品代码、不调用 Wrangler 或 Cloudflare。
- 仓库现有 Actions 的 push 仅匹配 `main`；状态分支 push 不运行现有验证/标记发布工作流。
- 如果未来 CI 或 Cloudflare 配置改变并使该分支可能触发生产，角色必须进入 `BLOCKED`，先修复隔离再写状态。

## 校验命令

```bash
node scripts/governance-state.mjs validate governance/runtime-example/current.json
```

传入 `--previous <old.json>` 时会检查 revision 严格 +1，并按 `role-contract.json` 验证阶段转换。
