# Netlify 静态发布请求兼容修复实施方案

Plan ID：PLAN-20260906-NETLIFY-RUNTIME-REDIRECT-001
版本：1.1
角色：1（超级规划）
设计依据：用户对已确认的运行时参数根因及“落实到现网并验证”的说明回复 go。

**目标：**消除现有静态发布链路中两处 Cloudflare 不支持的 redirect 参数，保留现有网站功能与资源，在准确对象独立审计后升级同一个 Worker。

**架构：**以当前 provider 的精确运行模块为补丁基线，在两个限定函数中各替换一个 ASCII 字符串值；其余模块字节全部一致。将源模块、补丁、产物与资源保留请求分别冻结，正式 Candidate 绑定同仓准确 Base/Head/Tree/PR，不声称已恢复历史 TypeScript 源树。

**技术：**Cloudflare Worker ES module、workerd 1.20260828.1、compatibility_date 2026-08-28、nodejs_compat；沿现有四角色完成。

## 设计选择与约束

已确认直接根因及真实引擎复现见 netlify-root-cause-20260906/root-cause.md。完整线上内容另一次只读检查确认：redirect:error 全模块仅 2 处，分别 triggerDraftBuild 与 readJsonEvidence。仅修 Hook 会使后续制品核验继续遇到同一确定性故障，故两处一起纳入同一最小修复。

采用当前运行模块的定点补丁；不使用整包 PR37 或 dirty TypeScript 重建，因为它们不能保证保持现有动态发布/预览/单独发布等行为。使用 manual 并保留原 !response.ok 失败分支，符合既有不跟随重定向、不自动重发的行为要求。

- main 治理合同本轮官方 GET 核实为 d59825a25bce70b090aa613ea708adaa1362d113，默认人工审核，不启用 governance-state。
- 当前 Worker 基线 v92 / 100%；worker-entry.js 2,485,822 bytes，SHA256 8d0fc2b08777af56d43139412327c0a8702b469919bb7428d54cfeca7f3351d8。
- _headers 为独立辅助模块；历史基线 125 bytes，SHA256 9e55124bccd40b43dbc6e002daa777fa8f32a230420152910784ca65501d9e0f，实施前以当前 GET 取回核实。
- 同一现有站点、同一 Worker/D1/KV/ASSETS/Secret/变量/域名/流量目标；不创建、替换或删除资源，不执行 migration，不编辑用户内容。
- 不增加诊断字段、错误类别、依赖、状态转换或后台按钮；旧诊断补丁不叠加。
- 静态测试仍由用户本人操作；助手只读验收，不能并发点击 publish/retry/verify/promote 或重发 Hook。
- 两处替换后预期模块长度 2,485,824 bytes。产物 hash 必须由实际字节计算，不能预填。其余模块和所有资源沿用当前状态。

## 1. 方案审计与准确来源准备

由角色 2 独立核对本方案，以及 role3-netlify-runtime-hotfix-source-path-20260906.md、role4-netlify-runtime-hotfix-channel-readonly-20260906.md 的实际证据。方案可先明确允许本地实施；正式发布必须补齐同仓准确 Candidate 与资源保留通道审计，不借用旧 PASS。

角色 3 使用新目录 role3-netlify-runtime-redirect-fix-20260906；目录存在则先核对归属，不覆盖任何现有内容。原产品目录、PR37 和冻结证据保持。官方 GET 保存原始两个模块，只采用长度/hash 匹配的内容；不得从片段或旧 dist 拼装。允许沿用已有有效官方认证读取，凭据仅进程内使用，不打印、不落入成果。无新 OAuth、无业务 Secret 值读取。

## 2. 唯一允许的产品变化

文件：当前 provider 的 worker-entry.js。

准确锚点 A：async triggerDraftBuild(hookUrl, input, providerRequestKey) 到下一方法 async getDeploy。

准确锚点 B：async function readJsonEvidence(baseUrl, file) 到下一顶层函数。

每个函数体必须恰好命中一次下列替换：

```diff
- redirect: "error"
+ redirect: "manual"
```

按二进制切片执行，保留引号、空白、编码、换行及前后所有字节。不得全文件字符串替换、格式化、转译或重打包。记录每处原字节偏移、上下文、前后值以及合成后的完整产物 hash。若任一锚点或出现次数不符，停止实施并返回角色 1 核对基线。

既有失败处理保持：Hook 的 !response.ok 抛 NETLIFY_BUILD_TRIGGER_FAILED/原 providerError 分类；readJsonEvidence 的 !response.ok 抛 STATIC_ARTIFACT_READBACK_FAILED。manual 下 3xx 仍为失败，不发下一跳。保持 JSON 载荷、固定 trigger_branch/title、15 秒包装、取消与 timer 清理、原成功解析及所有任务控制流。

## 3. 必要验证与 Candidate

- [ ] 原模块/hash、两个限定锚点及 _headers 原件已核实；前后模块差异严格等于两个字符串值，净增加 2 bytes。
- [ ] 原文件除这两处的所有前缀/中间/后缀逐字节一致；_headers 全部一致。原始输入和旧目录不变。
- [ ] 使用真实 workerd、同兼容设置；从准确原/新模块提取实际函数，而非手写一个相似实现。出站统一交本地接管，禁止真实 Netlify 网络。
- [ ] Hook 原 error 重现构造失败且本地出站接管 0 次；修复后成功 JSON/空响应按原规则返回，出站 1 次，POST/两个 query/载荷一致。
- [ ] Hook 对 301/302/307/308 均失败、接管 1 次且无下一跳；401/403、429、其他失败响应保留原分类。
- [ ] readJsonEvidence 原 error 失败，修复后有效 JSON 正常返回，字节/hash计算保持；3xx 与其他非成功状态拒绝，出口仅一次。
- [ ] 15 秒默认值及 timeout/Abort 原函数字节不变；必要短超时用例验证仍取消并清理，不无理由重跑旧 50 项诊断测试或全量重建。
- [ ] 本地模块语法/加载检查通过；新测试和补丁工具能复现准确产物。
- [ ] Git 载体使用 main 的准确基线生成独立修复审计分支，包含经无秘密扫描的精确补丁、产物清单、来源/验证材料及必要产物。Base/Head/Tree/PR 都取自实际对象，不把 provider v92 当成 Git commit。

新远端分支/PR 建立前，核对 Workers Builds 与 Netlify 对该分支的自动触发范围；不能推动 main、release/v1.3.1-b 或 static-build/v1.3.1-b 造成旁路部署。只使用单独修复审计分支、非强制推进及准确 PR，不合并或创建发布标签。公开材料必须排除密钥、Hook 地址、生产资源原始 ID、用户内容和账号资料。公开提交范围如仍需明确批准，先完成全部准确正文/对象供最后审核，不停止已获准的本地准备。

角色 2 对实际 Candidate 独立审计，批准字段必须绑定完整 Head/Tree/PR、当前 Base、补丁和上传模块 hash。本地模拟结果不等于线上发布成功。

## 4. 生产请求与执行门

本次是保留当前正式模板版本的运行制品兼容热修，不执行 AGENTS/agent-manifest 定义的从发布标签获取全量源码的自动升级，不声称已执行 npm run cloudflare:deploy。实际方法明确限定为官方 Script Upload 的一次性 PUT；它会立即改变线上运行，没有独立预上传阶段。相对于源码标签升级入口，这是本次准确对象内的热修方法适用说明；不改变仓库长期升级规则，也不赋予后续任意 API 发布权限。用户对已确认修复落实到现网的 go 覆盖该同目标、同资源的最小修复；若独立审计认为这项具体方法仍需额外选择，必须引用条文并把问题与完整准确对象一起最后呈现，不提前索取抽象许可。

固定接口候选为 PUT /accounts/{account_id}/workers/scripts/{existing_script_name}?bindings_inherit=strict，raw multipart；metadata 使用 main_module=worker-entry.js、keep_assets=true、8 个逐名 type=inherit/version_id=准确 v92 的绑定、现有兼容设置和全部已核实需要显式保留的设置。_headers 按 provider 实际模块或资产配置身份原样保留，不能混淆 multipart 内的代码模块与资产 header 配置。GET 中空 placement 和内部 raw_headers 不能直接猜成可上传字段；由角色 4 的官方语义补证决定其明确映射，准确执行对象包含最终完整 metadata，独立审计前必须闭合，不能把此段当作可直接执行请求。

原脚本仅包含不可执行的 sourceMappingURL 引用且当前 content/v2 未提供 map。本次不新增或混入旧 map；两词替换使下游列偏移可能改变，作为可接受的诊断定位限制记录，原代码功能字节没有因此变化。

请求预算：Script Upload PUT 最多 1 次；成功后只读检查。结果不确定时不重发，先用当前版本/模块/部署读回判定是否生效。只在新版本已确定生效且出现确定的主站/绑定/资产回归时，执行最多 1 次经批准的 POST deployments 恢复原 v92/100%，不写数据库或 Secret；回滚响应不确定同样仅 GET 核对。配置无法确定保留或无法确定回滚范围时，不执行 PUT。

角色 4 的只读通道报告必须明确选定官方上传接口及实际支持的资源保留语义。角色 3 据此冻结准确执行对象，角色 2 随 Candidate 一起核对，满足以下全部条件后才由角色 4 执行：

1. 固定目标仍是当前同一现有 Worker，写前活动版本、完整模块 hash 与 v92 匹配；其他角色及 CI 无并发发布。
2. 上传 main_module 及 _headers 与准确 Candidate 清单一致，不混用旧前端资源、不重新生成前端。
3. 所有绑定的名称/类型/资源身份与 v92 一致；Secrets 用官方保留/继承机制，不读取或重写值。兼容日期/标志、资产配置、变量、observability 等完整设置必须准确保留。
4. 资产沿用机制必须由本次所用接口明确支持并落实到准确载荷；不能将不同接口的 keep_assets / inherit 字段混用。只有代码完全保持资源路径时才讨论沿用，旧 PR37 资产不兼容结论不能机械套到本次原模块两词补丁。
5. 入口一旦直接改变运行即按生产写入处理。调用次数固定，禁自动重试；响应不确定时仅 GET 查证，不能盲目重复上传或恢复旧 Preview 执行器。
6. 回滚目标固定为本次写前精确 v92（本地私有清单记录版本 ID），须有官方支持的恢复入口并核定原绑定/资产仍可恢复；没有 migration 或用户数据逆向操作。正常读回不触发回滚，只有确定的主站/资源回归才执行经审计的回滚动作。
7. 正式独立审计 PASS 与当前实际可执行对象齐全，不能用用户 go 代替角色 2 的结论。

通道证据不足时停止生产依赖动作，并明确唯一缺口；本地准确补丁/测试/审计准备仍继续。此条件不授予任意新增执行器建设或其他基础设施变更。

## 5. 上线读回与真实验收

上传后读取实际当前模块并计算 hash，确认两个函数均为 manual、其他代码字节对应准确产物。再次核对全部绑定与配置指纹、资产设置和主要页面资源；确认主站和登录入口保持可用。只读检查应按现有治理先核实初始化已存在，避免触发初始化写入。

正式报告分别说明：代码热修已生效、主站可用、真实静态发布尚待/已由用户操作验收。用户本人测试后，以同一个 request key/generation 关联 Netlify Deploy；观察构建、制品核验、预览/单独发布及固定网址实际内容，不能仅以 HTTP 200 或请求提交成功宣告完整发布成功。失败只读定位后返回对应角色，不自动加一次 Hook。

执行回执准确绑定 Candidate、产物/配置读回与实际版本，按当前 GitHub 默认合同留痕并读回。没有完成正式回执，不冒称治理流程完结。

## 里程碑与回退

当前角色：1（超级规划）；当前状态：方案 v1.0 待独立核对。
标准主路径：1 → 2（方案审计）→ 3 → 2（Candidate 审计）→ 4。
当前所在位置：根因和两处产品修改范围已确认，生产通道只读证据正在准备。
当前预计路径：2（方案审计）→ 3（准确实施与执行对象）→ 2（Candidate/执行对象审计）→ 4（上线与读回）；用户操作真实静态发布后验收。
最低剩余主步骤：4，生产通道出现阻断时按实际缺口重算，不假定可执行。
下一步：独立核对准确方案、来源和通道；下一角色：2（方案审计）。
推荐思考程度：极高；原因：产品差异只有两词，但必须保证上传对象与现网资源保留完全对应。

无线上写入时回退为保留并停用新修复目录；不得删除旧成果。若基线变化、需要修改第三处产品代码、资源保留不成立或正式对象不一致，返回角色 1/3 处理，不由角色 4 现场改代码。
