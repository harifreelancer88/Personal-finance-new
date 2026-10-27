#!/usr/bin/env bash
set -euo pipefail
trap 'rm -rf .kite-test-dist' EXIT
npx esbuild worker/routes/zerodha.ts worker/lib/kite.ts worker/lib/backup-registry.ts src/components/investments/ZerodhaSync.tsx --bundle --platform=node --format=esm --jsx=automatic --external:react --entry-names=[name] --outdir=.kite-test-dist --out-extension:.js=.mjs
node --test tests/zerodha.test.mjs
