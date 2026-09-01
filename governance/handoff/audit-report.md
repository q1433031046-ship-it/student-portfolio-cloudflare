# 审计交接记录

记录 ID：

生成角色编号：2

生成角色名称：超级审计

生成时间（UTC）：

审计编号：

审计类型：方案审计 / 候选版本审计

版本：

审计对象规划编号（方案审计适用）：

审计对象 Candidate SHA（候选版本审计必填）：

审计对象 Tree SHA（候选版本审计必填）：

审计对象 PR（候选版本审计必填）：

审计范围：

阻断问题：

高风险问题：

中风险问题：

低风险问题：

测试与证据：

剩余风险：

最终结论：通过 / 不通过

批准 Candidate SHA（候选审计适用）：

目标状态：

下一角色：

下一句话：

## 正式结论约束

- 方案审计“通过”只能进入 `IMPLEMENTATION_APPROVED`，“不通过”只能进入 `PLANNING_REQUIRED`。
- 候选版本审计“通过”只能进入 `RELEASE_APPROVED`，“不通过”只能进入 `IMPLEMENTATION_REQUIRED`。
- 候选版本审计必须逐字段填写并准确匹配 current 中的 Candidate SHA、Tree SHA 和 PR；“通过”时批准 Candidate SHA 也必须是同一 SHA。
- 需要补充条件或暂时阻断时使用阻断记录与 `BLOCKED` 流程，不能把非终局意见写成正式通过结论。
