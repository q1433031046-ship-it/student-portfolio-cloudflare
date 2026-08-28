# 把项目交给 ChatGPT 部署

先打开 [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/q1433031046-ship-it/student-portfolio-cloudflare)。Cloudflare 会创建网站程序、D1 数据库和媒体空间，并运行部署。

部署页面需要填写 `INITIAL_ADMIN_CODE`：请自己设置一段至少16位、同时包含英文字母和数字的一次性部署口令，只在Cloudflare官方页面填写，不要发到聊天里。

完成后，把网站地址发给支持代码工作区和 Cloudflare 部署的 ChatGPT/Codex，并发送：

> 请读取项目里的 AGENTS.md 和 deployment/agent-manifest.json，帮我完成 Cloudflare 部署、数据库迁移和在线测试。需要账号授权时再叫我；管理员密码、一次性部署口令和系统恢复码由我自己在官方页面或网站后台输入，请不要向我索取。

你只需要完成四件事：

1. 在 Cloudflare 官方页面确认账号授权。
2. 在部署页面填写一次性部署口令。
3. 首次打开 `/admin`，再次输入这段口令并设置管理员密码。
4. 下载系统生成的恢复码，离线保存。

以后登录后台只用管理员密码。忘记密码时使用系统恢复码；恢复成功后旧码立即失效，并生成一份新码。

作品、图片、50 MB以内的MP4视频、二维码和发布都在网站后台操作。后台“概览”的最下方会显示网站空间的已用、剩余、文件数和大约还能放多少个50 MB视频。
