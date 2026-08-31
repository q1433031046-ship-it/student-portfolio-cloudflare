# 学生作品展示｜四角色治理入口

本目录是项目的正式治理合同。它把职责、阶段、交接和恢复规则放进 GitHub，而不是依赖某一次聊天记录。仓库中的最新有效合同与协调状态优先于本地 Word 和旧聊天记忆。

## 永久角色代号

| 代号 | 正式名称 | 核心职责 | 常见下一角色 |
| --- | --- | --- | --- |
| 1 | 超级规划 | 把需求变成可审计、可执行的冻结方案 | 2 |
| 2 | 超级审计 | 审计方案或候选版本，拥有否决权 | 3、4 或退回 |
| 3 | 超级工作 | 按冻结方案实现、验证并生成准确 Candidate | 2 |
| 4 | 超级发布 | 只发布角色 2 批准的准确 Candidate | 结束或退回 3 |

角色编号不可重排、复用或改名。完整机器权限见 [`role-contract.json`](./role-contract.json)，流程见 [`workflow.md`](./workflow.md)。

## 正式任务的读取顺序

1. 通过 GitHub 官方连接做一次无害只读检查；连接有效就复用。
2. 从 `main` 读取本文件、`workflow.md`、`role-contract.json` 与本角色的 `roles/*.md`。
3. 从 `governance-state` 分支读取 `governance/runtime/current.json`。
4. 根据 `activeVersion`、`stage` 和 `records` 自动读取前置交接记录。
5. 核对版本、审计结论和 Candidate SHA；阶段不合法就停止。
6. 继续本角色工作，不询问用户“上次做到哪了”，也不要求用户搬运仓库中已有的 Word、Markdown 或截图。

新对话可以只收到“你是 1/2/3/4，接手学生作品展示项目”这一句。只要协调状态完整，角色必须按上述顺序自动恢复。

## 静态合同与动态状态

- `main/governance/`：稳定合同、模板、示例和验证规则。
- `governance-state/governance/runtime/current.json`：唯一当前事实指针。
- `governance-state/governance/runtime/versions/<version>.json`：对应版本快照。
- `governance-state/governance/runtime/records/<version>/`：规划、审计、Candidate 与发布回执。

`governance-state` 不是产品来源，不合并到生产分支，也不创建 Release Tag。现有 GitHub Actions 的 push 触发器仅监听 `main`，因此状态分支更新不会启动现有生产发布流程。

## 写入与并发规则

- 每次写入前重新读取分支最新提交、`stage` 和 `revision`。
- 先提交交接记录，再在同一状态提交中更新 `current.json` 与版本快照。
- 新状态 `revision` 必须严格等于旧状态 `revision + 1`。
- 更新分支引用时必须以刚读取的分支 tip 为父提交；tip 已变化就放弃旧写入并重新加载。
- 只有记录与 current 都成功入库后，角色才可以宣布正式阶段完成。
- 写入失败时如实报告“交接无法入库”，不得伪称完成。

## 公开仓库安全边界

动态记录不得包含管理员凭据、恢复材料、初始化口令、访问令牌、浏览器状态、二维码或访问链接、私人联系方式、学生私人内容或生产资源原始 ID。生产资源只记录“已核对 / 匹配 / 不匹配”等结论。`scripts/governance-state.mjs` 会拒绝禁止字段与越权状态。

## 模板和下一句话

关键里程碑使用 [`handoff/`](./handoff/) 下的正式模板。完成后同时告诉用户下一角色编号和最短指令：

- 1 完成规划：对 2 说“规划已经OK了，去检查。”
- 2 方案审计通过：对 3 说“审计通过了，开始做。”
- 3 生成 Candidate：对 2 说“候选做好了，去检查。”
- 2 候选审计通过：对 4 说“审计通过了，发布。”

正常讨论可以自然回答；只有正式状态、交接、进度与阻断必须模板化。

## 初次启用说明

治理合同尚未进入 `main` 之前，本治理 Candidate 本身属于一次性 bootstrap：协调状态可以指向 Candidate 与冻结任务记录，但不得伪造不存在的方案审计。Candidate 通过角色 2 审计并合并后，所有产品版本一律按正常状态机执行，不再允许 bootstrap 例外。
