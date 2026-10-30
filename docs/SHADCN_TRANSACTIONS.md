# Separate shadcn Transactions page

Route: `/transactions-shadcn`. Sidebar: **Transactions · shadcn**.
The original `/transactions` page, its components and its stylesheet are unchanged.
Both pages read and write the same transaction records; this is a second interface, not a separate ledger.

## Source and licensing

The source files under `src/components/shadcn` were copied from the official
[shadcn/ui repository](https://github.com/shadcn-ui/ui), commit
`b8d7baa15b1dca5716f13153e63795fc3d741f6b`, from
`apps/v4/registry/new-york-v4/ui`.
The MIT notice is retained in `docs/licenses/shadcn-ui.txt`.
Local changes adapt imports to individual Radix packages and local `cn` utilities.
Theme variables are applied to the new page and its portalled surfaces using `.st-theme`.

The visual reference is https://square-ui-finance-tracker.vercel.app/transactions.
No Square UI source or shadcn Studio paid blocks are copied. The template's custom
redistribution terms are distinct from the official shadcn/ui MIT licence.

## Behaviour

- Shadcn Card, Button, Input, Table, Checkbox, Badge, Popover, Dropdown Menu,
  Dialog and Sheet; TanStack Table v8 for table state/rendering.
- Existing server filters and full-result summaries. Optional allowlisted sort
  columns and directions extend the API; absent sort parameters retain original ordering.
- Amount sorts by absolute payment size in paise. Income dates use accounting dates.
- Page size choices 10/25/50/100. Row selection is capped at 100 and cleared logically
  when the filter/sort scope changes. Bulk categorisation uses the existing guarded API.
- SMS review, add/edit, refund linkage, confirmation, ignore and guarded deletion use
  existing APIs. Confirming an SMS in the detail sheet requires its source to load.
- Privacy mode persists for this page and omits amounts, SMS text and notes from markup.
- No D1 migrations, secrets or broker changes are required.

## Validation

Build, server sorting/pagination tests, financial workflow tests, mutation-control
checks and SSR UI checks are run before opening a draft PR. Browser visual and
interaction validation must be reported separately; a passing build is not a visual pass.
