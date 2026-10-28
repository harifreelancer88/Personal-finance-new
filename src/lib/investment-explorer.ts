import type { Investment } from '../types/finance'
import { valuationFreshness } from './dashboard-preview'
export const holdingSorts = {
  valueDesc: 'Value: high to low',
  valueAsc: 'Value: low to high',
  gainDesc: 'Gain: high to low',
  gainAsc: 'Gain: low to high',
  dateDesc: 'Valuation: newest first',
  dateAsc: 'Valuation: oldest first',
  name: 'Name: A–Z',
} as const
export const freshnessLabels = {
  all: 'All valuation dates',
  dated: 'Dated within 90 days',
  older: 'Over 90 days old',
  undated: 'Date needs review',
} as const
export function holdingGainMinor(i: Investment): number | null {
  return ['unknown', 'opening_valuation'].includes(i.basisKind ?? '')
    ? null
    : Math.round(i.currentValue * 100) - Math.round(i.investedAmount * 100)
}
export function exploreHoldings(
  items: Investment[],
  search: string,
  type: string,
  freshness: string,
  sort: string,
  asOf: string,
) {
  const rows = items.filter(
    (i) =>
      (type === 'all' || i.type === type) &&
      (freshness === 'all' ||
        valuationFreshness(i.valuationDate, asOf) === freshness) &&
      `${i.name} ${i.institution}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  )
  return rows.sort((a, b) => {
    let delta = 0
    if (sort.startsWith('gain')) {
      const x = holdingGainMinor(a),
        y = holdingGainMinor(b)
      if (x === null || y === null)
        return x === y
          ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
          : x === null
            ? 1
            : -1
      delta = sort === 'gainAsc' ? x - y : y - x
    } else if (sort.startsWith('date')) {
      const x =
          valuationFreshness(a.valuationDate, asOf) === 'undated'
            ? null
            : a.valuationDate!,
        y =
          valuationFreshness(b.valuationDate, asOf) === 'undated'
            ? null
            : b.valuationDate!
      if (x === null || y === null)
        return x === y
          ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
          : x === null
            ? 1
            : -1
      delta = sort === 'dateAsc' ? x.localeCompare(y) : y.localeCompare(x)
    } else if (sort === 'valueAsc')
      delta =
        Math.round(a.currentValue * 100) - Math.round(b.currentValue * 100)
    else if (sort === 'valueDesc')
      delta =
        Math.round(b.currentValue * 100) - Math.round(a.currentValue * 100)
    return delta || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  })
}
export function holdingTotals(items: Investment[]) {
  return items.reduce(
    (s, i) => {
      const gain = holdingGainMinor(i)
      s.valueMinor += Math.round(i.currentValue * 100)
      s.basisMinor += Math.round(i.investedAmount * 100)
      if (gain !== null) {
        s.gainMinor += gain
        s.gainBasisMinor += Math.round(i.investedAmount * 100)
        s.comparableCount++
      }
      return s
    },
    {
      valueMinor: 0,
      basisMinor: 0,
      gainMinor: 0,
      gainBasisMinor: 0,
      comparableCount: 0,
    },
  )
}
