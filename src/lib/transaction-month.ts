export const currentMonthKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
export const validMonthKey = (value: string | null): value is string =>
  !!value &&
  /^\d{4}-(0[1-9]|1[0-2])$/.test(value) &&
  Number(value.slice(0, 4)) >= 1900 &&
  Number(value.slice(0, 4)) <= 9998
export function monthBounds(key: string) {
  const [year, month] = key.split('-').map(Number)
  return {
    fromDate: `${key}-01`,
    toDate: `${key}-${new Date(year, month, 0).getDate()}`,
  }
}
export function shiftMonth(key: string, delta: number) {
  const [year, month] = key.split('-').map(Number),
    date = new Date(year, month - 1 + delta, 1)
  return currentMonthKey(date)
}
export function monthLabel(key: string) {
  const [year, month] = key.split('-').map(Number)
  return `${new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(year, month - 1, 1))} '${String(year).slice(-2)}`
}
