#!/usr/bin/env bash
set -euo pipefail
trap 'rm -rf .ai-category-test-dist' EXIT
npx esbuild worker/repositories/ai-categories.ts --bundle --platform=node --format=esm --outfile=.ai-category-test-dist/jobs.mjs
npx esbuild worker/lib/ai-categorization.ts --bundle --platform=node --format=esm --outfile=.ai-category-test-dist/model.mjs
npx esbuild worker/routes/api.ts --bundle --platform=node --format=esm --outfile=.ai-category-test-dist/api.mjs
npx esbuild worker/index.ts --bundle --platform=node --format=esm --outfile=.ai-category-test-dist/worker.mjs
node --test tests/ai-categories.test.mjs
