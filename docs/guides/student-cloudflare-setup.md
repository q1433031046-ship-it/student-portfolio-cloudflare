# Cloudflare 正式部署与首次邮箱绑定

这个部署包使用 Cloudflare Worker、D1、R2、Access 和 Email Service。作品内容在网站后台维护；只有程序升级时才需要重新部署。

## 推荐：交给 ChatGPT/Codex 部署

非技术用户不需要自行执行下面的命令。把完整 ZIP 上传给支持代码工作区和 Cloudflare 连接的 ChatGPT/Codex，并发送 `START-HERE.md` 中的开场说明。部署代理应先读取根目录 `AGENTS.md` 和 `deployment/agent-manifest.json`，然后替用户完成检查、资源创建、迁移、密钥配置、发布和在线测试。

用户只在官方页面确认 Cloudflare 授权、指定管理员邮箱、验证发件地址并查收验证码。不得向代理发送 Cloudflare 密码、邮箱密码、API Token 或浏览器 Cookie。

下面保留完整人工步骤，供部署代理执行或故障恢复时核对。

## 部署前需要准备

- 一个 Cloudflare 账号，并启用 Zero Trust。
- 一个已接入 Cloudflare DNS 的域名，用于验证发件地址。网站本身可以先使用 `workers.dev`，发件域名只负责发送首次后台入口邮件。
- Node.js 22.13 或更新版本。
- 一个可正常接收验证码的管理员邮箱。

不要把 Cloudflare 密码、API Token、邮件密钥写进代码或发送给协助人员。Wrangler 会通过 Cloudflare 官方登录页授权。

## 第一步：启用 Cloudflare Email Service

1. 进入 Cloudflare 控制台的 **Compute → Email Service → Send emails**。
2. 添加一个发件域名，并按提示完成 SPF、DKIM 等 DNS 验证。
3. 创建一个发件地址，例如 `admin@你的域名`。
4. 记下完整发件地址，首次部署脚本会要求输入。

首次绑定完成后，网站会用这个地址向管理员发送主题为“你的作品网站后台入口”的邮件。

## 第二步：开始部署

解压部署包，在项目目录执行：

```bash
npm ci
npm run cloudflare:setup
```

脚本会先完成生产构建，然后创建 Worker、空白 D1 数据库和空白 R2 存储桶，并应用全部数据库迁移。测试站的数据不会被复制。

## 第三步：配置邮箱验证码登录

脚本首次部署后会暂停。此时进入 Cloudflare 控制台：

1. 打开 **Zero Trust → Access controls → Applications**。
2. 创建 Self-hosted application，并为同一个网站添加以下三个路径：
   - `/admin*`
   - `/api/admin*`
   - `/preview*`
3. 登录方式选择 **One-time PIN**。
4. Allow 策略只允许准备绑定的管理员邮箱，不要使用“所有邮箱”规则。
5. 将应用会话和 Zero Trust 全局会话都设为 15 分钟。
6. 复制 Team Domain 与 Application Audience Tag。

返回部署脚本，依次输入：

- Team Domain；
- Audience Tag；
- 准备绑定的管理员邮箱；
- 已验证的发件地址。

脚本会把这些值写入 Cloudflare 运行环境，并分别生成视频播放、二维码访问和匿名记录所需的随机密钥。源代码和压缩包中不会保存这些值。

## 第四步：首次绑定

1. 打开部署完成后显示的网站地址。
2. 空白站点会自动进入后台登录页。
3. 输入准备绑定的管理员邮箱，从邮箱获取一次性验证码并完成登录。
4. 后台会显示经过验证的邮箱；该字段不能编辑。
5. 点击“绑定当前邮箱”。
6. 网站写入唯一所有者，并发送后台入口邮件。
7. 邮件发送成功后，编辑、上传、二维码、记录和发布功能才会开放。

绑定后没有修改邮箱的页面或接口，数据库也会拒绝更改所有者邮箱。需要更换所有者时不能直接改数据库，应重新建立正式环境并重新绑定。

## 日常登录

- 从收藏夹或首次绑定邮件中的 `/admin` 链接进入后台。
- Cloudflare Access 会要求邮箱验证码；验证码为一次性并在短时间内失效。
- 有效的 15 分钟会话内刷新页面不会重复验证。
- 使用后台右上角“安全退出”后，下一次进入必须重新获取验证码。

## 后续更新

只修改作品内容时，直接在后台保存和发布。修改网页程序后执行：

```bash
npm run cloudflare:deploy
```

该命令会构建程序、应用新增数据库迁移并更新 Worker，不会覆盖 D1 中的作品内容、所有者绑定或 R2 媒体。

## 部署后必须测试

按顺序完成以下真实环境测试：

1. 未登录打开 `/admin`，确认收到邮箱验证码。
2. 完成首次绑定，确认入口邮件送达且链接指向当前站点 `/admin`。
3. 点击“安全退出”，重新进入并再次完成验证码验证。
4. 保存一份草稿并打开快速预览，确认公开首页仍未变化。
5. 上传一张图片和一个短视频，确认图片显示、视频拖动播放正常。
6. 首次发布后确认公开首页出现作品；发布前只能看到“网站尚未发布”。
7. 创建一张二维码，分别测试公开访问、二维码但不限制、二维码限制访问、次数耗尽和过期。
8. 确认其他邮箱不能进入后台，也不能调用 `/api/admin/*`。

## 运行时资源

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `DB` | D1 binding | 作品、所有者、访问凭证和记录 |
| `BUCKET` | R2 binding | 私有图片、字体和视频 |
| `EMAIL` | Send Email binding | 发送首次后台入口邮件 |
| `AUTH_PLATFORM` | Worker variable | 正式部署固定为 `cloudflare` |
| `CF_ACCESS_TEAM_DOMAIN` | secret | Access 签发域名 |
| `CF_ACCESS_AUD` | secret | Access 应用 Audience Tag |
| `ADMIN_EMAILS` | secret | 首次绑定允许邮箱 |
| `ADMIN_EMAIL_FROM` | secret | 已验证发件地址 |
| `MEDIA_SIGNING_KEY` | secret | 视频播放签名 |
| `ACCESS_SIGNING_KEY` | secret | 二维码访问签名 |
| `ANALYTICS_HASH_KEY` | secret | 匿名网络标识散列 |
