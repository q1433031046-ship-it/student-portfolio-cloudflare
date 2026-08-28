# 中科云领学生作品展示

可独立部署到 Cloudflare 的学生作品集网站，包含可视化后台、草稿与发布快照、D1 数据、KV 分片媒体、二维码访问控制、访问记录、视频签名与拖动播放，以及密码和系统恢复码。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/q1433031046-ship-it/student-portfolio-cloudflare)

点击按钮后，Cloudflare 会自动预配 Worker、D1 数据库和 `MEDIA_KV` 媒体空间并完成首次发布。部署时填写一段至少16位、同时包含英文字母和数字的 `INITIAL_ADMIN_CODE`；首次进入后台用它创建管理员密码，随后保存系统生成的恢复码。

## 给非技术用户

直接阅读 [START-HERE.md](START-HERE.md)。支持代码工作区和 Cloudflare 部署的 ChatGPT/Codex 可以完成检查、迁移、部署和测试；用户只在官方页面授权，并自行输入登录秘密。

## 媒体与网站空间

- 视频：MP4（建议 H.264 / AAC），单个不超过50 MB。
- 上传：浏览器自动按4 MiB分块，失败分片自动重试。
- 播放：支持 HTTP Range、拖动进度条和从中间继续播放。
- 网站空间：应用最多使用800 MiB；达到700 MiB会预警。
- 后台位置：`概览`页面最下方的“网站空间”。

800 MiB上限为免费KV账户预留了运行余量。Cloudflare账户下的KV总用量仍应按[官方限制](https://developers.cloudflare.com/kv/platform/limits/)统一核对。

## 本地验证

```bash
npm ci
npm test
npm run lint
./node_modules/.bin/tsc --noEmit
```

## Cloudflare 部署

首次直接部署：

```bash
npm run cloudflare:setup
```

已有网站更新：

```bash
npm run cloudflare:deploy
```

生成交给其他ChatGPT/Codex的部署包：

```bash
npm run cloudflare:package
```

完整流程见[正式部署指南](docs/guides/student-cloudflare-setup.md)。

## 目录

- `app/`：页面、后台和API。
- `db/`、`drizzle/`：D1结构与迁移。
- `wrangler.jsonc`：Worker、D1、KV和静态资源绑定。
- `scripts/`：验证、部署与打包脚本。
- `tests/`：数据、安全、媒体、二维码和渲染测试。

运行秘密只通过Cloudflare Secret配置；源码与部署包不包含真实口令、管理员密码、恢复码、账号凭据、站点内容或媒体文件。
