#!/usr/bin/env bash
set -euo pipefail
trap 'python -c "import shutil; shutil.rmtree(\".transaction-controls-test-dist\", ignore_errors=True)"' EXIT
npx esbuild worker/routes/api.ts --bundle --platform=node --format=esm --outfile=.transaction-controls-test-dist/api.mjs
npx esbuild src/lib/transaction-month.ts --bundle --platform=node --format=esm --outfile=.transaction-controls-test-dist/month.mjs
node --test tests/transaction-controls.test.mjs
