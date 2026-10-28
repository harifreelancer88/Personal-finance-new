#!/usr/bin/env bash
set -euo pipefail
trap 'python -c "import shutil; shutil.rmtree(\".transaction-filters-test-dist\", ignore_errors=True)"' EXIT
npx esbuild tests/transaction-filters-ui.test.tsx --bundle --platform=node --format=esm --jsx=automatic --packages=external --outfile=.transaction-filters-test-dist/ui.test.mjs
node --test .transaction-filters-test-dist/ui.test.mjs
