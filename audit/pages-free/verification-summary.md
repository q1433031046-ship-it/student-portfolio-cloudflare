# 免费v1.1验证和边界

本轮验证针对从618638872086fcee6e230351085eb4b922aa585a的执行位置增量。完整静态模板SHA256仍为2ff250c1321cad6f6d12f36274618c845cba164d890763d8ad133f40ab699f20；app/portfolio、static-site和完整静态后台卡片无差分。原候选四宽度、视频/字体/后台和动态独立发布证据继续见audit/pages，不重新宣称已做本轮视觉验收。

`state-verification.json`为真实本地workerd、D1、KV加本地GitHub/Pages夹具结果：安全快照在CI读取前脱私；run实际读回、签名/时窗/nonce/序列/租约；4MiB原始块；派发响应丢失一次POST；已用deployment在过期重跑后只读；相同回执幂等且冲突拒绝；Node预览/生产同manifest和控制字节；生产不重建模板；响应/回调丢失总创建2次；动态快照独立。849110字节中文快照分页、60KiB控制通过、66KiB拒绝；只读租约不能登记/部署/回执；意外私有字段使冻结事务回滚。

`node-protocol-verification.json`记录Node流式SHA256/base64与实际原始字节比对，0/1/2/3/1293044/26214400字节，原始源4MiB分块；25MiB+1发送前拒绝；部署503没有默认重试。

CPU：已做Windows真实workerd V8 Profiler，最终原始文件保留忽略目录.pages-workerd/cpu，摘要cpu-profile.json。首次最大活跃归因21.365ms，最后相关复测23.36ms；样本稀疏、调度空档，不能证明Free10ms余量，也不把它直接当平台计费CPU。INCONCLUSIVE / RELEASE_HOLD。按根与用户确认，停止重复本地采样，后续按cloud-validation-objects.md准确云端验证。默认测试不会启动Profiler。

热点代码位置：pages-free-freeze.ts只发送D1复制/抽取/脱私SQL，不读回完整文档；pages-admin-auth.ts和pages-store.ts仅小型身份/状态SELECT；pages-runner-auth.ts有界64KiB消息摘要/HMAC/JSON；pages-runner-state.ts和service.ts处理小型CAS/manifest页/回执；pages-raw-block.ts直接返回KV stream或固定R2 range。Worker活动发布路径不再导入模板、@noble/hashes或整文件base64/全量文件读回。重计算均在scripts/pages-runner.mjs及Node bundle的pages-client.ts。D1冻结SQL工作量仍随文档/媒体增长，不能据“放进SQL”保证平台免费预算。

本地产品构建、tsc、全量lint、Drizzle模型同步、dry-run与最终单测结果由候选检查回执记录。历史全量246项的37发布shell失败/3跳过保留，原生Linux入口已准备但未运行；macOS WebKit和真实Free/provider/真实内容/第二次正式更新仍未验收。

新workflow默认均为手动：pages-free-validate只跑本地夹具/检查、不带provider凭据；pages-publish才有经管理员阶段许可的真实发布能力，其远端登记、ref保护、凭据和接入都未执行。
