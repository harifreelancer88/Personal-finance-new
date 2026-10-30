#!/usr/bin/env bash
set -euo pipefail
trap 'python -c "import shutil; shutil.rmtree(\".shadcn-test-dist\", ignore_errors=True)"' EXIT
npx esbuild tests/shadcn-transactions.test.tsx --bundle --platform=node --format=esm --jsx=automatic --packages=external --outfile=.shadcn-test-dist/ui.test.mjs
node --test .shadcn-test-dist/ui.test.mjs
