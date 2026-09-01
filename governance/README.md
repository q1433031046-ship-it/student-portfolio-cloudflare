# 超级中枢 v1.1｜治理入口

本目录是作品集展示网站的正式治理合同，也是超级中枢的长期事实源。长期事实写进 GitHub，旧聊天和本地文档不能覆盖仓库中已经验证的合同与状态。

## 用户可见正式命名

| 对象 | 正式名称 | 使用范围 |
| --- | --- | --- |
| 产品 | 作品集展示网站 | 用户可见产品标题、产品版本与产品交接 |
| 治理系统 | 超级中枢 | 治理入口、正式里程碑回复与治理交接 |
| 生产基础设施 | 生产环境 | 生产预检、发布、验证与回滚说明 |
| 机器可读治理进度 | 中枢进度状态 | 当前步骤、责任角色、下一角色、Candidate、审计、阻断与交接信息 |

真实内部机器标识仍使用其固定原值，例如 `governance-1`、`governance-state`、状态字段、role slug、仓库 slug、工作流名称和机器合同路径。只有解释兼容性或准确指向这些对象时，用户可见文字才引用内部标识。

## 四类版本边界

| 版本类别 | 当前事实 | 约束 |
| --- | --- | --- |
| 产品版本 | Active Student Production Baseline = 作品集展示网站 v1.3.0 | 后续产品版本独立演进，例如 v1.3.1、v1.3.2 |
| 超级中枢版本 | 超级中枢 v1.1 | 只描述用户可见治理规范 |
| 内部治理标识 | `governance-1`、`governance-state` | 不是产品版本或超级中枢版本 |
| Schema 版本 | `schemaVersion: 2` | 只描述机器状态结构 |

四类版本不得互相替代。显示超级中枢 v1.1 不修改 `activeVersion`、Schema、状态机或任何内部治理标识。

## 默认人工审核边界

默认人工审核模式下，中枢进度状态只依据已经验证的 GitHub Base、Head、Tree、PR、审计结论和合入里程碑生成。除非项目所有者在独立获批变更中明确重新启用动态治理状态，否则不得从旧 `activeVersion` 或旧 runtime 指针推导新的实施、审计或发布资格。

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
2. 默认人工审核模式读取准确规划、审计、Base、Head、Tree、PR 与合入事实；动态治理状态明确启用时，才从受保护的 governance-state 分支读取 governance/runtime/current.json。
3. 启用动态治理状态时，核对 activeVersion、stage、revision、记录路径与 SHA-256。
4. 自动读取当前任务所需记录，并核对 Candidate 的 commit、tree、分支、PR 和基线。
5. 证据、任务类型、阶段或角色不匹配时失败关闭，不要求用户搬运仓库已有文件。

## 静态合同与启用后的动态事实

- main/governance：角色、状态机、Schema、模板和验证器。
- governance-state/governance/runtime/current.json：动态治理状态启用后的唯一当前事实指针。
- governance-state/governance/runtime/versions/activeVersion.json：同 revision 的版本快照。
- governance-state/governance/runtime/records/activeVersion：固定类型的规划、审计、Candidate、发布与阻断记录。

每个记录路径必须绑定当前版本和固定文件名，状态同时保存记录 SHA-256。跨版本指针、错类型文件或摘要不一致全部拒绝。

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

## 状态提示与完整交接词

- 1 → 2：“规划已经OK了，去检查。”
- 2 → 3：“审计通过了，开始做。”
- 3 → 2：“候选做好了，去检查。”
- 2 → 4：“审计通过了，发布。”

这些短句只作为兼容状态提示，不能替代 `governance/workflow.md` 规定的自包含一键复制交接词。确实需要用户把任务发送给下一角色时，必须同时生成完整交接词。动态治理状态明确启用时，只有受保护写入成功后才能宣布动态交接完成；默认人工审核模式则必须完成准确 GitHub 与审计证据复读。
