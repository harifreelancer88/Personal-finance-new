#!/usr/bin/env bash
set -euo pipefail
trap 'rm -rf .dashboard-preview-test-dist' EXIT
npx tsc --ignoreConfig src/lib/dashboard-preview.ts src/lib/dashboard-range.ts --module esnext --moduleResolution bundler --target es2022 --outDir .dashboard-preview-test-dist --rootDir src --types vite/client
node --test tests/dashboard-preview.test.mjs
npx esbuild tests/dashboard-preview-ui.test.tsx --bundle --platform=node --format=esm --jsx=automatic --packages=external --outfile=.dashboard-preview-test-dist/ui.test.mjs
node --test .dashboard-preview-test-dist/ui.test.mjs
