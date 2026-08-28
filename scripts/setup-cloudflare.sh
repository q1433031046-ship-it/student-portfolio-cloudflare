#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

wrangler=(npx --no-install wrangler)
initial_admin_code=""
while [[ ${#initial_admin_code} -lt 16 || ! "$initial_admin_code" =~ [A-Za-z] || ! "$initial_admin_code" =~ [0-9] ]]; do
  read -r -s -p "一次性部署口令（至少16位，包含英文字母和数字，不会显示）: " initial_admin_code
  printf '\n'
  initial_admin_code="${initial_admin_code//[$'\r\n']/}"
  if [[ ${#initial_admin_code} -lt 16 || ! "$initial_admin_code" =~ [A-Za-z] || ! "$initial_admin_code" =~ [0-9] ]]; then
    printf '口令不符合要求，请重新输入。\n' >&2
  fi
done

npm run build
"${wrangler[@]}" deploy --config wrangler.jsonc --keep-vars
"${wrangler[@]}" d1 migrations apply DB --remote --config wrangler.jsonc
printf '%s' "$initial_admin_code" | "${wrangler[@]}" secret put INITIAL_ADMIN_CODE --config wrangler.jsonc
unset initial_admin_code
"${wrangler[@]}" deploy --config wrangler.jsonc --keep-vars

printf '\n部署完成。请打开网站的 /admin，输入刚才的一次性部署口令，创建管理员密码并下载系统恢复码。\n'
