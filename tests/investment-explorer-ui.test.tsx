import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  exploreHoldings,
  holdingGainMinor,
  holdingTotals,
} from '../src/lib/investment-explorer'
import { InvestmentExplorer } from '../src/components/investments/InvestmentExplorer'
import type { Investment } from '../src/types/finance'
const asOf = '2026-10-28'
const holding = (id: string, extra: Partial<Investment> = {}): Investment => ({
  id,
  name: id,
  institution: 'Example provider',
  type: 'Gold',
  investedAmount: 100.01,
  currentValue: 120.02,
  startDate: '',
  basisKind: 'actual_cost',
  valuationDate: '2026-10-01',
  ...extra,
})
test('filters intersect search, asset type and valuation date status without modifying records', () => {
  const items = [
    holding('dated'),
    holding('old', { valuationDate: '2026-01-01' }),
    holding('missing', { valuationDate: null }),
    holding('fund', { type: 'Mutual Funds' }),
  ]
  assert.deepEqual(
    exploreHoldings(items, 'example', 'Gold', 'older', 'valueDesc', asOf).map(
      (i) => i.id,
    ),
    ['old'],
  )
  assert.deepEqual(
    exploreHoldings(items, 'missing', 'all', 'undated', 'valueDesc', asOf).map(
      (i) => i.id,
    ),
    ['missing'],
  )
  assert.deepEqual(
    items.map((i) => i.id),
    ['dated', 'old', 'missing', 'fund'],
  )
})
test('gain sorting excludes unknown and opening valuations from comparable order in either direction', () => {
  const items = [
    holding('unknown', { basisKind: 'unknown', currentValue: 99999 }),
    holding('opening', { basisKind: 'opening_valuation', currentValue: 99999 }),
    holding('loss', { currentValue: 90 }),
    holding('gain'),
  ]
  assert.equal(holdingGainMinor(items[0]), null)
  assert.deepEqual(
    exploreHoldings(items, '', 'all', 'all', 'gainDesc', asOf).map((i) => i.id),
    ['gain', 'loss', 'opening', 'unknown'],
  )
  assert.deepEqual(
    exploreHoldings(items, '', 'all', 'all', 'gainAsc', asOf).map((i) => i.id),
    ['loss', 'gain', 'opening', 'unknown'],
  )
})
test('date sorting puts missing, impossible and future dates last in either direction', () => {
  const items = [
    holding('future', { valuationDate: '2026-10-29' }),
    holding('bad', { valuationDate: '2026-02-30' }),
    holding('new'),
    holding('old', { valuationDate: '2026-01-01' }),
  ]
  assert.deepEqual(
    exploreHoldings(items, '', 'all', 'all', 'dateDesc', asOf).map((i) => i.id),
    ['new', 'old', 'bad', 'future'],
  )
  assert.deepEqual(
    exploreHoldings(items, '', 'all', 'all', 'dateAsc', asOf).map((i) => i.id),
    ['old', 'new', 'bad', 'future'],
  )
})
test('filtered totals retain paise, include each API value once and exclude incomparable gain', () => {
  const items = [
    holding('one'),
    holding('two', { currentValue: 0.02, investedAmount: 0.01 }),
    holding('baseline', {
      basisKind: 'opening_valuation',
      currentValue: 500,
      investedAmount: 450,
    }),
  ]
  assert.deepEqual(holdingTotals(items), {
    valueMinor: 62004,
    basisMinor: 55002,
    gainMinor: 2002,
    gainBasisMinor: 10002,
    comparableCount: 2,
  })
  assert.equal(
    holdingTotals(
      exploreHoldings(items, 'one', 'all', 'all', 'valueDesc', asOf),
    ).valueMinor,
    12002,
  )
})
const render = (rows: Investment[], extra = {}) =>
  renderToStaticMarkup(
    <InvestmentExplorer
      rows={rows}
      total={rows.length}
      search=""
      type="all"
      freshness="all"
      sort="valueDesc"
      asOf={asOf}
      change={() => {}}
      onView={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      {...extra}
    />,
  )
test('compact grid labels unknown gains and date gaps, exposes accessible disclosures and limits rows per page', () => {
  const items = Array.from({ length: 22 }, (_, i) =>
    holding(`holding-${i}`, {
      name: `Holding ${i}`,
      ...(i === 0 ? { basisKind: 'unknown', valuationDate: null } : {}),
    }),
  )
  const html = render(items)
  assert.match(html, /Date needs review/)
  assert.match(html, /Unavailable/)
  assert.match(html, /aria-expanded="false" aria-controls="holding-holding-0"/)
  assert.match(html, /1–20 of 22/)
  assert.doesNotMatch(html, /Expand Holding 20/)
  assert.doesNotMatch(html, /Loading valuation history/) // Closed rows do not fetch or render history.
  assert.match(html, /Dated does not mean a live quote/)
})
test('active chips can identify each holding filter and empty matches remain distinguishable', () => {
  const html = render([], {
    search: 'Example',
    type: 'Gold',
    freshness: 'undated',
  })
  assert.match(html, /Remove Search: Example filter/)
  assert.match(html, /Remove Type: Gold filter/)
  assert.match(html, /Remove Date needs review filter/)
  assert.match(html, /No holdings match these filters/)
})
