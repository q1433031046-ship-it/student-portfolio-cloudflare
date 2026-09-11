export const STATIC_CLOUD_WORK_PROMPT = `请在本网站原网页版云端 Work 项目中，核对原 Cloudflare Pages 配置并准备完整静态网站包。复用当前已经授权且实际可用的 GitHub/Cloudflare连接和管理员登录；不要创建学生任务、资源、付费项目或恢复自动发布，不索取聊天明文秘密。
先确认这是本站原账号、仓库、Worker与Pages项目，读取本站PAGES_ACCOUNT_ID、PAGES_PROJECT_NAME、STATIC_SITE_URL及已有pages_site的一致性。配置正确不写，缺失只补已证实的本站实际值；多个候选或冲突集中交本人确认。API Token不等于管理员密码或恢复码，不绕过后台鉴权。
保留未保存编辑。推荐等待媒体完成→保存草稿→发布动态前台→下载静态ZIP→原Pages上传；动态发布是双站同步推荐顺序，不是打包代码前置。不要擅自修改内容、删除/转码媒体、重放迁移。
在已有管理员会话读取/api/admin/static-package?revision=实际版本，核定模板身份并取得完整模板与清单媒体。浏览器可交付下载时使用原下载入口；否则用准确源码的node scripts/package-manual-static.mjs --description 实际描述文件 --template 实际模板文件 --media-dir 实际媒体目录 --out-dir 新输出目录。参数由你解析真实文件，不让用户猜填。脚本只离线打包，输出ZIP、site目录和package-receipt.json，不登录、不发布。下载完再从原会话读取同revision的check=1，变化则保留包但不能标READY。
25–50MiB MP4会原字节分块，单块最多16MiB，不降低画质；静态播放器完整收齐后播放。HTTPS传输保护及隐藏下载入口不是DRM。不得忽略缺块或静默删媒体。
回执核对完整文件数、大小、摘要、本站后台链接及无秘密。网页上传ZIP/目录最多1000文件且每文件25MiB；Wrangler上传site目录最多20000文件，不接受ZIP。先核原Pages项目类型，Git集成项目不能网页拖拽。包完整与网页可上传分别报告，超限不删文件。
交付用户实际可下载的ZIP/目录、摘要回执、原项目上传页及固定网址；工具不能交付附件时明确指出。只有实际上传完成并读回网页才称已发布；ZIP、配置或二维码不能证明上线。失败先查原结果，写入回执不明不重发；网络失败不当令牌失效。工具权限、验证码、隐藏输入或安全确认等必须本人动作，在其余准备完成后一次集中交接。`;
