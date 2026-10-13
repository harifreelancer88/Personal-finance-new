# GPT-4o mini category fallback

The existing merchant rules run first. New uncategorised expense, income and refund transactions are queued in D1. The Worker runs the model after returning the capture response and recovers queued work every five minutes. Transfers, investments, ignored records, existing categories and deliberately cleared categories are excluded.

Clear decisions require an allowed active category and a specific merchant phrase present in the cleaned narration. Ambiguous decisions stay uncategorised and appear in Settings. This is a guarded model judgement, not a guarantee of classification accuracy. No model-generated confidence score is used.

AI can update only `category_id`, category provenance/revision and the timestamp. It cannot change amounts, transaction types, account mappings, dates, notes or confirmation status. In-flight responses are discarded after human edits, matching rule changes, archived categories or transfer reconciliation.

## Before merging or deploying

Apply **0008_ai_categories.sql once** to the existing database. The previous schema must already include migration 0007. The migration preserves all existing manual/history rules, enables paused AI candidates, and adds category provenance, revisions, a durable jobs/audit table and daily quota tracking.

If the database is managed using Wrangler migration tracking:

```bash
npx wrangler d1 migrations apply personal-finance-db --remote
```

If earlier migrations were run manually through SQL (rather than Wrangler tracking), execute only the new file once:

```bash
npx wrangler d1 execute personal-finance-db --remote --file=migrations/0008_ai_categories.sql
```

Do not execute both commands or rerun the migration after it has succeeded. Run the command from the checked-out feature branch so the new file is present. Apply the migration before deploying the code because transaction reads now include the new provenance column.

## Configure and enable

Store the OpenAI API key as a Worker secret. Never put it into Git, frontend variables or transaction notes:

```bash
npx wrangler secret put OPENAI_API_KEY
```

Enter the key only at Wrangler's private prompt or in Cloudflare's Variables and Secrets interface.

The committed configuration initially has:

```json
"AI_CATEGORIZATION_ENABLED": "false",
"AI_DAILY_REQUEST_LIMIT": "20"
```

After the migration and secret are ready, change the enable flag to `"true"` in `wrangler.jsonc` and deploy the frontend and Worker together. Keep that value in the deployment configuration; changing only the dashboard variable can be overwritten on the next deployment. No key is required to run tests.

```bash
npm run build
npx wrangler deploy
```

The OpenAI request uses the fixed `gpt-4o-mini` model, a strict JSON schema, a 12-second timeout and a 220-token output limit. Identifiers, long numbers, URLs and payment addresses are masked. Only cleaned narration, transaction type, eligible category IDs/names and up to six manually reviewed examples are sent. Raw SMS, balances and account lists are not sent.

Daily quota is counted by IST calendar date and reserved atomically before calling OpenAI. Failed calls count toward the limit. The default is 20 requests/day, configurable up to 100. Each job makes at most two attempts; terminal failures need manual categorisation. A full quota defers queued work, rather than losing it. The scheduled handler processes at most two jobs per invocation.

## Use and verify

1. Open Settings → AI category assistant. Confirm Enabled and API key Configured.
2. Send an unmatched merchant SMS. Capture should succeed immediately; refresh Transactions or Settings after background processing.
3. Applied decisions show “AI categorised”. Ambiguous cases remain uncategorised, with the proposed category/reason visible in Settings.
4. Under Automatic categories, select Review candidate and save to approve its category/keyword, or Reject candidate to pause and block that keyword. AI keywords never activate themselves.
5. Correct a category through Transactions or the assistant panel. The correction wins over in-flight work, updates the exact AI keyword to a manual rule, and preserves its original AI decision in the job audit. A deliberate category clear blocks automatic reassignment.
6. Use Categorise unmatched transactions to queue up to 20 previously unqueued records. Refresh to inspect results. “Learn from categorised history” excludes AI-assigned records so unreviewed predictions cannot become active rules through that path.

Rule rejection does not undo earlier transaction categories. Review or correct those transactions separately. The assistant is category review, distinct from the existing account-mapping/confirmation Needs review tab.

If an account was unmapped at capture, later categorisation does not confirm the transaction or fabricate an account mapping. API outages, refusal, invalid categories, identifier-only keywords and quota limits do not block SMS ingestion.

## Validation

```bash
npm run test:ai-categories
npm run test:category-rules
npm run test:sms-ingestion
npm run test:transaction-controls
npm run test:transaction-pages
npm run test:wealth
npm run test:payroll
npm run build
```

Tests use isolated SQLite and mocked OpenAI responses: no real API keys, live transactions or paid requests. Test coverage includes idempotency, quota races, manual edits, bulk corrections, rule/category changes during requests, candidate disagreement, privacy masking, schema upgrade preservation and capture during an AI outage.
