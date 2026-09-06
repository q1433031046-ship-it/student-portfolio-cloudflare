# 上传配置互斥字段修正

Plan ID：PLAN-20260906-NETLIFY-RUNTIME-REDIRECT-001。补充版本：1.2。角色：1。适用原方案 v1.1 及同一 PR #39，仅覆盖实际 HTTP 400 暴露的上传配置错误。

## 实际失败与责任

2026-09-06 09:46:49.929–09:46:55.377 UTC，角色4按批准对象发出唯一 PUT，curl exit0，HTTP400，success=false，错误10021：`serve_directly and run_worker_first must not be simultaneously specified`。旧 multipart SHA256 为53c50d70a5bab37cccdffd0e2690364691f9fa3cd22b8676277541af36ed3eff。旧尝试资格已经消耗，旧标记、载荷、脚本和审计均保留，不删除或重置。

这是本次准备及审计遗漏了两个资产路由字段互斥条件，不能把它解释成登录失败或原Netlify请求根因有误。角色4继续只读核定实际现网，不因HTTP400直接推断没有任何变化。

## 唯一修正

新metadata仅删除 `assets.config.serve_directly: true`，保留 `assets.config.run_worker_first: false` 和原125字节 `_headers`。删除属性必需的逗号/换行调整以外，保持原metadata编码、格式及所有其他字节。不变对象直接复用已审哈希：模块dc46ce87f68ef1c91411c8f8efc265f8ac931ca63882ecdcf534457b8eb97f97，辅助headers9e55124bccd40b43dbc6e002daa777fa8f32a230420152910784ca65501d9e0f；8个固定v92绑定继承、keep_assets、无jwt、兼容设置、observability及其他metadata字段均不变。

依据：当前[官方PUT schema](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)把serve_directly标为deprecated，描述true为命中资产优先、false为Worker优先；run_worker_first描述true为Worker优先。固定官方[createWorkerUploadForm](https://github.com/cloudflare/workers-sdk/blob/8bbcb9f08bcfaa291c7d28b6884fc88c1264bb84/packages/deploy-helpers/src/deploy/helpers/create-worker-upload-form.ts#L90)实际生成assets.config时采用run_worker_first，不生成serve_directly。原两个相反布尔值表达同一资产优先意图，选择当前字段保留意图；实际互斥限制由本次provider返回明确证实。仍须写后读回有效配置及资产，不能仅靠字段名推断发布成功。

## 实施与有界核验

角色2先审此补充范围与字段等价说明；角色3随后在新目录 `role3-netlify-runtime-redirect-fix-20260906/private-request-v2` 生成修正metadata、完整multipart及准确manifest。使用原multipart边界、原模块及辅助headers，按实际长度重新计算offset和所有摘要。独立反向解析必须恰3part；新旧metadata解析后的唯一区别是删除serve_directly；multipart中其余两个part逐字节相等。拒绝出现jwt、新资产内容或其他配置差异。无需重跑不变产品的22项运行验证或重建产品。

角色3从已审主传输脚本复制到新文件 `role4-netlify-runtime-hotfix-send-once-v2-20260906.ps1`，只允许改根目录到private-request-v2、准确manifest/body长度及摘要，另加“必须存在新的单次提交许可”的明确人工开关 `-NewAttemptApproved`。保持原 `-ExecuteApproved`，两者都未提供时不得执行。禁止改动认证、固定curl、stdin、TLS、禁重定向/重试、文件锁和CreateNew语义。新目录中的独立marker负责新的请求，原目录已用marker继续保留。增加开关仅是防误调用，不以它冒充用户许可。

角色3同步同一既有审计分支/PR #39 中必要的摘要、补充方案与来源说明，以新准确Head/Tree/Base冻结；非强制推进，不merge/tag/main，不改变provider构建触发范围。可以沿用同一PR留痕授权，仍需写前只读确认未发生触发配置漂移。角色2只审此次metadata/载荷/脚本/记录增量，正式评论准确新Candidate并读回；旧Candidate及旧载荷的PASS不得用于新请求。

## 新的提交边界

原已审最多一次PUT已用完。本补充方案、准备和审计不恢复其资格，不授权第二次provider写入。准确结果完成后由角色1将“仅去掉旧互斥字段、同目标新载荷、最多再一次PUT、原条件回滚”呈给用户，取得这一次新的提交确认才交角色4。这样确认是对完整可审核结果的最后一步，不再重复索取登录或不变产品授权。

获具体新确认后，新请求最多一次PUT；失败或未知均只GET、不重发、不得再增加新marker。执行前确认原v92/100%、完整原模块/8绑定及资源、相关设置仍与基线一致，新准确文件hash、curl、凭据及两个独立尝试标记状态正确。若原400导致变化或出现其他漂移，停止并先解释实际状态，不套用本方案。

回滚沿用原已审准确v92/100%对象及未使用的独立一次POST资格：新PUT确定生效，真实主站/绑定/资产回归，当前部署属于本次修正且v92可回滚，全部证据成立才执行。未知或仅静态发布失败不回滚。旧主PUT被拒收不触发回滚。无业务数据/Secret/域名修改。正式失败及后续执行回执均留同一PR并精确读回。

## 验收和治理位置

代码生效以官方完整模块hash dc46、准确新部署读回为准；主站/登录入口、已知JS/CSS长度hash及缓存、有效资产设置和8绑定资源引用逐项对照。静态发布测试仍由用户操作，助手不点击发布/重试/核验/提升或发送Hook。

当前角色：1。当前状态：原单次PUT被拒绝，补充范围待独立审计。标准路径：1→2方案→3准确对象→2增量审计→用户确认新单次提交→4执行验收。当前所在位置：实际错误已明确，正在收敛一个上传属性。最低剩余主步骤：4（方案核对、准确对象、增量审计、新许可后执行）。下一步/下一角色：2仅审此补充方案。推荐思考程度：极高。原因：产品不变且错误具体，审计集中于唯一配置差异及已消耗尝试预算，不重复不变验证。
