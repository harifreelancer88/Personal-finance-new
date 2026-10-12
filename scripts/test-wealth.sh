#!/usr/bin/env bash
set -euo pipefail
trap 'python -c "import shutil; shutil.rmtree(\".wealth-test-dist\", ignore_errors=True)"' EXIT
npx esbuild worker/routes/api.ts --bundle --platform=node --format=esm --outfile=.wealth-test-dist/api.mjs
node --test tests/wealth-api.test.mjs
