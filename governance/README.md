# 学生作品展示｜四角色治理入口

本目录是项目的正式治理合同。长期事实写进 GitHub，旧聊天和本地文档不能覆盖仓库中已经验证的合同与状态。

## 永久角色

| 编号 | 正式名称 | 核心职责 |
| --- | --- | --- |
| 1 | 超级规划 | 形成可审计的冻结方案 |
| 2 | 超级审计 | 独立审计方案与 Candidate，拥有否决权 |
| 3 | 超级工作 | 按冻结方案实现并生成 Candidate |
| 4 | 超级发布 | 只发布角色 2 批准的准确 Candidate |

编号、名称、权限、可读阶段和转换均由 role-contract.json 的严格允许列表固定，任何新增、删除或改写都会失败。

## 新对话读取顺序

1. 从 main 读取本文件、workflow.md、role-contract.json 和对应 roles 文件。
2. 从受保护的 governance-state 分支读取 governance/runtime/current.json。
3. 核对 activeVersion、stage、revision、记录路径与 SHA-256。
4. 自动读取当前阶段所需记录，并核对 Candidate 的 commit、tree、分支、PR 和基线。
5. 阶段与角色不匹配时失败关闭，不要求用户搬运仓库已有文件。

## 静态合同与动态事实

- main/governance：角色、状态机、Schema、模板和验证器。
- governance-state/governance/runtime/current.json：唯一当前事实指针。
- governance-state/governance/runtime/versions/activeVersion.json：同 revision 的版本快照。
- governance-state/governance/runtime/records/activeVersion：固定类型的规划、审计、Candidate、发布与阻断记录。

每个记录路径必须绑定当前版本和固定文件名，状态同时保存记录 SHA-256。跨版本指针、错类型文件或摘要不一致全部拒绝。

## 风险接受与故障隔离

治理与 Candidate 审计判断剩余风险是否仍处于可信、可隔离、可恢复的边界内，不以“零已知缺陷”作为通过条件。角色 2 必须把每项风险明确归入且只归入以下一类：

- `Blocking Risk`：突破可信边界或无法安全隔离，必须在本轮修复；正式结论不能为“通过”。
- `Accepted / Contained Risk`：仅限 Medium / Low，已有明确隔离与停止条件，可由角色 2 接受。
- `Monitored Technical Debt`：仅限 Medium / Low，当前仍受控，记录监测与后续版本。
- `Low / Won't Fix Now`：仅限 Low，当前明确不修，但必须记录边界与升级条件。

允许的 Containment 机制固定为 `isolation`、`fail-closed`、`feature-disabled`、`manual-recovery`、`known-issue`、`follow-up-version`，并必须以“机制 | 具体隔离说明”填写。每个被记录的风险项使用固定字段：`Known Issue`、`风险分类`、`Issue`、`Severity`、`Impact / Blast Radius`、`Containment`、`Stop / Escalation Condition`、`Planned Follow-up Version`、`Non-Waivable Boundary`。字段缺失、占位值、重复 ID、数量不符或未知枚举都失败关闭。

以下九项是不可豁免边界；只能作为 `Blocking Risk` 进入“不通过”记录，永远不能标记为 Accepted、Contained、Technical Debt 或 Won't Fix：

1. `governance-state-authorization`：governance-state 可越权修改。
2. `ruleset-required-check-integrity`：Ruleset / required check 可绕过、伪造或由错误集成满足。
3. `candidate-identity-binding`：Candidate SHA、Tree、PR 或审计目标无法唯一绑定。
4. `cas-revision-stale-write-protection`：CAS / revision 无法阻止陈旧覆盖。
5. `failed-audit-forward-progress`：审计失败仍可非法前进。
6. `trusted-writer-boundary`：trusted writer 或独立 Gate 信任边界失效。
7. `write-outcome-integrity`：写入失败、未合并或未读回却报告成功。
8. `release-candidate-eligibility`：错误 Candidate 获得发布资格。
9. `production-data-security-irreversibility`：可能造成生产、数据、安全或不可逆治理错误。

风险接受不改变状态机。正式审计结论仍然只有“通过”或“不通过”；存在已接受的低风险问题不会生成第三种审计结论或模糊终局，也不能改变结论与目标状态、Candidate 身份和批准 SHA 的严格绑定。

## 受保护写入

正式状态只能由 .github/workflows/governance-state.yml 写入。仓库所有者在开放、非 draft、同仓库 PR 中提交精确指令：

/governance-transition <expected-tip> <expected-revision> <role-number> <target-stage>

评论编排器只负责生成提案。提案 PR 建立后，Writer 用本来就需要的 `contents: write` 发出固定 `repository_dispatch` 事件，请求同一默认分支工作流独立复核；自然发生的 `pull_request_target` 只作为同一 Gate 的补充入口。独立 Gate 从 `main` 运行验证代码，不检出或执行提案树中的脚本；它重新读取原始评论，确认评论作者是仓库所有者且命令、所在 PR 与授权信封完全一致，再检查 previous tip/revision、角色转换、字段差异、记录存在性与摘要、泄密扫描以及 Candidate 远端身份。审计提案必须按 `auditPolicy` 将结论绑定到唯一目标状态；RC 审计还必须逐字段匹配 current 中的 Candidate SHA、Tree SHA 和 PR。Gate 通过 Checks API 创建并完成绑定准确提案 head SHA 的 `governance-state-write` Check。记录先通过第一个受保护 PR 合并，随后 current 与版本快照通过第二个受保护 PR 合并。只有 GitHub Actions App id `15368` 生成的该 Check 可以满足门禁；Writer 没有 `checks: write`，只能请求 Gate 并等待结果，不能生成授权结果。受保护合并以准确 head SHA 实现 compare-and-swap（CAS），任一竞争都会停止并要求重新读取。

以下四项是启用硬门，缺一项就必须保持 BLOCKED：

1. governance-state 受 GitHub 规则保护，绕过名单为空；必须通过 PR、来源固定为 App id `15368` 的 `governance-state-write` Check 和最新分支检查，同时禁止删除与强制推送。
2. Cloudflare Workers Builds 已关闭非生产分支构建，或明确排除 governance-state / governance/runtime。
3. `scripts/build-verified.sh` 必须在 Cloudflare 官方注入的 `WORKERS_CI=1` 且分支为 `governance-state`、`governance/*` 或 `governance-write/*` 时，于构建和任何版本上传之前以状态 78 失败关闭；`main` 上任何修改 trust-root workflow 的双亲合并都必须先验证完整路径允许列表再关闭，不依赖仓库当前的 merge title 格式。`Governance trust root:` 标记作为额外的失败关闭信号保留。
4. 用真实 trust-root 合并和真实两阶段治理写入证明 Cloudflare 检查停在上述门禁，没有创建 Worker Version、部署或公开预览别名；失败关闭的 Build 记录必须与“没有触发 Build”分开报告。

状态通道永远不得调用 Wrangler、创建 Release Tag、改 Worker/D1/KV/Secrets 或部署生产。

## 无秘密与泄密门禁

可信写入入口同时扫描 current、版本快照和本次记录。禁止管理员凭据、恢复材料、初始化口令、访问令牌、浏览器状态、二维码或访问链接、私人联系方式、网络地址、学生私人内容和生产资源原始 ID。错误只报告命中类别与文件，不回显发现的值。

## 一次性失败审计恢复

角色 2 必须先独立审计 trust-root PR；获批并合入 `main` 后，才能执行恢复。恢复命令只接受旧 `governance-state@3e7867d3cdba75045f6dc8aa0448ccaac3547b68`、revision 2、PR #13 Candidate `e24d78fd76cfbca9ebd957d16c406ffbc1c09e1b`、Tree `a54f47d5f5b5b54e18454d5faa7a4fc3a403228d` 和 PR #14 head `9451ef05fbe289aaade134bb60fb1a57e5eb15a6`。第一阶段写入 Candidate 与“不通过”审计记录，第二阶段才写 current 与版本快照；结果固定为 Schema 2、revision 3、`IMPLEMENTATION_REQUIRED`，并保留完成回执。迁移只接受 Schema 1，因此不能重放；`planAudit=null` 例外只随该固定回执保留在 `governance-1`，不能扩展到其他版本。

## 交接短句

- 1 → 2：“规划已经OK了，去检查。”
- 2 → 3：“审计通过了，开始做。”
- 3 → 2：“候选做好了，去检查。”
- 2 → 4：“审计通过了，发布。”

只有受保护写入成功后才能宣布交接完成。
