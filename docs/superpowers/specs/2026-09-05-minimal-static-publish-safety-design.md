# Role 3 最小发布安全修复设计

## 范围

基于固定 c2 Candidate，在新的 clean worktree 中仅修复影响正常运行与发布安全的四类问题：

1. 轮询、刷新和状态恢复只读推进到 `ARTIFACT_VERIFIED`，不得自动 promote；promote 必须由明确的管理员操作触发。
2. dynamic publish 在同一 revision CAS 更新中检查 draft 引用的媒体行存在且 `status = uploaded`；缺失、pending、deleting 或其他状态均拒绝发布。
3. Netlify deploy lookup 使用受限分页，并在分页不完整、请求失败或匹配不唯一时 fail closed；零匹配继续等待，不把不确定结果当成功。
4. 保留现有关键页面/资源/发布路径测试，补充上述回归契约。

不纳入访问策略重构、历史资源完整溯源、provider 写入、Hook 重试 generation 或非关键 UI 整理。`keep_assets` 继续 OMIT/DISABLE，资产兼容性不宣称通过。

## 并发与边界

- 首次 promote 仅接受 `ARTIFACT_VERIFIED`，通过状态 CAS 转为 `PUBLISH_REQUESTED`；重复/并发点击返回冲突或只读状态，不重复发起 provider mutation。
- Build/Deploy/制品核验仍可由已有轮询执行；只有 promote mutation 需要显式用户意图。
- 本轮只读构建、测试和本地 smoke；禁止 Upload Version、Create Deployment、Netlify Hook/Deploy 与 D1/KV/R2/Secret 写入。

## 验收

在该 worktree 完成正式构建、关键单元/回归测试和页面/资源 smoke，生成新的 commit/tree、bundle 与 digest，并记录剩余风险；随后交回 Role 2 复审。在 Role 2 PASS 前保持 `BLOCKED / INCONCLUSIVE / providerReceived unknown`。
