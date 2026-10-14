#!/usr/bin/env bash
set -euo pipefail
trap 'rm -rf .investment-ledger-test-dist' EXIT
npx esbuild worker/routes/api.ts --bundle --platform=node --format=esm --outfile=.investment-ledger-test-dist/api.mjs
node --test tests/investment-ledger.test.mjs
