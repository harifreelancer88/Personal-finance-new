import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import {
  PreviewAmount,
  PreviewPrivacy,
} from '../src/components/dashboard/preview/PreviewAmount'
import { ActivityDateSelector } from '../src/components/dashboard/preview/ActivityDateSelector'
import { PreviewMetricCard } from '../src/components/dashboard/preview/PreviewMetricCard'
import { PreviewOverview } from '../src/components/dashboard/preview/PreviewOverview'
import { PreviewInvestments } from '../src/components/dashboard/preview/PreviewInvestments'
import type { RecordedWorth } from '../src/lib/dashboard-preview'
import type { Investment } from '../src/types/finance'

// Synthetic values only: these fixtures are unrelated to production accounts.
const worth: RecordedWorth = {
  cashMinor: 1234500,
  investmentsMinor: 7654300,
  cardCreditMinor: 20300,
  cardDebtMinor: 100000,
  netWorthMinor: 8809100,
  awaitingIncludedMinor: 40500,
  awaitingPayrollExcludedMinor: 60700,
  unverifiedHoldings: 1,
  asOf: '2026-10-17',
}
const holdings: Investment[] = [
  {
    id: 'example',
    name: 'Example holding',
    institution: 'Example provider',
    type: 'Gold',
    currentValue: 76543,
    investedAmount: 70000,
    startDate: '',
    valuationDate: null,
  },
]

test('privacy omits financial amounts from text and accessibility markup, including expanded details', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <PreviewPrivacy value={true}>
        <PreviewOverview worth={worth} loading={false} />
        <PreviewInvestments
          holdings={holdings}
          asOf="2026-10-17"
          loading={false}
        />
        <PreviewAmount minor={-1234567} sign="−" />
      </PreviewPrivacy>
    </MemoryRouter>,
  )
  assert.match(html, /Amount hidden/)
  assert.doesNotMatch(html, /₹|12,345|76,543|88,091|203|405|607|−••/)
  assert.match(html, /valuation date/)
  assert.match(html, /awaiting credit/)
})

test('overview renders the server net worth without deriving a different total and preserves signed amounts', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <PreviewPrivacy value={false}>
        <PreviewOverview
          worth={{ ...worth, netWorthMinor: -1234500 }}
          loading={false}
        />
      </PreviewPrivacy>
    </MemoryRouter>,
  )
  assert.match(html, /−₹12,345/)
  assert.match(html, /credit-card credits/)
  assert.match(html, /Excluded until reconciled/)
  assert.match(html, /17 Oct 2026/)
})

test('missing data stays unavailable while an empty portfolio has a useful next action', () => {
  const unavailable = renderToStaticMarkup(
    <MemoryRouter>
      <PreviewOverview loading={false} />
    </MemoryRouter>,
  )
  assert.match(unavailable, /net worth unavailable/)
  assert.doesNotMatch(unavailable, /₹0/)
  const empty = renderToStaticMarkup(
    <MemoryRouter>
      <PreviewInvestments holdings={[]} asOf="2026-10-17" loading={false} />
    </MemoryRouter>,
  )
  assert.match(empty, /Add a holding/)
  assert.doesNotMatch(empty, /valuation date needed|over 90 days old/)
})

test('activity selector clearly separates date-filtered activity from current balances', () => {
  const html = renderToStaticMarkup(
    <ActivityDateSelector
      range={{ fromDate: '2026-04-01', toDate: '2026-10-28' }}
      today="2026-10-28"
      onChange={() => {}}
    />,
  )
  assert.match(html, /Financial year to date/)
  assert.match(html, /Custom dates/)
  assert.match(html, /1 Apr 2026/)
  assert.match(html, /Balance cards show latest recorded values/)
})
test('shared metric cards keep amounts private and missing figures distinct from zero', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <PreviewPrivacy value={true}>
        <PreviewMetricCard
          title="Income remaining"
          minor={-1234567}
          note="After spending"
          icon={null}
          loading={false}
        />
      </PreviewPrivacy>
      <PreviewMetricCard
        title="Income"
        note="Recorded income"
        icon={null}
        loading={false}
      />
    </MemoryRouter>,
  )
  assert.match(html, /Amount hidden/)
  assert.doesNotMatch(html, /12,345|₹0/)
  assert.match(html, /income unavailable/)
})

// Synthetic records only; original message text deliberately includes an amount.
const detailItem = {
  id: 'example-detail',
  transactionType: 'expense' as const,
  description: 'Example shared payment',
  amountMinor: 1234500,
  categoryId: 'home',
  categoryOrigin: 'manual' as const,
  fromAccountId: 'example-bank',
  toAccountId: null,
  transactionDate: '2026-10-20',
  accountingDate: null,
  notes: 'Receipt total 12345.00',
  source: 'sms',
  originalTransactionId: null,
  status: 'confirmed' as const,
  createdAt: '',
  updatedAt: '',
  sms: {
    sender: 'EXAMPLE',
    rawText: 'Paid Rs.12345.00 for an example payment',
    receivedAt: '2026-10-20T10:00:00Z',
    parseStatus: 'confirmed',
    parseConfidence: 1,
  },
}
const { PreviewTransactionContent } = await import(
  '../src/components/dashboard/preview/PreviewTransactionPanel'
)
test('transaction panel content keeps notes, original SMS and allocation amounts out of privacy markup', () => {
  const html = renderToStaticMarkup(
    <PreviewPrivacy value={true}>
      <PreviewTransactionContent
        item={detailItem}
        splits={[
          { category_id: 'food', category_name: 'Food', amount_minor: 234500 },
        ]}
        accounts={[]}
        categories={[]}
      />
    </PreviewPrivacy>,
  )
  assert.match(html, /Amount hidden/)
  assert.match(html, /Original message hidden/)
  assert.match(html, /Notes hidden/)
  assert.doesNotMatch(html, /12345|12,345|2,345|10,000|Paid Rs|Receipt total|₹/)
})
test('transaction panel displays split remainder once, original SMS and account details', () => {
  const html = renderToStaticMarkup(
    <PreviewTransactionContent
      item={detailItem}
      splits={[
        { category_id: 'food', category_name: 'Food', amount_minor: 234500 },
      ]}
      accounts={[{ id: 'example-bank', name: 'Example bank' } as any]}
      categories={[{ id: 'home', name: 'Home' } as any]}
    />,
  )
  assert.match(html, /Home · remainder/)
  assert.match(html, /10,000/)
  assert.match(html, /2,345/)
  assert.match(html, /Total payment/)
  assert.match(html, /Example bank/)
  assert.match(html, /Paid Rs.12345.00/)
  assert.match(html, /IST/)
  assert.doesNotMatch(html, /Save splits|Confirm|Ignore|Edit transaction/)
})
test('transaction panel distinguishes missing allocations, failed allocations and unavailable source SMS', () => {
  const render = (props: any) =>
    renderToStaticMarkup(
      <PreviewTransactionContent
        item={{ ...detailItem, sms: null }}
        accounts={[]}
        categories={[]}
        {...props}
      />,
    )
  assert.match(render({}), /Loading allocations/)
  assert.match(render({ splitError: true }), /Allocations could not load/)
  assert.match(render({ splits: [] }), /No category splits recorded/)
  assert.match(render({ splits: [] }), /original SMS is unavailable/)
  assert.match(
    render({
      splits: [
        { category_id: 'food', category_name: 'Food', amount_minor: 1234501 },
      ],
    }),
    /Allocation totals need review/,
  )
})
