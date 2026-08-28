# 学生作品展示：先找 GPT，再部署

不要自己先打开 Cloudflare。正确顺序是：**先进入 GPT → 复制部署引导语 → 由 GPT 检查账号 → GPT 再给你一键部署链接。**

## 1. 先准备账号

请准备 ChatGPT、GitHub、Cloudflare 三个能正常登录的账号。尽量使用同一个常用邮箱，减少记错登录方式的概率。Google/Gmail 不是强制，但如果平时习惯用 Google 登录，可以继续使用。

建议使用桌面版 Chrome 或 Edge，手机放在旁边用于验证码或二步验证。

## 2. GPT 配置

- 最低模型：GPT-5.6 Sol
- 默认思考程度：高
- 部署失败、资源绑定、数据库迁移、版本升级或复杂报错：超高

然后打开 `deployment/DEPLOY-PROMPT.txt`，把里面整段文字复制给 GPT。

## 3. GPT 会先检查账号

GPT 必须先确认当前浏览器登录的是谁的 GitHub、谁的 Cloudflare，以及这是这个 Cloudflare 账号里的第几个作品集网站。

同一个 GPT 账号可以帮助不同学生部署，但 GitHub 和 Cloudflare 必须切换到当前学生自己的账号。上一位学生的托管账号还登录着时，不能继续。

同一个 GitHub/Cloudflare 账号也可以部署多个网站，但每个网站必须有独立仓库、Worker、D1、MEDIA_KV、网站地址、管理员密码和恢复码。

## 4. 再由 GPT 给你一键部署链接

官方入口：

[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/q1433031046-ship-it/student-portfolio-cloudflare)

Cloudflare 会创建网站程序，并为新站点配置 D1 数据库和 MEDIA_KV 媒体空间。部署页面需要填写 `INITIAL_ADMIN_CODE`：请自己设置至少16位、同时包含英文字母和数字的一次性部署口令，只在 Cloudflare 官方页面填写，不要发到聊天里。

## 5. 第一次进入后台

部署完成后打开网站的 `/admin`：

1. 输入刚才的一次性部署口令；
2. 创建以后日常使用的管理员密码；
3. 下载系统生成的恢复码并离线保存。

管理员密码、一次性部署口令和恢复码都不要发给 GPT。

## 6. 为什么有时点“管理”不需要重新输密码

第一次输入正确管理员密码后，这台浏览器会保持登录 12 小时。12 小时内再次从前台点“管理”，通常会直接进入后台，这是正常的。

点击右上角“安全退出”后，登录状态立即失效；下次进入必须重新输入密码。连续输错 5 次密码，后台会锁定 15 分钟。

## 7. 后台主要功能

作品、图片、50 MB以内 MP4 视频、二维码、发布都在后台操作。`概览`最下方会显示“网站空间”和“程序升级中心”。

完整零基础说明见：`docs/guides/student-cloudflare-setup.md`。
