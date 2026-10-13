#!/usr/bin/env bash
set -euo pipefail
trap 'python -c "import shutil; shutil.rmtree(\".payroll-test-dist\", ignore_errors=True)"' EXIT
npx esbuild worker/routes/api.ts --bundle --platform=node --format=esm --outfile=.payroll-test-dist/api.mjs
node --test tests/payroll-api.test.mjs
