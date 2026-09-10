# Cloudflare 双发布实施计划

依据已通过的 PLAN-20260906-CF-DUAL-PUBLISH-001 v1.0；实施角色按准确交接在本会话顺序完成，不启动额外角色。

**Goal:** 同一完整内容模型支持独立动态发布，以及 Pages 静态预览后明确正式发布。

**Architecture:** 完整 PortfolioExperience 新增 static 模式；构建期固定模板，Worker 分步装配冻结内容与媒体；独立 Pages 任务、CAS 锁和部署在途记录隔离历史。

**Tech Stack:** React 19、Vite、Cloudflare Workers/Pages、D1、MEDIA_KV、真实 workerd、Playwright。

- [x] 从准确 main 建隔离分支，按文件清单复制完整来源，私有配置/缓存/产物不复制；原目录不变。
- [x] 共享完整展示组件实现 static 播放/恢复/字体，无后台/API回退；预编译静态模板及全媒体本地包；浏览器验证桌面和320/360/390宽度。
- [x] 固定 Pages BLAKE3/base64/JWT 协议，真实 workerd 验证单文件及有界批次；预检全部文件再写资产。
- [x] 新 Pages 表和逐步 CAS 状态机：冻结、资产分批、预览创建/查回/核验、明确生产创建/查回；未知创建永不自动重发。
- [x] 后台双入口/二维码和中文状态接新编排，保持独立动态发布、保存和媒体保护；清理列明活动 Netlify 代码与配置。
- [x] 本地向前迁移、隔离/权限/失败保留验证；完整构建、类型、lint及适用测试。
- [x] 冻结本地 Candidate、F01–F18实测矩阵、运行预算、上线/凭据/两个站点回滚对象。远端写入和真正上线留待新的具体授权。

每项按真实结果更新证据，未验证不得写PASS。源树与现网逐字节对应尚未证明。保留历史数据/证据与旧尝试标记，原PR39不复用。

本地实施及检查已执行，具体结果以 audit/pages/implementation-receipt.md 为准。完整单测未通过、原生 Linux/macOS WebKit 与线上实际验收未完成，保持 RELEASE_HOLD；勾选不代表发布门禁 PASS。
