# Personal Finance app

Personal Finance is a responsive personal and family finance dashboard built with React, TypeScript, Vite, React Router, and Cloudflare Workers. Transactions and Accounts are backed by Cloudflare D1; the other application pages intentionally retain their v1 data sources.

The Transactions, Accounts, Dashboard, and Reports pages use the API. Investments and Settings retain their existing data sources.

## Direct SMS ingestion

The direct ingestion path is **Android SMS Forwarder → Cloudflare Worker → D1 → Personal Finance**. Google Sheets and Google Apps Script are not required (and neither are Telegram, Odoo, or AI parsing). The Android app only forwards the original message; deterministic parsing, account matching, category matching, deduplication, and pending-transaction creation happen in the Worker.

Configure `SMS_INGEST_TOKEN` as an encrypted Worker secret (never as a frontend variable or a value in this repository):

```bash
npx wrangler secret put SMS_INGEST_TOKEN
```

The forwarder must make an `application/json` `POST` to `/api/ingest/sms`, authenticating with either `Authorization: Bearer <token>` or `X-SMS-Token: <token>`. `message` and an ISO-8601 `receivedAt` are required; the device message ID `externalId` and sender label `sender` are optional. It must not send a workspace ID.

```bash
curl -X POST \
  -H "Authorization: Bearer $SMS_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "externalId":"example-123",
    "sender":"HDFCBK",
    "message":"INR 650 spent using card xx2847 at AMAZON",
    "receivedAt":"2026-09-29T16:30:00+05:30"
  }' \
  https://example.workers.dev/api/ingest/sms
```

Retries are safe: `externalId` is the primary deduplication input when present; otherwise a SHA-256 identity is derived from sender, received time, and exact message text. Successful financial parses create one SMS transaction. It is automatically confirmed when its required source/destination accounts match uniquely to active saved accounts; incomplete or ambiguous matches remain pending. A transfer requires two different matched accounts. Unrecognized and non-financial messages remain in `sms_messages` for audit and can be inspected through `GET /api/sms-messages`; raw text is returned on the individual transaction API only, never in the bulk transaction list.

## Dashboard calculation semantics

The Dashboard reads the current `DEFAULT_WORKSPACE_ID` through `GET /api/dashboard/summary` and `GET /api/dashboard/cash-flow`. All monetary API fields are integer paise. Only confirmed transactions contribute to totals and recent Dashboard activity.

Total available balance is the sum of bank, cash, and wallet balances, minus outstanding credit-card liability. A negative calculated credit-card balance is treated as outstanding; a positive card balance is not treated as available cash. Investments are deliberately excluded until Investments are D1-backed.

Calendar-month income includes income transactions. Spending includes expenses, reduced (not below zero) by refunds linked to an expense or assigned an expense/both category. Transfers and investments contribute to neither monthly income nor spending. Pending and ignored transactions are excluded. The cash-flow endpoint applies the same rules to the latest six UTC calendar months and returns zero-filled months when there is no activity.

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

## Minimum workspace bootstrap

`bootstrap.sql` is the controlled, idempotent bootstrap for the current workspace. It creates only the workspace and starter categories—never accounts or transactions. After applying migrations, run it locally with:

```bash
npm run bootstrap:local
```

To initialize production lookup data, first confirm that `DEFAULT_WORKSPACE_ID` is `development-workspace`, then explicitly run `npx wrangler d1 execute personal-finance-db --remote --file=bootstrap.sql`. Review the target before confirming. Never run `seed.sql` against production.

## Legacy development seed data

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
GET /api/accounts/:id
POST /api/accounts
PATCH /api/accounts/:id
DELETE /api/accounts/:id
GET /api/categories
GET /api/transactions
GET /api/transactions/:id
POST /api/transactions
PATCH /api/transactions/:id
DELETE /api/transactions/:id
GET /api/investments
```

The read endpoints use the `DEFAULT_WORKSPACE_ID` value in `wrangler.jsonc`, which matches the seeded `development-workspace`. Authentication and user-selected workspace resolution will replace this development default in a later phase.

## Money representation

All persisted monetary amounts use integer minor units (paise). For example, ₹1,234.56 is stored as `123456`, never as a floating-point rupee value. Worker-side conversion and display helpers live in `worker/lib/money.ts`; API responses deliberately preserve those integer minor-unit values without silently converting them.

Database columns remain in `snake_case`, while the API maps them to `camelCase` properties such as `amountMinor`, `transactionDate`, and `openingBalanceMinor`. API monetary fields still contain integer paise; the mapping layer never converts them to floating-point rupees.

## Account balance semantics

An account stores an `opening_balance_minor` and an optional `opening_balance_date`, not a mutable current balance. Account API reads return a calculated `currentBalanceMinor` from that opening point and **confirmed** transactions only:

- an expense subtracts `amount_minor` from `from_account_id`;
- income adds `amount_minor` to `to_account_id`;
- a refund adds `amount_minor` to `to_account_id`;
- a transfer subtracts from `from_account_id` and adds to `to_account_id` as one transaction; and
- an investment subtracts `amount_minor` from `from_account_id`.

Pending and ignored transactions do not affect calculated balances. Credit-card balances are negative internally when they represent a liability. The Accounts UI presents the positive outstanding amount; a positive internal card balance represents a credit and is not counted as outstanding.

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

## Financial summaries and transaction review

Accounts and Dashboard use **Balance after card dues** for bank, cash and wallet balances minus credit-card outstanding. **Liquid balance** is bank + cash + wallets before card dues. Investments are excluded from both.

The transaction list requests `GET /api/transactions?paginated=true&limit=25&offset=0`. Its data is `{ items, total, summary }`; the existing array response remains unchanged when `paginated=true` is omitted. Search (including account/category names), ID-based filters, and summaries cover every matching record, not just the displayed page. Money summaries include confirmed income and confirmed expenses reduced by eligible refunds (floored at zero). Transfers, investments, pending and ignored transactions do not contribute. The record count includes all matching statuses.

The separate SMS review queue paginates pending SMS records for the selected month. Opening **Review SMS** loads sender, received time, parse metadata and original text from the individual transaction endpoint. Original SMS text is never added to the bulk transaction response. Transaction dates are displayed without a fabricated time.

Investments and Settings remain explicitly labelled previews: their data and edits are temporary, and they do not update live accounts or transactions.

## SMS account matching and recovery

ICICI account-debit messages that also say a merchant was credited are expenses, not conflicting transactions. Named merchant credit clauses are distinguished from credits to another masked bank account. UPI bank reference, transaction date and amount define the transaction identity across direct phone and Google Sheets delivery. Raw delivery records remain available for audit. Replaying an unparsed SMS with the same original content reprocesses it after a parser fix, without creating another raw record.

Auto-confirmed income may be reconciled into a transfer when the corresponding debit alert arrives. A human edit clears the automatic marker, so confirmed human-reviewed records are not rewritten by SMS reconciliation. Incomplete credit-card repayments remain pending until both accounts are known. No schema migration is required for these parsing and approval changes.

Validate ingestion behavior with `npm run test:sms-ingestion`.

### Investments and Settings

The light Investments screen reads saved D1 holdings, supports all eight asset classes, and persists add/edit/delete operations. Allocation uses recorded current values; return is simple value change against invested amount, not annualized performance. Values and prices are entered manually. There is no live market feed or invented performance history. The recorded edit timestamp is not a market valuation timestamp.

Investment activity is a separate log. Recording a contribution, purchase, sale, dividend, interest or adjustment does not change holding values or account balances. Edit the holding to update portfolio totals. Holdings with activity history cannot be deleted.

Settings reads the workspace name and database connection from D1. The SMS token status only reports whether the server secret is configured; the secret itself is never returned, and this status does not verify upstream delivery. Automatic approval rules are informational and reflect the existing SMS ingestion behavior. Currency stays INR and appearance stays light. Category add/edit/archive/restore operations persist in D1; archived categories disappear from new-entry choices while existing transaction references remain intact.

Additional workspace-scoped endpoints:

```text
GET/POST     /api/investments
GET/PATCH/DELETE /api/investments/:id
GET/POST     /api/investments/:id/activity
GET/POST     /api/categories
PATCH        /api/categories/:id
GET          /api/settings/status
```

Investment write fields follow the existing GET response: `investmentType`, `name`, `institution`, `investedMinor`, `currentValueMinor` and optional type-specific fields. Monetary fields use non-negative integer paise. PATCH preserves omitted fields and clears fields belonging to another asset class when the type changes. Activity writes use `activityType`, `activityDate`, `amountMinor` and `description`. Category writes use `name`, `kind` (`expense`, `income`, `both`) and `isActive`.

These screens use the existing initial-schema tables; no new migration is required. `npm run test:wealth` exercises actual API routes against an isolated in-memory SQLite database and requires a Node release with `node:sqlite` (Node 22.13+). It checks workspace isolation, paise precision, dates, all asset classes, activity history, category references, and secret masking.


### Transaction month, selection and deletion

The Transactions screen starts in the current local calendar month. Previous/next arrows and a horizontal swipe on the month selector navigate months; the selected month is stored in the URL as `month=YYYY-MM`. Month boundaries apply to the list and SMS review queue. Money In and Money Out show confirmed totals for the whole selected month, independent of list search and other filters. Their existing accounting rules remain unchanged: transfers and investments are excluded, and eligible refunds reduce Money Out.

Choose **Select transactions**, select individual rows or the current page, and use **Assign category**. Selection can span pages within the same month and filters, up to 100 entries. Switching month, filters or tabs clears selection. Only active categories can be assigned; Uncategorised clears the assignment. The workspace-scoped `PATCH /api/transactions/categories` endpoint accepts `{ transactionIds: string[], categoryId: string | null }`. It changes categories atomically and leaves amounts, accounts, dates and statuses intact. An invalid or unavailable selected ID prevents every change. Human category edits end automatic SMS reconciliation ownership while preserving other notes.

Delete is available in every transaction menu, including SMS and ignored entries, with a confirmation dialog. The transaction is removed and balances/totals recalculate. Raw SMS records are retained with `parse_status='deleted'` and no transaction link, so an exact replay or a matching bank-reference counterpart cannot recreate the deleted transaction. Linked refunds must be deleted before their original transaction. No new migration is required.

`npm run test:transaction-controls` covers manual/SMS deletion, replay suppression, linked refunds, 100-row atomic category updates, workspace isolation, inactive categories and month/year/leap-day boundaries. It uses isolated SQLite and requires Node with `node:sqlite`.
