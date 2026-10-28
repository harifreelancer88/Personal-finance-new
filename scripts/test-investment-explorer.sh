#!/usr/bin/env bash
set -euo pipefail
trap 'python -c "import shutil; shutil.rmtree(\".investment-explorer-test-dist\", ignore_errors=True)"' EXIT
npx esbuild tests/investment-explorer-ui.test.tsx --bundle --platform=node --format=esm --jsx=automatic --packages=external --outfile=.investment-explorer-test-dist/ui.test.mjs
node --test .investment-explorer-test-dist/ui.test.mjs
