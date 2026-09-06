# 拟议接入与双站回滚对象

本文件是角色3准备的本地可审对象，**未执行**，不授予远端Git、OAuth、Secret、数据库或发布写入。

## 固定目标及写前核验

复用Pages项目zkyl-student-showcase，production_branch=main，固定网址https://zkyl-student-showcase.pages.dev。Worker为student-portfolio，DB/MEDIA_KV必须复用该Worker当前准确绑定。来源为根任务2026-09-06T10:20:27.105Z只读盘点，不是本轮实时provider核验。

执行前冻结当前账号、项目GET、生产deployment完整ID及状态、Worker当前100%版本完整ID、模块/资源/绑定/变量/Secret名称集合。历史Pages回滚线索是https://d49a2958.zkyl-student-showcase.pages.dev；短网址不是完整deployment ID。历史Worker回滚线索为v92；必须从已有冻结证据并经当前GET确认完整version ID，不能仅凭v92昵称执行。任一身份或资源漂移停止，不使用其他账号/站点补齐。

## 凭据和配置

- PAGES_ACCOUNT_ID：以上既有Pages项目的准确账号ID，隐藏渠道配置；项目名固定存pages_site，不由浏览器请求提交。
- PAGES_API_TOKEN：仅所需账号的Cloudflare Pages编辑/读取能力，经官方权限界面核定。代码仅调用唯一固定项目及Pages资产端点；不能声称API令牌本身已具备项目级隔离。该令牌不需要Workers脚本、D1、KV或账户资源删除权限，不进入聊天、仓库、静态制品或日志。
- WORKER_PUBLIC_ORIGIN：原Worker实际HTTPS根网址，不猜测workers.dev账号子域。静态模板管理入口仅生成该原网址/admin，不带凭据。
- 现有DB、MEDIA_KV、AUTH_PLATFORM及其他业务绑定/Secret值保持。配置新变量/Secret和程序升级属于后续准确写入对象，需要适用授权。此候选提供的wrangler.jsonc仍为无账号ID的通用模板，不可直接当作现网站点配置使用。
- 用户已确认免费套餐。当前整文件hash/base64步骤尚未证明符合免费CPU预算，接入保持阻断。没有付费升级或CPU设置写入授权；本地墙钟不作为线上CPU证据。需要在免费约束下完成技术适配及独立核验。

## 数据库对象

只正常应用尚未存在的前向迁移：0008_static_site_publish.sql、0009_pages_dual_publish.sql、0010_pages_readback_progress.sql；逐一核对drizzle账本及规范化LF后的SHA256，准确摘要在deployment/agent-manifest.json。0008为来源中既有完整静态功能表，现网可能已应用，禁止重复ALTER。新DDL不加入runtimeSafeBootstrapMigrations；列表权限失败、迁移失败或未知pending集合均停止。

站点行拟议初始化SQL为deployment/pages-site-init.sql。它只在不存在default行时插入上述唯一项目；已有行不同必须停止，不能自动覆盖。执行后GET查询逐项核对project/production_branch/production_url，初始public_revision=0、current_job/current_deploy均为空。无线上内容、媒体、历史任务清理SQL。

## 发布和验收顺序

1. 正式新版本/tag仍未创建。先明确并独立审查准确Candidate与完整验证缺口；历史v1.3.0/v1.3.1-b tag不包含本次候选，不运行历史升级指令。
2. 获准后完成准确迁移和绑定设置，再升级同一Worker；已有Worker版本和资源为单独回滚对象。真实上线需完整模块、ASSETS、metadata对象及写前后基线，不使用开发默认资源ID或旧PR39载荷。
3. 本人/获准执行者使用既有管理员入口：保存真实内容，验证动态发布；生成静态预览，逐项核对真实图片/视频/字体/内容，再明确发布到Pages固定网址。静态生产与程序升级是两个写入对象。
4. 从当前固定网址逐文件读回冻结摘要及provider canonical_deployment。再做同固定网址第二次真实更新。此处尚未执行；本地模拟两次更新不替代它。静态未知不得重新创建生产部署。

## 两个独立回滚

**Worker程序回滚**：使用写前已冻结并当前GET确认的完整原version ID和原流量分配恢复，读回模块/资源/绑定/入口。DB迁移保留前向兼容表，不反向删表或改用户内容。Worker回滚不代表Pages固定站已回滚。

**Pages站点回滚**：使用写前已冻结的原生产deployment完整ID，或任务pages_site.previous_deploy的已验证生产ID；provider官方rollback操作的准确对象和响应读回须另行冻结审查。不得传preview ID、短域名前缀或旧Netlify ID。读回原生产文件摘要及canonical_deployment后，仅以CAS交换pages_site的current/previous job/deploy指针，公开序号按最终恢复策略明确记录；不写portfolio_documents.published_json。首次替换Demo时previous_job可能为空，此时回滚Demo后本地current_job/current_deploy应按已核定旧基线恢复为空，Worker根页恢复动态展示。Pages回滚不代表Worker程序已回滚。

回滚API载荷还缺当前完整provider ID，属于后续实时准确对象准备，不能伪造或立即执行。账号/Secret/Netlify远端项目删除均不在本文件范围。
