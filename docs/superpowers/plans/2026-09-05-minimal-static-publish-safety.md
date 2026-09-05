# Role 3 最小发布安全修复实施计划

## 固定基线

- base `release/v1.3.1-b@5aae394eecae5fb1d86daa36fc172b8d00b47854`
- source Candidate c2 `c2b2e4281f1cd79d892b0da26a1ba8f355fe37ad`
- worktree `D:\codex\pr36-verify-20260904\head` 只读；本计划只在新的 clean worktree 执行

## 任务

1. 读取并保留 c2 的 transport evidence、脱敏和 fail-closed 契约。
2. 在 `static-publish` 增加显式 promote 函数；`advanceStaticPublish` 到 `ARTIFACT_VERIFIED` 即停止。
3. 在 admin static-site route/card 增加显式 promote action，禁止 effect/polling 自动调用。
4. 在 `portfolio-store` 的 draft/publish CAS 条件中以 `json_each` + `LEFT JOIN` 拒绝不存在或非 uploaded 媒体；增加 dynamic publish route。
5. 在 `netlify-client` 增加受限分页和不完整响应错误；在 static publish 对零匹配保持等待并对不明确失败显式报错。
6. 补充静态发布、媒体就绪、lookup 分页/歧义和页面入口契约测试；运行关键现有 smoke/E2E（若环境允许）。
7. 使用 clean worktree 完成构建，重新生成 Worker/client manifests、bundle SHA 与 `bundleDigest`；记录 v92 精确 opaque ID 及执行前实时只读读回要求。
8. 以新 branch commit/tree 形成 Candidate，生成脱敏 Role 2 交接包；不执行任何 provider 写入。

## 验证命令

优先运行：`npm ci`、`npm run build`、`npm test`、目标 Playwright smoke、`npm run lint`、`git diff --check`。若 Windows 缺少 Bash/GNU timeout，记录实际阻断，不伪称 build PASS。
