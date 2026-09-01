# 治理风险接受与故障隔离设计（2026-09-01）

## 结论

本轮在 PR #13 的最终 Candidate 冻结前增加一个最小、机器可验证的风险接受规则：候选审计不要求清零所有已知缺陷，但只有未触及治理信任根、Candidate 身份、CAS、受保护状态、生产、数据、安全或不可逆边界的 Medium / Low 风险，才能在完整记录隔离、停止条件和后续版本后被接受。

正式审计状态机保持不变。正式结论仍且只能是“通过”或“不通过”，对应目标状态仍严格使用现有 `auditPolicy.conclusionTargets`。本设计不增加“有条件通过”或其他模糊终局，不修改产品代码、状态 Schema、Writer、Ruleset、Cloudflare 配置或生产资源。

## 背景与目标

当前治理已经强制绑定审计结论、目标状态、Candidate SHA、Tree SHA、PR、受保护写入检查和两阶段 CAS。缺少的是一套明确、可执行的剩余风险处置规则。没有该规则时，审计者可能把一个已隔离的低风险问题错误地当成发布阻断，也可能反向把信任根问题写成普通 Known Issue。

本设计的目标是：

1. 明确区分必须修复和允许延期的风险。
2. 允许完整隔离的 Medium / Low 风险随合法 Candidate 进入正式“通过”。
3. 永久禁止任何信任根、身份、CAS、受保护状态、生产、数据、安全或不可逆错误被风险接受。
4. 让 builder 与独立 Gate 对同一份机器合同执行相同判断。
5. 保持正式状态机和角色权限语义不变。

## 非目标

- 不创建新的产品功能、监控平台、告警系统或运行时服务。
- 不修改应用代码、数据库、Migration、Worker、D1、MEDIA_KV 或 Secrets。
- 不修改 `governance-state` 的 JSON Schema 或新增治理状态。
- 不修改 protected writer、Ruleset、required-check 集成、Cloudflare 构建门禁或部署流程。
- 不允许角色 3 自行批准风险；风险处置属于角色 2 的正式审计记录。
- 不把“有条件通过”引入正式结论。

## 机器合同

在 `governance/role-contract.json#auditPolicy` 中增加严格、逐字匹配的 `riskAcceptancePolicy`。`scripts/governance-state.mjs` 中的可信常量保存同一策略，静态合同验证继续对完整 `auditPolicy` 做 exact allowlist 检查。

### 风险分类

允许且仅允许以下分类：

1. `Blocking Risk`
2. `Accepted / Contained Risk`
3. `Monitored Technical Debt`
4. `Low / Won't Fix Now`

`Blocking Risk` 不能与正式“通过”结论共存。其余三类只有在全部 Known Issue 字段完整、severity 合法且 `Non-Waivable Boundary` 为 `none` 时，才具备通过资格。

### Severity 规则

- `Accepted / Contained Risk`：只允许 `Medium` 或 `Low`。
- `Monitored Technical Debt`：只允许 `Medium` 或 `Low`。
- `Low / Won't Fix Now`：只允许 `Low`。
- `Blocking Risk`：可记录 `Critical`、`High`、`Medium` 或 `Low`，但正式结论必须为“不通过”。
- `Critical` 或 `High` 永远不能通过改写分类进入 Accepted Known Issue。

### 允许的 containment mechanism

`Containment` 字段必须以以下固定机制之一开头，后接具体隔离说明：

- `isolation`
- `fail-closed`
- `feature-disabled`
- `manual-recovery`
- `known-issue`
- `follow-up-version`

固定格式为 `<mechanism> | <具体措施>`。机制或具体措施任一为空都无效。

### 风险项字段与 Accepted Known Issue 完整性

每个风险项都使用一个独立的固定 Markdown 字段块，并准确包含一次以下字段；这保证 builder 和 Gate 只需要一套解析规则。被接受的 Known Issue 至少必须满足这套完整字段要求，`Blocking Risk` 也使用同一字段形状，其 containment 通常记录为 fail-closed、功能关闭或退回修复：

1. `Known Issue ID`
2. `风险分类`
3. `Issue`
4. `Severity`
5. `Impact / Blast Radius`
6. `Containment`
7. `Stop / Escalation Condition`
8. `Planned Follow-up Version`
9. `Non-Waivable Boundary`

`Known Issue ID` 在同一审计记录内必须唯一。所有值必须为非空的单行值，不接受 `TBD`、`TODO`、`unknown`、`待定` 或等价占位符。`Planned Follow-up Version` 必须是明确的 `v<major>.<minor>.<patch>` 或 `governance-<positive integer>`。

审计记录使用以下形状：

```markdown
## 风险处置

风险项数量：1

### Known Issue：RISK-001

风险分类：Accepted / Contained Risk
Issue：低频诊断输出缺少一个非关键上下文字段
Severity：Low
Impact / Blast Radius：仅影响人工排障速度，不改变治理判断或生产行为
Containment：known-issue | 在审计记录中保留，并由人工使用现有日志完成恢复
Stop / Escalation Condition：若影响 Candidate 身份判断、状态写入或生产证据，立即升级为 Blocking Risk
Planned Follow-up Version：governance-2
Non-Waivable Boundary：none
```

没有风险项时必须准确写 `风险项数量：0`，且不得附带 Known Issue 块。数量与实际块数不一致时验证失败。

### 不可豁免边界

机器合同固定以下九个稳定 ID；列表减少、增加、重命名、重排或描述改变都使静态合同验证失败：

| Boundary ID | 永远不得接受的问题 |
| --- | --- |
| `governance-state-authorization` | `governance-state` 可越权修改 |
| `ruleset-required-check-integrity` | Ruleset 或 required check 可绕过、伪造或由错误集成满足 |
| `candidate-identity-binding` | Candidate SHA、Tree、PR 或审计目标无法唯一绑定 |
| `cas-revision-stale-write-protection` | CAS 或 revision 无法阻止陈旧覆盖 |
| `failed-audit-forward-progress` | 审计失败后仍可非法前进 |
| `trusted-writer-boundary` | trusted writer 或独立 Gate 的信任边界失效 |
| `write-outcome-integrity` | 写入失败、未合并或未读回却报告成功 |
| `release-candidate-eligibility` | 错误 Candidate 获得发布资格 |
| `production-data-security-irreversibility` | 可能造成生产、数据、安全或不可逆治理错误 |

Accepted Known Issue 的 `Non-Waivable Boundary` 必须准确为 `none`。`Blocking Risk` 可以填写合同中的准确 boundary ID；任何非 `none` 值都说明它触及不可豁免边界，验证器必须拒绝“通过”。未知 boundary ID 也必须失败，而不是被当成普通文字忽略。

角色 2 必须对每个问题显式执行 boundary assessment。把真实 blocker 虚假填写为 `none` 属于无效审计，不改变合同中“不可豁免”的语义；审计角色规则明确要求按问题事实选择准确 boundary ID。

## 验证数据流

1. 角色 2 在审计 PR 正文中使用正式审计模板填写结论、目标状态、Candidate 身份和风险处置。
2. `buildGovernanceTransition` 继续先验证角色和状态转换，再调用审计记录验证。
3. 审计记录验证器解析且只解析固定的风险处置字段，不从自由文本推断授权。
4. 验证器比较 `riskAcceptancePolicy` 与可信常量，检查风险项数量、唯一 ID、分类、severity、containment、停止条件、后续版本和 boundary。
5. 任一 Blocking Risk、Critical/High accepted item、缺失字段、占位符、未知分类、未知 boundary 或非 `none` boundary 都阻止正式“通过”。
6. 一个完整、隔离、boundary=`none` 的 Medium / Low Known Issue 不改变结论到目标状态的既有映射，也不阻止合法 Candidate。
7. 独立 Gate 从 `main` 使用相同验证器重建记录和指针提案；提案树不能改变该策略。

## 失败行为

- 风险记录无效时，builder 和 Gate 都失败关闭，不生成可满足 Ruleset 的成功 Check。
- 已经写入的 record-first 记录不自动推进 current；后续仍按现有两阶段恢复规则处理。
- 错误消息只指出字段、分类或 boundary ID，不回显敏感内容。
- 风险接受验证失败不会创建新状态，也不会自动改成 `BLOCKED`；正式状态仍由现有角色转换和审计结论决定。

## 文件边界

计划修改：

- `governance/role-contract.json`：增加严格风险接受机器策略。
- `governance/workflow.md`：说明风险处置与正式状态机关系。
- `governance/README.md`：把风险接受加入治理入口和 Gate 说明。
- `governance/roles/super-audit.md`：固定角色 2 的分类、boundary assessment 和不可豁免责任。
- `governance/roles/super-work.md`：要求角色 3 在 Candidate 中完整披露 Known Issue，但不得自行批准。
- `governance/handoff/audit-report.md`：增加固定风险处置字段块。
- `governance/handoff/release-candidate.md`：把 Known Issue 披露和最终风险接受职责分开。
- `scripts/governance-state.mjs`：解析并验证风险处置。
- `tests/governance-contract.test.mjs`：增加 builder、独立 Gate、合同防漂移和状态机兼容测试。
- 本设计文档：记录本轮已批准的最小治理增强。

明确不修改：

- `app/`、`db/`、`drizzle/`、产品静态资源和产品测试。
- `.github/workflows/governance-state.yml`、`scripts/governance-protected-write.sh`、`scripts/build-verified.sh`。
- `governance/state-schema.json` 和动态 `governance-state` 内容，直到最终 Candidate 通过现有受保护入口交接。
- Cloudflare、Release Tag 和生产资源。

## 自动测试设计

### 正向测试

1. builder 接受一个字段完整、`Severity=Low`、合法 containment、明确停止条件、明确后续版本且 boundary=`none` 的 Known Issue，并保持合法 RC Candidate 进入 `RELEASE_APPROVED`。
2. 独立 Gate 对同一合法记录重建成功，证明 Accepted Low Risk 不会错误阻断 Candidate。
3. `风险项数量：0` 的合法审计保持现有行为。

### 反向测试

1. trust-root、Candidate identity、CAS 或 protected-state boundary 即使标成 `Accepted / Contained Risk` 也必须失败。
2. 对九个不可豁免 boundary 逐一构造 Accepted Risk，全部必须失败。
3. 从合同中逐一删除九个 boundary，`validateGovernanceContract` 全部必须失败。
4. `Critical`、`High`、缺字段、重复 ID、数量不符、非法 containment、占位后续版本、未知分类或未知 boundary 全部失败。
5. `Blocking Risk + 最终结论：通过` 必须失败。
6. “有条件通过”继续失败；风险接受不能形成第三种正式结论。
7. 现有错误 Candidate SHA、Tree、PR、结论与目标状态、CAS 和 protected writer 反向测试全部保留。

## Candidate 与分支策略

PR #13 当前 Candidate `e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b` 已被角色 2 判定不通过，不能继续作为最终 Candidate。实施阶段先把已经通过独立审计并进入 `main@c2101f7f4ca62fe4e1fdd477c7f1370a5f636605` 的 trust root 整合回 PR #13 分支，再在同一分支上增加本设计的治理增强。

最终只生成一个新的 PR #13 Head SHA 和 Tree SHA，重新运行全部要求的验证，更新 Candidate 交接记录，并通过现有受保护写入把状态从 `IMPLEMENTATION_REQUIRED` 经合法角色 3 流程推进到 `RC_AUDIT_PENDING`。随后停止，由角色 2 对完整新 Candidate 从头审计；不继承旧 Candidate 的通过资格。

## 验收标准

1. 四类风险、accepted severity、containment、Known Issue 字段和九个不可豁免 boundary 均存在于严格机器合同。
2. 一个隔离的 Low Risk 不阻断合法 Candidate。
3. 任一不可豁免 boundary 无法通过 Accepted 标记获得资格。
4. 删除任一 boundary 会使治理合同测试失败。
5. 正式结论和目标状态映射与当前合同逐字一致。
6. 产品路径、state schema、Writer、Ruleset、Cloudflare 和生产资源没有变化。
7. 完整验证通过后生成唯一的新 Candidate SHA / Tree，并停在角色 2 从头审计前。
