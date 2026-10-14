#!/usr/bin/env bash
set -euo pipefail
trap 'rm -rf .nps-test-dist' EXIT
npx esbuild worker/routes/api.ts --bundle --platform=node --format=esm --outfile=.nps-test-dist/api.mjs
npx esbuild shared/nps.ts --bundle --platform=node --format=esm --outfile=.nps-test-dist/parser.mjs
node --test tests/nps.test.mjs
