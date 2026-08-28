#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v zip >/dev/null 2>&1; then
  echo "缺少 zip 命令，无法生成部署包。" >&2
  exit 1
fi

output_dir="${1:-outputs}"
mkdir -p "$output_dir"
timestamp="$(date -u +%Y%m%d-%H%M%S)"
archive="$output_dir/zkyl-student-showcase-cloudflare-$timestamp.zip"

zip -q -r "$archive" . \
  -x '.git/*' \
  -x '.openai/*' \
  -x '.env*' \
  -x '.next/*' \
  -x '.sites-runtime/*' \
  -x '.wrangler/*' \
  -x 'cloudflare/.wrangler/*' \
  -x 'cloudflare-pages-dist/*' \
  -x 'dist/*' \
  -x 'docs/plans/*' \
  -x 'docs/specs/*' \
  -x 'node_modules/*' \
  -x 'outputs/*' \
  -x 'work/*' \
  -x '*.sqlite' \
  -x '*.sqlite-shm' \
  -x '*.sqlite-wal' \
  -x '*.tsbuildinfo'

printf '%s\n' "$archive"
