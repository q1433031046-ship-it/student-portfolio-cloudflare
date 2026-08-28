# 程序升级指南

本项目支持“网站数据独立、程序版本可升级”。升级程序时，只更新代码与数据库迁移，不重新创建或替换现有 Cloudflare 资源。

## GPT 使用要求

- 最低模型：GPT-5.6 Sol。
- 默认思考程度：高。
- 遇到部署失败、Cloudflare 资源绑定、数据库迁移、版本冲突或升级异常时：思考程度改为超高。
- 如果当前账号看不到 GPT-5.6 Sol，先不要执行正式升级。

## 升级前必须读取

GPT/Codex 在升级前必须读取：

1. `AGENTS.md`
2. `deployment/agent-manifest.json`
3. `deployment/template-version.json`
4. 本文件 `UPGRADE-GUIDE.md`

并确认当前站点的 Worker、D1 `DB`、KV `MEDIA_KV` 都属于这个站点。

## 绝对不能覆盖的内容

升级时必须保留：

- 当前 Worker 和现有 `workers.dev` 地址；
- 当前 D1 数据库的资源 ID、所有表、草稿、已发布内容、管理员凭证、二维码和访问记录；
- 当前 `MEDIA_KV` 的资源 ID 和所有图片、视频、字体；
- Cloudflare Secrets、管理员密码、恢复码状态和运行时变量；
- 每个站点自己已经上传和编辑的全部内容。

不要把模板仓库里的 D1/KV 资源 ID复制到已有站点。不要为了升级创建第二套 D1、KV 或 Worker。

## 标准升级流程

1. 读取 `deployment/template-version.json`，确认当前程序版本。
2. 检查目标站点现有 Cloudflare Bindings，记录 `DB` 与 `MEDIA_KV` 的资源归属。
3. 对比模板最新版代码，只同步程序文件、样式、API、测试、迁移和文档。
4. 保留目标站点自己的 Cloudflare 资源 ID 与 Secrets。
5. 如果有新 D1 migration，只对现有 `DB` 执行增量迁移，不新建数据库。
6. 使用 `npm run cloudflare:deploy` 更新已有站点。
7. 完成后验证 `/admin`、图片读取、视频播放、草稿/预览/发布隔离和网站空间统计。
8. 验证成功后再报告升级完成。

## 一个账号部署多个网站

同一个 GitHub/Cloudflare 账号可以部署多个网站，但每个网站必须完全独立。每个站点应有独立的：

- GitHub 仓库；
- Worker 名称；
- D1 数据库；
- `MEDIA_KV`；
- 网站地址；
- 管理员密码与恢复码。

升级某一个站点前，GPT 必须先确认目标站点名称，不能操作同账号下的其他站点。

## 可直接复制给 GPT 的升级引导语

> 请把我的学生作品集网站升级到模板最新版本。先读取 AGENTS.md、deployment/agent-manifest.json、deployment/template-version.json 和 UPGRADE-GUIDE.md。升级只允许更新程序代码和增量数据库迁移，必须保留当前 Worker、workers.dev 地址、D1 DB、MEDIA_KV、管理员账号、Secrets、图片、视频、草稿、已发布内容、二维码和访问记录。不要创建新的 D1、KV 或 Worker，也不要把模板仓库中的资源 ID 覆盖到我的站点。先检查并确认目标站点和现有资源，再执行升级；需要账号官方授权时再叫我，任何密码、一次性部署口令和系统恢复码都由我本人在官方页面输入，不要向我索取。升级完成后请验证后台登录、图片、视频、草稿预览、正式发布和网站空间统计。

## 密钥安全

管理员密码、`INITIAL_ADMIN_CODE`、系统恢复码、Cloudflare 密码、浏览器 Cookie、长期 API Token 都不得发送到聊天、提交到 GitHub 或写入日志。需要输入时，只允许站点所有者本人在官方页面或网站后台输入。
