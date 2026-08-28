#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npm run build
npx --no-install wrangler d1 migrations apply DB --remote --config wrangler.jsonc
npx --no-install wrangler deploy --config wrangler.jsonc --keep-vars
