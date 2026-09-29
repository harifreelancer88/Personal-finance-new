# Personal Finance app

Personal Finance is a responsive personal and family finance dashboard built with React, TypeScript, Vite, React Router, and Cloudflare Workers. The backend foundation uses Cloudflare D1 with Wrangler-managed SQL migrations and a small read-only API.

The frontend still uses local mock data in this phase. It is intentionally not connected to the API yet, so the existing dashboard and the `/transactions`, `/accounts`, `/investments`, `/reports`, and `/settings` routes continue to work without a database.

## Prerequisites

- Node.js 22 or newer and npm (required by the current Wrangler release)
- A Cloudflare account for remote D1 operations
- Wrangler authentication (`npx wrangler login`) before creating or changing remote resources

Install dependencies with:

```bash
npm install
```

## Create and bind the D1 database

The checked-in `wrangler.jsonc` contains an all-zero placeholder `database_id`; it is not a real Cloudflare resource ID. Create the remote database from the repository root:

```bash
npx wrangler d1 create personal-finance-db
```

Wrangler prints configuration containing the generated database ID. In `wrangler.jsonc`, replace:

```jsonc
"database_id": "00000000-0000-0000-0000-000000000000"
```

with that generated ID. Keep the binding name as `DB`, because the Worker accesses `env.DB`. No credentials or secrets belong in this file.

## Database migrations

The `migrations/` directory is the source of truth for the D1 schema. Apply migrations to the local D1 database used by Wrangler/Vite:

```bash
npx wrangler d1 migrations apply personal-finance-db --local
```

After creating the Cloudflare database and replacing the placeholder ID, apply the same migrations remotely:

```bash
npx wrangler d1 migrations apply personal-finance-db --remote
```

Review the migration prompt before confirming remote changes. Remote migration is not required for frontend-only or local API development.

## Development seed data

`seed.sql` provides one development workspace and a small set of family members, accounts, categories, transactions, and investments. It uses stable IDs and `INSERT OR IGNORE`, so it can safely be loaded again after the first import.

Load it into local D1:

```bash
npx wrangler d1 execute personal-finance-db --local --file=seed.sql
```

The seed data is for development only. Do not load it into a production database. If a disposable remote development database specifically needs it, use `--remote` instead of `--local` only after checking the target database.

## Run locally

After applying the local migration and optional seed data:

```bash
npm run dev
```

Open the URL printed by Vite. The Worker serves API requests and delegates all other requests to the Vite/static asset binding. Useful API checks are:

```text
GET /api/health
GET /api/accounts
GET /api/categories
GET /api/transactions
GET /api/investments
```

The read endpoints use the `DEFAULT_WORKSPACE_ID` value in `wrangler.jsonc`, which matches the seeded `development-workspace`. Authentication and user-selected workspace resolution will replace this development default in a later phase.

## Money representation

All persisted monetary amounts use integer minor units (paise). For example, ₹1,234.56 is stored as `123456`, never as a floating-point rupee value. Worker-side conversion and display helpers live in `worker/lib/money.ts`; API responses deliberately preserve those integer minor-unit values without silently converting them.

Database columns remain in `snake_case`, while the API maps them to `camelCase` properties such as `amountMinor`, `transactionDate`, and `openingBalanceMinor`. API monetary fields still contain integer paise; the mapping layer never converts them to floating-point rupees.

## Account balance semantics

An account stores an `opening_balance_minor` and an optional `opening_balance_date`, not a mutable current balance. A future balance service will calculate the balance from that opening point and **confirmed** transactions only:

- an expense subtracts `amount_minor` from `from_account_id`;
- income adds `amount_minor` to `to_account_id`;
- a refund adds `amount_minor` to `to_account_id`;
- a transfer subtracts from `from_account_id` and adds to `to_account_id` as one transaction; and
- an investment subtracts `amount_minor` from `from_account_id`.

Pending and ignored transactions do not affect calculated balances. Credit-card balances may be negative internally to represent a liability; presentation code may display the absolute outstanding amount where appropriate.

Refunds remain their own transaction type. When known, `original_transaction_id` links a refund to its original transaction so future reports can offset the original expense category rather than treating the refund as ordinary income. Removing the original transaction sets this optional link to null and does not remove the refund.

## Validate and build

```bash
npm run check
npm run build
```

## Deployment

Deployment is intentionally outside the scope of this backend-foundation phase. Once the remote D1 binding is configured and migrations are applied, the existing deployment script is:

```bash
npm run deploy
```

Do not run it until the target Cloudflare account, database, and environment configuration have been reviewed.
