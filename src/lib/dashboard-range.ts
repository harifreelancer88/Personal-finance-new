import { monthBounds, shiftMonth } from './transaction-month.js'
export interface ActivityRange {
  fromDate: string
  toDate: string
}
export type ActivityPreset =
  | 'thisMonth'
  | 'lastMonth'
  | 'financialYear'
  | '3Months'
  | '6Months'
export function validActivityDate(value: string | null): value is string {
  return (
    !!value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= '1900-01-01' &&
    value <= '9998-12-31' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
export function validActivityRange(
  from: string | null,
  to: string | null,
): ActivityRange | null {
  return validActivityDate(from) &&
    validActivityDate(to) &&
    from <= to &&
    Date.parse(to) - Date.parse(from) <= 3660 * 86400000
    ? { fromDate: from, toDate: to }
    : null
}
export function activityPreset(
  preset: ActivityPreset,
  today: string,
): ActivityRange {
  const month = today.slice(0, 7),
    year = Number(today.slice(0, 4))
  if (preset === 'lastMonth') return monthBounds(shiftMonth(month, -1))
  if (preset === 'financialYear')
    return {
      fromDate: `${year - (month.slice(5) < '04' ? 1 : 0)}-04-01`,
      toDate: today,
    }
  return {
    fromDate: `${shiftMonth(month, preset === '3Months' ? -2 : preset === '6Months' ? -5 : 0)}-01`,
    toDate: today,
  }
}
export function activityRangeLabel(range: ActivityRange) {
  const format = (date: string) =>
    new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`))
  return `${format(range.fromDate)} – ${format(range.toDate)}`
}
export function activityLink(
  range: ActivityRange,
  extra: Record<string, string> = {},
) {
  return `/transactions?${new URLSearchParams({ ...range, status: 'confirmed', ...extra })}`
}
