#!/usr/bin/env bash
set -euo pipefail
mkdir -p .workflow-test-dist
npx esbuild worker/routes/api.ts worker/lib/backup-registry.ts worker/lib/statement-parser.ts worker/lib/category-allocations.ts worker/lib/statement-ai.ts --bundle --platform=node --format=esm --entry-names=[name] --outdir=.workflow-test-dist --out-extension:.js=.mjs
node --test tests/workflows.test.mjs tests/statement-imports.test.mjs
