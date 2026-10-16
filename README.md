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

## Money In accounting date

Money In transactions can optionally set `accountingDate` independently of the
original `transactionDate`. Monthly transaction lists, Money In totals, dashboard
cash flow and income reports use the accounting date; unset dates fall back to
the transaction date. Account balances, raw SMS and SMS matching retain the
original transaction date. Other transaction types cannot override this date.

Apply `migrations/0005_income_accounting_date.sql` to D1 **before deploying** this
version. The migration only adds a nullable column, so existing records keep
using their original dates. Review -> Edit transaction and the usual Edit form
both expose the field for Money In; Use transaction date removes the override.

## Automatic category rules

Apply `migrations/0006_category_rules.sql` before deploying this version. In
Settings → Automatic categories, Learn from categorised history builds scoped
merchant keyword rules from confirmed transactions with active categories.
Uncategorised, ignored and pending history does not create guesses. Conflicting
categories for an identical keyword/type produce a paused rule. Explicit rule
edits and feedback from category changes are preserved when history is refreshed.

New SMS transactions and newly created transactions without a chosen category
use active keyword rules. Matching is case/punctuation insensitive, uses whole
words, and selects the longest matching phrase; equally specific conflicting
matches stay uncategorised. Archived/incompatible categories cannot match.
Transfers and investments are not automatically categorised. Existing records
are never recategorised by learning or editing a rule.

An individual or bulk category change teaches the current merchant description
for that transaction type. Clearing a category pauses that learned rule. Generic
phrases (UPI/payment/bank names) and descriptions with long reference numbers
are not learned. Rules can be added, edited or paused in Settings.

`npm run test:category-rules` covers matcher boundaries, ambiguity, history,
manual feedback, workspace isolation and new SMS assignment using real SQLite.

## SMS payment deduplication

SMS deliveries without a bank reference use a payment identity derived from the
exact sender, exact message and original receipt timestamp, independently of a
forwarder's external delivery ID. Receipt times without an offset are interpreted
as IST (+05:30), and equivalent UTC/IST timestamps match to second precision.
Forwarders must preserve the original SMS receipt time, rather than replacing it
with the forwarding time. Distinct timestamps, senders or message bodies remain
separate. Existing pre-fix SMS identities are reused without changing categories,
ignored status or raw delivery records. This change needs no D1 migration.

## Linked salary breakdown and retirement reconciliation

Apply **`migrations/0007_payroll.sql` before deploying** this version. It creates
two explanatory-history tables and integrity triggers; it does not import or
change any existing transactions or investment values. Run the migration once
using the production D1 SQL console or the normal Wrangler migration workflow.
Do not merge/deploy until this database step has succeeded.

Open a Money In transaction → View → Add salary breakdown. Choose the payroll
month, employer, gross salary and payroll deductions. Gross minus deductions
must exactly equal the existing bank receipt in paise. Received and budget dates
remain properties of the original bank transaction. The Salary page is available
from navigation; Investments links to awaiting retirement credits.

Employee PF and NPS deductions automatically create awaiting-credit allocations.
Record employer EPF/NPS/pension separately using verified allocations. Confirm a
credit using a matching EPF/NPS holding and a statement reference, optionally
linking an existing investment contribution with the exact same amount and date.
Pension (EPS) uses statement evidence without an investment holding. References
should identify the individual allocation, including wage month where needed.
Combined employee/employer investment activity must use statement-only evidence
for each individual allocation, rather than matching the combined activity twice.

Saving, matching and resetting payroll records **never** create bank transactions,
create investment activity or increment investment values. The cash dashboard and
cash-flow reports continue using take-home income. Taxes and purchases in the
breakdown are explanatory payroll deductions, not automatically posted expenses.
When entering a statement valuation, use its total recorded value; do not add
already included contributions a second time. No investment valuation is inferred
from the uploaded older passbooks.

Payroll matches protect against duplicate evidence, stale writes, cross-workspace
links, incompatible investment types and automatic SMS transfer reclassification.
Reset affected matches before changing confirmed deductions or payroll month.
Remove the breakdown before deleting its salary transaction or changing the bank
amount/type. Unmatched employer allocations can be removed and corrected. Ignored
receipts stay in payroll history but are excluded from awaiting-credit totals.

`npm run test:payroll` exercises actual SQLite migrations, triggers, API validation,
cash/portfolio invariance, contribution matching, replay protection and removal.

### AI audit details (migration 0009)

Apply `migrations/0009_ai_audit_details.sql` to the production D1 database **before deploying this version**:

```sh
npx wrangler d1 execute personal-finance-db --remote --file=migrations/0009_ai_audit_details.sql
```

Alternatively, run the SQL file in the Cloudflare D1 console. This adds the audit table without changing existing transactions or rules. No additional secret or environment variable is required.

In **Settings → AI category assistant**, select **AI audit details** on a transaction. New API attempts retain the exact sanitised request body (instructions, category IDs/names, examples and JSON schema), original response body, OpenAI request ID, HTTP status, timing, reported input/cached/output tokens and estimated USD token cost. Each retry has its own snapshot. Viewing or copying an audit does not call OpenAI or change a transaction. Authentication headers and API keys are never archived.

Costs use the stored GPT-4o mini standard-rate snapshot: $0.15 input, $0.075 cached input and $0.60 output per million tokens, before taxes/currency conversion. Missing usage is displayed as unknown, including network failures and API errors without usage. Old jobs expose saved decisions and token counts with a clear message that original payloads were not retained. Their cost assumes uncached input; historical payloads are not fabricated. Audit detail reads are scoped to the configured workspace, consistent with the existing API.

Run `npm run test:ai-categories` and `npm run build` to validate. Tests use mocked OpenAI responses and an in-memory database; they make no paid API calls.

### NPS statement workflow (migration 0010)

Apply `migrations/0010_nps_statements.sql` to production D1 before deploying:

```sh
npx wrangler d1 execute personal-finance-db --remote --file=migrations/0010_nps_statements.sql
```

Open **Investments → your NPS holding → Import NPS statement**, select the CRA Tier I transaction CSV, review its preview and select **Import statement & update holding**. The CSV is sufficient for holdings, units, NAV, contributions and intermediary fees; a holdings PDF can be checked alongside it. This first version supports the three E/C/G schemes, contributions and fees. Withdrawals, switches, inconsistent unit balances or totals are rejected for separate reconciliation.

The import replaces the existing NPS holding's principal/current value with the statement totals. It does not add another holding or create money-in, money-out or investment transactions, so historical contributions cannot inflate this month's dashboard. Scheme components are included in their parent's value once. Four decimal places are preserved for units and NAV. Fees deducted in units are shown in NPS history and are already reflected in the valuation; they are not subtracted twice or recorded as bank spending. Reported XIRR is shown as supplied, not recalculated from partial contribution history.

Existing confirmed investment transactions tagged with `[investment-holding:<holding ID>]` appear as deductions awaiting credit. Salary tags `[salary-ledger:YYYY-MM:nps]` allow exact salary-month/amount matching to posted contribution rows. Matching updates reconciliation metadata only; it preserves the original cash-flow date, amount and transaction. Deductions not present in the statement remain separate from its verified portfolio valuation.

Imports retain sanitised statement snapshots and the prior holding metadata, use an account hash to prevent cross-account imports, reject older/same-date changed statements and stale previews, and make re-importing an identical statement a no-op. Generic holding edits cannot change verified NPS balances/type, and holdings with statement history cannot be deleted. No OpenAI call or raw personal/contact data is needed. Test with `npm run test:nps`, `npm run test:wealth` and `npm run build`.

## Investment payment ledger and dated valuations (migration 0011)

Apply `migrations/0011_investment_ledger.sql` to production D1 **before merging/deploying** this version. It adds payment links, immutable valuation history, valuation dates, basis classification and optimistic version checks. Existing cash transactions and holding amounts are unchanged. Explicitly documented gold opening baselines are classified as opening valuations. Previously imported NPS statements retain their genuine historical dates and values; no other historical values are invented.

In **Investments → a holding → Payments & valuations**:

- **Record new payment** records a confirmed bank/cash/wallet investment transaction and its holding link atomically. Use it only if the payment does not already exist (for example through SMS). A stable request ID makes retries safe.
- **Link existing payment** chooses a confirmed Investment transaction without deducting cash again. Payments are linked to one holding only. If SMS classified the payment as an expense, first review its type in Transactions. Choose explicitly whether the payment is already included in a dated valuation. Historical payments excluded from a valuation require an explanatory reference.
- Additional linked payments increase the derived holding basis/value at cost. Awaiting credits are labelled separately, including in net worth. **Confirm credit** saves a reference/date without increasing value a second time. An awaiting payment outside a valuation can be unlinked; its original cash transaction remains.
- **Record valuation** saves total statement amounts and the selected payments already contained in them. Selected payments are absorbed once; unselected payments remain separate at cost, including payments dated earlier than the statement that have not credited yet. Do not add selected payments on top of the statement totals. A statement can itself confirm the credit of selected payments. Older valuations and stale writes cannot replace newer records.
- Generic edits cannot overwrite derived balances while additional linked payments exist. Linked cash dates, amounts, accounts, type and status are protected by database triggers; normal descriptive/category edits remain available. Holdings with valuation/payment history cannot be deleted. Confirmed statement matches require a reviewed correction workflow; they cannot be silently unlinked.

NPS keeps its existing CSV importer and exact salary-month matching. New NPS imports also append dated valuation history. EPF salary deductions continue through payroll reconciliation; generic bank-payment recording is disabled for EPF/NPS. Unverified payroll deductions stay excluded from net worth, rather than being assumed credited. Do not create a second ledger payment for a payroll allocation.

Basis types distinguish actual cost/contributions, previously recorded amounts, opening market valuations and unknown cost. Opening valuations and unknown cost show **Historical profit unavailable** and are excluded from aggregate gain/return; their values remain included in allocation and net worth. Previously recorded basis is not automatically reclassified as verified lifetime cost. New UI entries require a valuation date. Existing undated holdings remain undated until a user supplies source evidence.

The Dashboard's **Recorded net worth** adds recorded bank/cash/wallet balances, investment values (including additional linked payments), positive card credits, and subtracts card dues. It does not assume unrecorded loans or assets. There is no reconstructed historical net-worth chart: holding history contains only genuinely recorded dated observations.

API: `GET /api/net-worth`, `GET/POST /api/investments/:id/payments`, `PATCH/DELETE /api/investments/:id/payments/:paymentId`, and `GET/POST /api/investments/:id/valuations`. Writes require the current `expectedVersion` (except unlinking an awaiting payment); payment creation also accepts a caller-generated `requestId` prefixed `ledger-`. Legacy activity logs remain explanatory only and are not added into portfolio totals. Existing account/workspace routing and authentication behavior are unchanged.

Validate with `npm run test:investment-ledger`, `npm run test:wealth`, `npm run test:payroll`, `npm run test:nps`, `npm run test:transaction-controls`, `npm run test:sms-ingestion`, `npm run test:dashboard`, and `npm run build`.

## Bills, statement imports, splits, comparison reports and recovery (migration 0012)

This release implements the five selected workflows in the existing React/Worker/D1 app. It preserves the cash movement model: schedules and category allocations never create extra cash transactions. New pages are available in the sidebar and in the phone navigation's **More** menu.

### Deployment order

1. Save a current production D1 recovery point/export.
2. Apply **only** `migrations/0012_finance_workflows.sql` to the production database after migrations 0001–0011. For this existing installation, where earlier SQL was applied manually, use the file directly rather than reapplying all migrations:

   ```sh
   npx wrangler d1 execute personal-finance-db --remote --file=migrations/0012_finance_workflows.sql
   ```

   Run the complete file once. It contains compound triggers and a fixed atomic recovery program; do not split trigger bodies into individual statements in the web console. It adds empty workflow tables and protects linked records; it does not invent bills, payments, splits or historical transactions.

3. Deploy/merge the application **after** the migration succeeds.
4. To enable backup/restore, set a new private owner key through Cloudflare's encrypted Worker secret named `RECOVERY_TOKEN`, or run `npx wrangler secret put RECOVERY_TOKEN`. Enter that key only in **Backup & restore**. Never put it in Git, public variables or a chat message. The rest of the app works without this secret; recovery returns an unavailable response until it is configured.

For a fresh local database use `npx wrangler d1 migrations apply personal-finance-db --local`. Migration 0012 is not designed to be run twice. Application rollback can leave its additive tables in place.

### Using the features

- **Bills & instalments:** monthly, quarterly or yearly schedules with an optional fixed instalment count. Enter the first *unpaid* due date and any verified earlier paid count. Paid and skipped periods are distinct; skipping consumes a schedule slot without increasing the paid count. Month-end schedules retain their original day anchor. Pause/resume preserves history. Match a confirmed payment already in Transactions; record missing real cash movements there first. Different amounts require explicit acceptance. Investment schedules can link ordinary investment payments to an existing holding once, awaiting credit; EPF/NPS retain their retirement reconciliation flow. Earlier payments already covered by a valuation must first be reviewed in the holding's payment ledger. This version provides an in-app due/overdue tracker, without external notifications or automatic debits.
- **Statement import centre:** CSV, TSV and semicolon-delimited text, up to 500 rows and 500 KB, with explicit date convention and column mapping. Supports quoted fields and Indian/western money grouping with exact integer paise. Preview rejects invalid/future dates and malformed amounts, flags existing same-account/date/amount or reference matches, and starts possible duplicates unchecked. Commit rechecks duplicates, including a guard inside the atomic write against a concurrent SMS. Identical statement retries reuse their batch. Review transfers, refunds and investment payments separately: this importer posts ordinary confirmed income/expenses only. Historical backfill explicitly offsets the opening balance to preserve today's cash balance and records the offset for undo. Undo removes only the batch's unedited, unlinked rows and reverses its own offset; edits, refunds, salary/bill/investment links or deleted rows require reconciliation first. PDF/OCR/AI extraction is outside this version.
- **Split transactions:** open an income or expense's **View/Review** dialog and choose **Split into categories**. Up to ten distinct additional categories, with any remainder kept in the main category. Allocations cannot exceed the parent amount. Bank balance and total cash flow remain unchanged. Category reports and Sankey use these allocations; a transaction-category filter can find a split but its Transactions row still shows the full bank payment. Existing refunds must be unlinked before editing splits. Explicit matching-category refunds reduce that allocation; otherwise refunds are distributed proportionally with exact-paise remainder handling.
- **Comparison reports:** monthly recorded spending by category, account or normalized merchant description; date/account/category filters, saved exact-date views, CSV download, and clickable monthly cells showing the included transactions and refund amounts. Confirmed expenses are reduced by eligible linked refunds in the month the refund arrived; transfers and investments are excluded. Category filters include only that allocation. Merchant grouping uses transaction descriptions rather than a new payee database. This version does not project future income or reconstruct missing historical asset valuations.
- **Backup & restore:** owner-key-protected, versioned JSON with SHA-256 checksum, exact table/column contract and workspace/reference validation. Includes financial records, raw SMS, payroll/NPS evidence, investment valuation/payment history and the new workflows. Credentials/server secrets and transient recovery/request-control state are excluded. Restore accepts this schema/workspace only, with a 1.5 MB small-workspace limit; larger datasets require administrator D1 recovery. A preview shows before/after row counts, supplies a current recovery copy, requires typed confirmation and expires after ten minutes. A change after preview (including SMS) aborts replacement. The fixed database program replaces records atomically with FK/record guards enabled and rolls back on any failure. The valuation deletion exception exists only inside that restore transaction. Use the database recovery copy if rolling back schema/application versions; this is not a general cross-version migration utility.

The existing application's workspace routing and access model remain in place. Destructive recovery additionally requires its owner secret and same-origin writes. Keep exported files private because they contain financial data and original SMS text.

### Implementation references and checks

The implementation is original TypeScript/SQLite for this application's schema. The reviewed [MoneyMatter source](https://github.com/letehaha/moneymatter/tree/9c45e0f293e9fa014693193ed8ed8d93f3e7701f) informed these patterns:

| Pattern | Reviewed source | Adaptation here |
| --- | --- | --- |
| Finite instalments and consumed periods | `services/subscriptions/installments.ts` | Separate paid/skipped history; capped schedules and anchored due dates |
| Preview duplicates before import | `services/import-export/statement-parser/detect-duplicates.service.ts` | Integer paise, explicit row selection and an additional atomic SMS-race guard |
| Category allocations beneath one payment | `services/transactions/splits/validate-splits.ts` | Workspace checks, unique categories, limits and parent remainder |
| Shared split/refund reporting rules | `services/stats/get-pivot/index.ts` and `refunds.ts` | Shared allocations, refund-month netting, matching totals and drilldowns |
| Explicit backup registry and preflight | `services/backup/registry.ts` and `restore/preflight.ts` | Exact schema contract, drift test, checksum, owner/workspace checks and atomic D1 restore |

Source paths above are relative to `packages/backend/src`. No upstream application code or infrastructure is copied into this app.

Run `npm run test:workflows` for schedule/retry/date-anchor checks, allocation/report reconciliation, import duplicate/retry/undo/race cases, CSV boundary cases, backup schema drift, linked payroll/NPS round trips, owner checks, stale previews and injected restore rollback. Also run the existing report, dashboard, transaction, payroll, NPS, investment-ledger and SMS regression suites, `npm run build`, and `npx tsc -p tsconfig.worker.json --pretty false`.
