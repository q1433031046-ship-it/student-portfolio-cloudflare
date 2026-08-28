#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

wrangler=(npx --no-install wrangler)

read_required() {
  local prompt="$1"
  local value=""
  while [[ -z "$value" ]]; do
    read -r -p "$prompt" value
    value="${value//[$'\r\n']/}"
  done
  printf '%s' "$value"
}

npm run build
# 执行此脚本前，先在 Cloudflare Email Service 验证发件域名。
# 首次部署创建 Worker、D1 与 R2；未配置 Access 时管理接口保持关闭。
"${wrangler[@]}" deploy --config wrangler.jsonc --keep-vars
"${wrangler[@]}" d1 migrations apply DB --remote --config wrangler.jsonc

printf '\n首次部署已完成。现在请在 Cloudflare Zero Trust 中：\n'
printf '1. 为这个 Worker 的 /admin*、/api/admin*、/preview* 创建 Access 应用。\n'
printf '2. 登录方式选择 One-time PIN，Allow 策略只填写管理员邮箱。\n'
printf '3. 将全局与应用会话时间设为 15 分钟。\n\n'
read -r -p "完成后按 Enter 继续配置安全参数。" _

cf_access_team_domain="$(read_required 'Cloudflare Access Team Domain: ')"
cf_access_aud="$(read_required 'Cloudflare Access Audience Tag: ')"
admin_emails="$(read_required '不可更改的管理员邮箱: ')"
admin_email_from="$(read_required '已验证的发件地址（例如 admin@yourdomain.com）: ')"

printf '%s' "$cf_access_team_domain" | "${wrangler[@]}" secret put CF_ACCESS_TEAM_DOMAIN --config wrangler.jsonc
printf '%s' "$cf_access_aud" | "${wrangler[@]}" secret put CF_ACCESS_AUD --config wrangler.jsonc
printf '%s' "$admin_emails" | "${wrangler[@]}" secret put ADMIN_EMAILS --config wrangler.jsonc
printf '%s' "$admin_email_from" | "${wrangler[@]}" secret put ADMIN_EMAIL_FROM --config wrangler.jsonc

node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))' \
  | "${wrangler[@]}" secret put MEDIA_SIGNING_KEY --config wrangler.jsonc
node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))' \
  | "${wrangler[@]}" secret put ACCESS_SIGNING_KEY --config wrangler.jsonc
node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))' \
  | "${wrangler[@]}" secret put ANALYTICS_HASH_KEY --config wrangler.jsonc

"${wrangler[@]}" deploy --config wrangler.jsonc --keep-vars

echo "Cloudflare 资源与安全配置已完成。请打开网站根地址，完成首次邮箱绑定与入口邮件测试。"
