import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const obsoleteStudentFiles = [
  "START-HERE.md",
  "FINAL-DELIVERY.md",
  "UPGRADE-GUIDE.md",
  "docs/guides/student-cloudflare-setup.md",
  "deployment/DEPLOY-PROMPT.txt",
  "deployment/UPGRADE-PROMPT.txt",
  "app/guide/page.tsx",
  "app/admin/admin-guide-step-two.tsx",
];

test("no-negative-echo audit keeps one final tutorial flow", async () => {
  const [readme, agents, guide, audit, upgrade, enhancements, adminPage] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("AGENTS.md", "utf8"),
    readFile("app/admin/admin-guide-center.tsx", "utf8"),
    readFile("app/admin/admin-guide-ui-audit.tsx", "utf8"),
    readFile("app/admin/admin-upgrade-center.tsx", "utf8"),
    readFile("app/admin/admin-interaction-enhancements.tsx", "utf8"),
    readFile("app/admin/page.tsx", "utf8"),
  ]);

  for (const path of obsoleteStudentFiles) assert.equal(existsSync(path), false, `${path} should remain removed`);

  for (const phrase of [
    "先打开 GPT",
    "Cloudflare 一键部署",
    "INITIAL_ADMIN_CODE",
    "图片与视频建议尺寸",
    "程序升级",
  ]) {
    assert.match(readme, new RegExp(phrase));
    assert.match(guide, new RegExp(phrase));
  }

  assert.match(readme, /安全边界/);
  assert.match(readme, /完整复制部署引导语/);
  assert.match(readme, /默认 Power/);
  assert.match(readme, /High（高）/);
  assert.match(readme, /Extra High（超高）/);
  assert.doesNotMatch(readme, /最低模型：/u);
  assert.doesNotMatch(readme, /账号中需要能选择 GPT-5\.6 Sol/u);
  assert.match(readme, /不需要启用 R2/);
  assert.match(readme, /公共模板.*只声明.*DB.*MEDIA_KV.*不携带.*资源 ID/su);
  assert.match(readme, /不携带固定 database_name/u);
  assert.match(readme, /同一账号.*不得.*固定数据库名.*复用/su);
  assert.match(readme, /首次部署完成.*只读核对.*克隆仓库.*当前 Worker/su);
  assert.match(readme, /平台未写回.*停止.*不得猜测.*复用/su);
  assert.match(readme, /WRANGLER_CI_OVERRIDE_NAME.*有效 Worker 名/su);
  assert.match(readme, /局部截图/);
  assert.match(readme, /二维码.*访问链接/u);
  assert.doesNotMatch(readme, /页面整体截图/);
  assert.doesNotMatch(readme, /完整页面截图/);
  assert.match(readme, /桌面 16:9/);
  assert.match(readme, /媒体已上传，等待草稿保存/);
  assert.match(readme, /无害的只读检查/);
  assert.match(readme, /从刚才中断的步骤继续/);
  assert.match(readme, /管理员登录仍保持 12 小时/);
  assert.match(readme, /第一次静态发布成功前.*不显示固定二维码/su);
  assert.match(readme, /同一 Cloudflare 客户网络连续输错 5 次管理员密码/u);
  assert.match(readme, /其他网络不受影响/u);
  assert.match(readme, /错误恢复码不会触发密码登录锁定/u);
  assert.match(readme, /中文输入法按 Enter 选词时不会提前结束/u);
  assert.match(readme, /“调整裁切”/);
  assert.match(readme, /“联系方式”/);
  assert.match(readme, /暂停旧“限制访问”功能的所有写操作/u);
  assert.match(readme, /原设置、访问码、次数、到期时间和历史记录.*保留/su);
  assert.match(readme, /快速预览会先自动保存当前修改/u);
  assert.match(readme, /唯一 draft Deploy/u);
  assert.match(readme, /“重新核验”或“重试原发布任务”/u);
  assert.match(readme, /网站尚未发布/);
  assert.match(readme, /成稿视频（可选）/);
  assert.match(readme, /移除成稿视频/u);
  assert.match(readme, /新建作品.*保存草稿.*再上传/su);
  assert.match(readme, /新建分类.*保存草稿.*再上传/su);
  assert.match(readme, /独立浏览器配置文件或独立 Cookie/u);
  assert.match(readme, /大陆.*人工/u);
  assert.match(readme, /宽屏.*右上角.*手机后台.*底部操作栏.*更多/su);
  assert.match(readme, /R2 → MEDIA_KV/);
  assert.match(readme, /“开始逐块迁移并校验”/);
  assert.match(readme, /原 R2 对象.*ETag/su);
  assert.match(readme, /最终 KV 复验/u);
  assert.match(readme, /final-verifying/u);
  assert.match(readme, /configuredWorkersDevEnabled/u);
  assert.match(readme, /远端 workers\.dev 开关.*人工基线/su);
  assert.match(readme, /隔离工作树/u);
  assert.match(readme, /脚本会把 Wrangler 的运行目录固定为已验证标签工作树根目录/u);
  assert.match(readme, /纯 v1\.0 R2-only.*本版本未支持/su);
  assert.match(readme, /不得创建、复用或认领.*MEDIA_KV/su);
  assert.match(readme, /记录原分支和 commit.*没有未提交改动/su);
  assert.match(readme, /禁止 force checkout、reset --hard/u);
  assert.match(agents, /untouched v1\.0 R2-only install.*not supported/su);
  assert.match(readme, /upgrade-predeploy-fingerprint\.json/u);
  assert.match(readme, /npm run deploy.*首次部署/su);
  assert.match(readme, /0600.*只捕获一次.*跨失败续跑/su);
  assert.match(readme, /学生要做的 8 步[\s\S]*8\..*R2 → MEDIA_KV[\s\S]*对照升级前基线/u);
  assert.doesNotMatch(readme, /本次 v1\.2\.0 先完成桌面端封底流程，手机端专项适配留到后续版本/u);
  assert.doesNotMatch(readme, /不是短信、邮件或手机系统推送/u);
  assert.match(guide, /在 ChatGPT 里具体怎么点/);
  assert.match(guide, /默认 Power/);
  assert.match(guide, /High（高）/);
  assert.match(guide, /Extra High（超高）/);
  assert.doesNotMatch(guide, /最低配置/u);
  assert.match(guide, /不需要启用 R2/);
  assert.match(guide, /公共模板.*只声明.*DB.*MEDIA_KV.*不携带.*资源 ID/su);
  assert.match(guide, /不携带固定 database_name/u);
  assert.match(guide, /首次部署完成.*只读核对.*克隆仓库.*当前 Worker/su);
  assert.match(guide, /没有写回.*停止.*不得猜测.*复用/su);
  assert.match(guide, /WRANGLER_CI_OVERRIDE_NAME.*有效 Worker 名/su);
  assert.match(guide, /桌面 16:9/);
  assert.match(guide, /媒体已上传，等待草稿保存/);
  assert.match(guide, /防止反复授权/);
  assert.match(guide, /从中断步骤继续/);
  assert.match(guide, /管理员登录仍为 12 小时/);
  assert.match(guide, /同一 Cloudflare 客户网络连续输错 5 次管理员密码/u);
  assert.match(guide, /其他网络不受影响/u);
  assert.match(guide, /错误恢复码不会触发密码登录锁定/u);
  assert.match(guide, /中文输入法按 Enter 选词时不会提前结束编辑/u);
  assert.match(guide, /“调整裁切”/);
  assert.match(guide, /“联系方式”/);
  assert.match(guide, /暂停旧限制访问功能的写入/u);
  assert.match(guide, /原设置、访问码、次数、到期时间和历史记录全部保留/u);
  assert.match(guide, /快速预览会先自动保存当前修改/u);
  assert.match(guide, /一个 Netlify draft Deploy/u);
  assert.match(guide, /“重新核验”和“重试原发布任务”/u);
  assert.match(guide, /网站尚未发布/);
  assert.match(guide, /成稿视频（可选）/);
  assert.match(guide, /移除成稿视频/u);
  assert.match(guide, /新建作品.*保存草稿.*再上传/su);
  assert.match(guide, /新建分类.*保存草稿.*再上传/su);
  assert.match(guide, /独立浏览器配置文件或独立 Cookie/u);
  assert.match(guide, /大陆.*人工/u);
  assert.match(guide, /宽屏.*右上角.*手机.*底部操作栏.*更多/su);
  assert.match(guide, /R2 → MEDIA_KV/);
  assert.match(guide, /“开始逐块迁移并校验”/);
  assert.match(guide, /原 R2 对象.*ETag/su);
  assert.match(guide, /最终 KV 复验/u);
  assert.match(guide, /学生要做的 8 步[\s\S]*完成旧媒体并对照基线[\s\S]*R2 → MEDIA_KV/u);
  assert.match(guide, /隔离工作树/u);
  assert.match(guide, /Wrangler.*运行目录固定在已验证标签工作树根目录/u);
  assert.match(guide, /纯 v1\.0 R2-only.*本版本未支持/su);
  assert.match(guide, /记录原分支和 commit.*未提交改动/su);
  assert.match(guide, /data-admin-tools/);
  assert.match(guide, /portfolio:open-upgrade/);
  assert.match(guide, /在 GitHub 打开完整指南/);
  assert.doesNotMatch(guide, /打开同版指南/u);
  assert.match(upgrade, /addEventListener\(OPEN_UPGRADE_EVENT/);
  assert.match(upgrade, /program-upgrade-center/);
  assert.match(upgrade, /data-native-upgrade-center/);
  assert.doesNotMatch(upgrade, /data-program-upgrade-center/u);
  assert.match(upgrade, /默认 Power/);
  assert.match(upgrade, /final-verifying/);
  assert.match(upgrade, /隔离工作树/u);
  assert.match(upgrade, /Wrangler.*运行目录固定在已验证标签工作树根目录/u);
  assert.match(upgrade, /纯 v1\.0 R2-only.*本版本未支持/su);
  assert.match(upgrade, /未提交改动.*可恢复保存/su);
  assert.doesNotMatch(enhancements, /ensureUpgradeCenter|data-program-upgrade-center/u);
  assert.match(enhancements, /if \(!fieldLabel\) return null/u);
  assert.match(adminPage, /AdminGuideUiAudit/);
  assert.doesNotMatch(adminPage, /AdminGuideStepTwo/);
  assert.match(audit, /GitHub 完整指南/);
});

test("tutorial overlay remains usable on narrow screens and by keyboard", async () => {
  const audit = await readFile("app/admin/admin-guide-ui-audit.tsx", "utf8");

  assert.match(audit, /data-admin-tools/);
  assert.match(audit, /data-kind="guide"/);
  assert.match(audit, /data-kind="upgrade"/);
  assert.match(audit, /@media\(max-width:720px\)/);
  assert.match(audit, /content:"教程"/);
  assert.match(audit, /content:"升级"/);
  assert.match(audit, /aria-labelledby/);
  assert.match(audit, /adminMain\.inert = true/);
  assert.match(audit, /event\.key !== "Tab"/);
  assert.match(audit, /opener\?\.focus/);
});
