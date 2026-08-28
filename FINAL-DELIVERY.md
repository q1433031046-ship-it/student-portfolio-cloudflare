# 学生作品展示：最终交付

这是给学生的正式入口页。不要下载 ZIP，不要手动上传源码。

## 学生只需要记住这一句话

**先打开 GPT，不要自己先部署。**

## 第一步：打开 GPT

最低使用 GPT-5.6 Sol，思考程度选择“高”。遇到部署失败、资源绑定、数据库迁移、版本升级或账号串号时改成“超高”。

把 `deployment/DEPLOY-PROMPT.txt` 里的全部文字复制给 GPT。

GPT 会先确认当前 GitHub 和 Cloudflare 登录身份，再带你打开官方部署页面。

## 第二步：官方一键部署

Deploy to Cloudflare：

https://deploy.workers.cloudflare.com/?url=https://github.com/q1433031046-ship-it/student-portfolio-cloudflare

同一个 GPT 账号可以帮助不同学生部署，但每次都必须切换到当前学生自己的 GitHub / Cloudflare 账号。

同一个 GitHub / Cloudflare 账号也可以部署多个网站，但每个网站必须使用独立仓库、Worker、D1、MEDIA_KV、网站地址、管理员密码和恢复码。

## 第三步：第一次进入后台

打开部署后的网站 `/admin`，使用一次性部署口令创建管理员密码，并下载系统恢复码。

管理员密码、一次性部署口令、恢复码只由本人输入，不要发送给 GPT。

输入正确管理员密码后，这台浏览器会保持登录 12 小时；12 小时内再次点“管理”通常直接进入后台。点击“安全退出”后立即失效。连续输错 5 次密码会锁定 15 分钟。

## 第四步：后台检查

确认以下内容正常：

- 网站空间；
- 程序升级中心；
- 图片上传与裁切；
- MP4 上传、播放和拖动；
- 草稿保存与快速预览；
- 正式发布；
- 二维码访问设置；
- 安全退出后重新进入需要密码。

## 以后升级

在后台“程序升级中心”复制升级指令给 GPT。升级只更新程序和增量数据库迁移，不重新创建 Worker、D1 或 KV，也不删除管理员、图片、视频、草稿、已发布内容或二维码。

## 完整说明

- 快速开始：`START-HERE.md`
- 完整学生指南：`docs/guides/student-cloudflare-setup.md`
- GPT 部署引导语：`deployment/DEPLOY-PROMPT.txt`
- GPT 升级引导语：`deployment/UPGRADE-PROMPT.txt`
- 程序升级规则：`UPGRADE-GUIDE.md`
