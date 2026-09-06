# 云端验证可审对象

本文件随免费v1.1新Candidate冻结。状态LOCAL_IMPLEMENTED / RELEASE_HOLD；尚未推送、登记workflow、运行远端CI、写Secret、迁移或上传/部署。准确Head/Tree及本地构建文件摘要由同目录候选回执在提交后给出，不能用旧6186388或历史tag代替。

## 原生Linux只验证入口

`.github/workflows/pages-free-validate.yml`仅workflow_dispatch，标准ubuntu-latest，contents:read，无Secrets、provider凭据或部署步骤。准确已审ref的Git对象和默认分支workflow登记是后续独立远端Git对象，当前未落地；该ref须读回与新Candidate Head/Tree一致。

任务先从固定公开仓库按GITHUB_SHA获取准确提交，执行npm ci、npm test（一次产品build、全量单测、新Node/workerd夹具与25MiB协议）、npm run lint、tsc、Drizzle无变化检查、Wrangler `deploy --dry-run`。`dry-run`只产出本地模块，不访问真实发布资源。夹具使用独立内存D1/KV和本地Pages/GitHub模拟，不读取真实用户内容。没有内容artifact/cache，未添加更大型runner或付费CPU设置。

Linux运行将直接核定Windows上的37项发布shell失败是否仍存在；现仍37失败/3跳过，不能提前写绿。macOS WebKit继续沿用未验收状态，不在本轮增量中冒充完成。Linux纯夹具PASS也不能代替Cloudflare计费CPU实测。

## 实际Free Worker预览实验

目标仍为既有student-portfolio Worker、zkyl-student-showcase Pages、原DB/MEDIA_KV及当前所有必要业务绑定。当前仓库wrangler.jsonc是通用模板，没有真实resource ID，不能直接用于现网上传。准备的产品文件为dist/server与dist/client以及本地dry-run包，逐文件摘要随候选留证；真正上传还须基于当次官方GET冻结完整metadata/模块/ASSETS载荷，不能复用旧PR39载荷。

优先核验同Worker的不可变Version Preview URL能力。如现有账户/脚本允许新Version附带预览URL且不创建production Deployment，则可以让原100%生产版本保持，Actions仅访问新版本的预览URL。须先官方只读核对版本预览开关、URL形式、资源绑定和该URL可访问/admin及/api/pages-runner；本地尚不能证明账号已启用。需要额外启用设置时另列准确对象，不自行打开。若无法取得可信的零流量Version Preview，停止并由角色1另行呈现准确小范围线上测试，不自动切换生产流量。

**流量可以在满足上述条件时隔离，数据并非完全隔离。** 同版本预览使用原DB/KV绑定时，D1前向迁移、pages_site初始化及pages_jobs/pages_files/pages_runner_*测试记录会写入原DB。原文档草稿/动态快照、媒体字节及历史记录不改；新任务的冻结引用会保护媒体，不能删除历史任务来清理。实验用既有已保存修订，不为了测试编辑内容或触发动态发布。

准确数据库清单：正常应用尚未入账的0008、0009、0010、0011；每文件LF摘要在deployment/agent-manifest.json，新增0011仅创建3张runner状态表。先读迁移账本，已有项不重复执行；未知pending、权限失败、摘要不符立即停止。deployment/pages-site-init.sql仅插入缺失default行；已有行不同停止。其影响不等于线上已批准或已应用。

Worker新增配置对象：PAGES_GITHUB_TOKEN（仅固定仓库Actions:write，含必要读回）、PAGES_RUNNER_HMAC_KEY（专用至少32字符隐藏密钥）、PAGES_RUNNER_HEAD（准确新Head）、PAGES_RUNNER_REF（保护后的准确已审ref）、PAGES_RUNNER_TEMPLATE_SHA（2ff250c1321cad6f6d12f36274618c845cba164d890763d8ad133f40ab699f20）。WORKER_PUBLIC_ORIGIN保留真实原后台网址；程序不使用旧Worker PAGES_API_TOKEN，当前不删除旧Secret。新增Secret/变量怎样进入准确新Version需单独冻结元数据，不直接调用会隐式部署的Secret命令。

Actions隐藏对象：PAGES_RUNNER_HMAC_KEY与Worker专用值一致；PAGES_API_TOKEN为既有账号Pages编辑/读取，代码固定项目，不宣称token本身项目级限制。Actions变量PAGES_ACCOUNT_ID为准确既有账号；PAGES_WORKER_ORIGIN实验时设为上述新Version不可变预览URL。配置它是一个准确外部写对象，实验后恢复值也要冻结；不得记录真实值到公开仓库。密钥由隐藏渠道配置，不在本地生成真实密钥。

`.github/workflows/pages-publish.yml`仅workflow_dispatch，固定仓库、标准ubuntu-latest。Worker冻结source head/ref/template；首次claim官方GET检查真实run/workflow/path/head/ref/event/attempt/repository/display_title标记。传入jobId/phase/marker不能单独授予数据或正式发布资格。默认分支登记与保护后的执行ref均须正式读回。

实验动作先限一次静态预览：在新Version /admin以既有账号登录，读取现有草稿修订，生成一个FROZEN任务并一次派发preview；Node装配、分页登记、资产上传、领取唯一preview deployment许可、创建非生产Pages部署及完整字节/控制响应头读回。记录Actions run/attempt、各Worker请求CPU和错误、Pages非生产deployment完整ID/URL、冻结包摘要。预览不得触发production phase，不点击正式发布，不改Pages固定站点或portfolio_documents.published_json。

Free实际验收读取平台请求CPU/超限错误及对应job/phase/op时间窗，分开记录freeze、claim、60KiB控制、4MiB块出口、manifest登记、permit和receipt。不能把本地Profiler样本、请求墙钟或CI成功当成Free10ms证明。按真实现有10图1视频/约1.23MiB最大视频开始，25MiB已由本地协议验证；如需真实扩大测试媒体，先形成额外准确内容对象。

## 停止和恢复

任何身份、head/ref/template、原资源/版本漂移，私有字段、4MiB块身份/长度变化、清单不完整、Free CPU超限、鉴权失败或不可唯一核定回执均停止。所有dispatch、rerun和deployment先持久记录尝试；网络未知只查原run/deployment，不能把新的Actions运行当作新的生产许可。

若新Version预览实验不改变生产流量，停止该实验即可保持原100%版本；保留新Version、Pages预览和DB证据，不自动删除。若前置配置已经影响现有Worker，回退对象必须是写前官方GET冻结的完整版本ID、原流量比例和绑定/变量/Secret名称集合，不能只写v92昵称；数据库维持前向兼容，不反向删表。Secret原值不回显，需要恢复时只由原隐藏渠道完成准确操作。

Pages正式站在预览实验中不应改变；写后必须GET确认canonical deployment仍等于写前完整ID。任何意外变化立即停止并另行核定准确旧生产deployment回滚，不把Worker回滚视为Pages回滚。正式推广和第二次更新属于预览验收后单独许可与精确对象，本文件不授予它们。
