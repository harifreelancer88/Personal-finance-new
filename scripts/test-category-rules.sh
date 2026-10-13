#!/usr/bin/env bash
set -euo pipefail
trap 'rm -rf .category-rules-test-dist' EXIT
npx esbuild worker/routes/api.ts --bundle --platform=node --format=esm --outfile=.category-rules-test-dist/api.mjs
npx esbuild worker/lib/category-rules.ts --bundle --platform=node --format=esm --outfile=.category-rules-test-dist/matcher.mjs
node --test tests/category-rules.test.mjs
