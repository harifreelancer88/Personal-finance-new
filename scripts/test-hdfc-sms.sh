#!/usr/bin/env bash
set -euo pipefail
trap 'rm -rf .hdfc-sms-test-dist' EXIT
npx tsc --ignoreConfig worker/lib/sms-parser.ts --module esnext --moduleResolution bundler --target es2022 --outDir .hdfc-sms-test-dist --skipLibCheck
npx esbuild worker/routes/sms-ingestion.ts --bundle --platform=node --format=esm --outfile=.hdfc-sms-test-dist/ingestion.mjs
node --test tests/hdfc-sent-sms.test.mjs
