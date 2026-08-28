# 中科云领学生作品展示

可独立部署到 Cloudflare 的学生作品集网站，包含可视化后台、草稿与发布快照、D1 数据、R2 私有媒体、二维码访问控制、访问记录、视频签名播放，以及首次管理员邮箱绑定。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/q1433031046-ship-it/student-portfolio-cloudflare)

点击上方按钮后，Cloudflare会在部署账号中创建一份项目仓库，自动预配Worker、D1数据库和R2存储桶并完成首次发布。部署完成后继续执行“首次邮箱绑定”配置。

## 非技术用户部署

把完整部署 ZIP 上传给支持代码工作区和 Cloudflare 连接的 ChatGPT/Codex，并让它先读取 `AGENTS.md`。用户只负责官方账号授权、确认管理员邮箱、验证发件地址和查收验证码，其余创建、迁移、部署与测试由 AI 完成。

给 ChatGPT 的现成开场说明见 [START-HERE.md](START-HERE.md)，机器可读的部署约束见 [deployment/agent-manifest.json](deployment/agent-manifest.json)。

## 本地检查

```bash
npm ci
npm test
npm run lint
./node_modules/.bin/tsc --noEmit
```

## Cloudflare 部署

首次部署：

```bash
npm run cloudflare:setup
```

后续程序更新：

```bash
npm run cloudflare:deploy
```

生成不含账号凭据、测试数据和构建缓存的部署压缩包：

```bash
npm run cloudflare:package
```

首次部署前需要启用 Cloudflare Zero Trust 与 Email Service。详细步骤见 [正式部署与首次邮箱绑定指南](docs/guides/student-cloudflare-setup.md)。

## 目录

- `app/`：页面、后台和 API。
- `db/`、`drizzle/`：D1 结构与不可变迁移。
- `wrangler.jsonc`：Worker、D1、R2、Email 和静态资源绑定。
- `scripts/`：验证、首次部署与后续发布脚本。
- `tests/`：数据模型、安全、二维码、媒体、渲染和首次绑定测试。

运行密钥只通过 Wrangler secrets 配置；部署包不包含 Cloudflare 凭据、管理员绑定记录、测试站内容或媒体文件。
