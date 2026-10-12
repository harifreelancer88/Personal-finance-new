#!/usr/bin/env bash
set -euo pipefail
trap 'rm -rf .sms-ingestion-test-dist' EXIT
npx esbuild worker/routes/sms-ingestion.ts --bundle --platform=node --format=esm --outfile=.sms-ingestion-test-dist/ingestion.mjs
node --test tests/sms-ingestion.test.mjs
