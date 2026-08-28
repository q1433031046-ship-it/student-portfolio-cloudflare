# 把这个压缩包交给 ChatGPT

这个项目面向没有代码经验的网站所有者。优先打开 [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/q1433031046-ship-it/student-portfolio-cloudflare)；Cloudflare会自动创建Worker、D1数据库和R2存储桶并运行部署。完成后把网站地址发给支持文件操作和Cloudflare部署的ChatGPT/Codex，然后发送下面这句话：

> 请读取项目里的 AGENTS.md 和 deployment/agent-manifest.json，继续完成我的 Cloudflare 网站配置。默认使用 workers.dev 地址和空白正式数据；需要我授权、确认邮箱或查收验证码时再叫我，其他步骤请你完成，并在部署后执行全部在线测试。

接下来你只需要配合四件事：

1. 在 Cloudflare 官方页面确认账号授权。
2. 告诉 AI 哪个邮箱作为唯一管理员。
3. 在 Cloudflare 验证一个用于发送后台链接的发件地址。
4. 查收登录验证码，并确认首次绑定邮件已收到。

不要把 Cloudflare 密码、邮箱密码、API Token 或浏览器 Cookie 发给 AI。如果当前 ChatGPT 只能聊天、不能操作文件或连接 Cloudflare，它无法完成部署；请改用具备代码工作区和 Cloudflare 连接能力的 ChatGPT/Codex。

首次部署完成后，作品、图片、视频、二维码和发布都在网站后台操作，不需要再次处理代码。以后只有升级网站程序时，才把新版部署包继续交给 AI。
