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

## 受保护写入

正式状态只能由 .github/workflows/governance-state.yml 写入。仓库所有者在开放、非 draft、同仓库 PR 中提交精确指令：

/governance-transition <expected-tip> <expected-revision> <role-number> <target-stage>

可信工作流从 main 运行验证代码，不执行 PR 中的脚本。它强制检查所有者身份、previous tip/revision、角色转换、字段差异、记录存在性与摘要、泄密扫描以及 Candidate 远端身份。记录先通过第一个受保护 PR 合并，随后 current 与版本快照通过第二个受保护 PR 合并；两个 PR 都绑定准确目标 tip、固定 `governance-state-write` 状态和分支最新要求，以受保护合并实现 compare-and-swap（CAS），任一竞争都会停止并要求重新读取。

以下三项是启用硬门，缺一项就必须保持 BLOCKED：

1. governance-state 受 GitHub 规则保护，绕过名单为空；必须通过 PR、`governance-state-write` 状态和最新分支检查，同时禁止删除与强制推送。
2. Cloudflare Workers Builds 已关闭非生产分支构建，或明确排除 governance-state / governance/runtime。
3. `scripts/build-verified.sh` 必须在 Cloudflare 官方注入的 `WORKERS_CI=1` 且分支为 `governance-state` 或 `governance/*` 时，于构建和 `wrangler versions upload` 之前以状态 78 失败关闭。
4. 用真实治理分支提交证明 Cloudflare 检查停在上述门禁，没有创建 Worker Version 或公开预览别名。

状态通道永远不得调用 Wrangler、创建 Release Tag、改 Worker/D1/KV/Secrets 或部署生产。

## 无秘密与泄密门禁

可信写入入口同时扫描 current、版本快照和本次记录。禁止管理员凭据、恢复材料、初始化口令、访问令牌、浏览器状态、二维码或访问链接、私人联系方式、网络地址、学生私人内容和生产资源原始 ID。错误只报告命中类别与文件，不回显发现的值。

## 一次性 bootstrap

bootstrap 只允许 governance-1、分支 governance/four-role-auto-handoff 和基线 d81785dd51bb0c9be339449566a15d3b3971e02a。candidateSha 必须与远端 PR head 一致。治理合同进入 main 后不得再次创建 bootstrap；后续产品版本必须同时具备方案审计和候选审计。

## 交接短句

- 1 → 2：“规划已经OK了，去检查。”
- 2 → 3：“审计通过了，开始做。”
- 3 → 2：“候选做好了，去检查。”
- 2 → 4：“审计通过了，发布。”

只有受保护写入成功后才能宣布交接完成。
