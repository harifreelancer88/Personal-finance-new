import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { PreviewAmount, PreviewPrivacy } from '../src/components/dashboard/preview/PreviewAmount'
import { PreviewOverview } from '../src/components/dashboard/preview/PreviewOverview'
import { PreviewInvestments } from '../src/components/dashboard/preview/PreviewInvestments'
import type { RecordedWorth } from '../src/lib/dashboard-preview'
import type { Investment } from '../src/types/finance'

// Synthetic values only: these fixtures are unrelated to production accounts.
const worth: RecordedWorth = {
  cashMinor: 1234500, investmentsMinor: 7654300, cardCreditMinor: 20300,
  cardDebtMinor: 100000, netWorthMinor: 8809100,
  awaitingIncludedMinor: 40500, awaitingPayrollExcludedMinor: 60700,
  unverifiedHoldings: 1, asOf: '2026-10-17',
}
const holdings: Investment[] = [{
  id: 'example', name: 'Example holding', institution: 'Example provider',
  type: 'Gold', currentValue: 76543, investedAmount: 70000,
  startDate: '', valuationDate: null,
}]

test('privacy omits financial amounts from text and accessibility markup, including expanded details', () => {
  const html = renderToStaticMarkup(<MemoryRouter><PreviewPrivacy value={true}>
    <PreviewOverview worth={worth} loading={false} />
    <PreviewInvestments holdings={holdings} asOf="2026-10-17" loading={false} />
    <PreviewAmount minor={-1234567} sign="−" />
  </PreviewPrivacy></MemoryRouter>)
  assert.match(html, /Amount hidden/)
  assert.doesNotMatch(html, /₹|12,345|76,543|88,091|203|405|607|−••/)
  assert.match(html, /valuation date/)
  assert.match(html, /awaiting credit/)
})

test('overview renders the server net worth without deriving a different total and preserves signed amounts', () => {
  const html = renderToStaticMarkup(<MemoryRouter><PreviewPrivacy value={false}>
    <PreviewOverview worth={{ ...worth, netWorthMinor: -1234500 }} loading={false} />
  </PreviewPrivacy></MemoryRouter>)
  assert.match(html, /−₹12,345/)
  assert.match(html, /credit-card credits/)
  assert.match(html, /Excluded until reconciled/)
  assert.match(html, /17 Oct 2026/)
})

test('missing data stays unavailable while an empty portfolio has a useful next action', () => {
  const unavailable = renderToStaticMarkup(<PreviewOverview loading={false} />)
  assert.match(unavailable, /net worth unavailable/)
  assert.doesNotMatch(unavailable, /₹0/)
  const empty = renderToStaticMarkup(<MemoryRouter><PreviewInvestments holdings={[]} asOf="2026-10-17" loading={false} /></MemoryRouter>)
  assert.match(empty, /Add a holding/)
  assert.doesNotMatch(empty, /valuation date needed|over 90 days old/)
})
