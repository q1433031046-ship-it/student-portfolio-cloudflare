# 学生作品展示

可独立部署到 Cloudflare 的学生作品集网站，包含可视化后台、草稿与发布快照、D1 数据、KV 分片媒体、二维码访问控制、访问记录、视频签名与拖动播放，以及管理员密码、系统恢复码和程序升级中心。

## 给学生

不要自己先部署。先阅读 [START-HERE.md](START-HERE.md)，然后把 `deployment/DEPLOY-PROMPT.txt` 复制给 GPT，由 GPT 检查当前 GitHub / Cloudflare 账号后再带你打开官方一键部署入口。

最低模型：GPT-5.6 Sol。默认思考程度：高；复杂部署、迁移、资源绑定和升级故障使用超高。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/q1433031046-ship-it/student-portfolio-cloudflare)

Cloudflare Deploy to Cloudflare 会为新站点创建自己的 Git 仓库并配置所需 Worker、D1 和 `MEDIA_KV` 资源。每个站点的数据与媒体应保持独立。

## 后台登录

首次部署用 `INITIAL_ADMIN_CODE` 创建管理员密码和系统恢复码。之后日常只使用管理员密码。

输入正确密码后，这台浏览器保持登录 12 小时；12 小时内再次点“管理”通常会直接进入后台。点击“安全退出”后立即失效。连续输错密码 5 次会锁定 15 分钟。

## 多账号与多网站

同一个 GPT 账号可以帮助不同学生部署，但每次必须确认当前浏览器登录的是哪一个 GitHub 和哪一个 Cloudflare 账号，不能沿用上一位学生的托管账号。

同一个 GitHub/Cloudflare 账号也可以部署多个网站，但每个站点必须使用独立仓库、Worker、D1、KV、网站地址、管理员密码和恢复码。

## 媒体与网站空间

- 视频：MP4（建议 H.264 / AAC），单个不超过 50 MB。
- 上传：视频按 4 MiB 分块保存。
- 播放：支持 HTTP Range、拖动进度条和从中间继续播放。
- 网站空间：应用最多使用 800 MiB；达到 700 MiB会预警。
- 后台位置：`概览`页面最下方的“网站空间”。

## 程序升级

后台“网站空间”下方有“程序升级中心”。升级程序时保留当前 Worker、D1、MEDIA_KV、管理员状态、图片、视频、草稿、已发布内容和二维码，不为升级重新创建第二套资源。

完整规则见 [UPGRADE-GUIDE.md](UPGRADE-GUIDE.md)。

## 验证命令

```bash
npm ci
npm test
npm run lint
./node_modules/.bin/tsc --noEmit
```

## 文档

- 快速开始：[START-HERE.md](START-HERE.md)
- 学生完整部署指南：[docs/guides/student-cloudflare-setup.md](docs/guides/student-cloudflare-setup.md)
- GPT 部署引导语：`deployment/DEPLOY-PROMPT.txt`
- 升级指南：[UPGRADE-GUIDE.md](UPGRADE-GUIDE.md)
- 机器可读部署规则：`deployment/agent-manifest.json`
- 当前程序版本：`deployment/template-version.json`

运行秘密只通过 Cloudflare Secret 或网站后台输入；不要把管理员密码、一次性部署口令、恢复码、Cloudflare 密码、GitHub 密码或长期 API Token 写入聊天、源码、提交或截图。
