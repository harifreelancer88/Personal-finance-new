#!/usr/bin/env bash
set -euo pipefail
mkdir -p .workflow-test-dist
npx esbuild worker/routes/api.ts worker/lib/backup-registry.ts worker/lib/statement-parser.ts worker/lib/category-allocations.ts worker/lib/statement-ai.ts shared/statement-matching.ts --bundle --platform=node --format=esm --entry-names=[name] --outdir=.workflow-test-dist --out-extension:.js=.mjs
node --test tests/workflows.test.mjs tests/statement-imports.test.mjs
npx esbuild src/components/workflows/BankStatementReview.tsx --bundle --platform=node --format=esm --jsx=automatic --external:react --external:react-dom/* --outfile=.workflow-test-dist/bank-review.mjs
node --test tests/bank-review.test.mjs
