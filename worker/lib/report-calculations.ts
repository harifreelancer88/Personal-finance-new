export const REPORT_PERIODS = ['thisMonth', '3Months', '6Months', '1Year', 'all'] as const
export type ReportPeriod = typeof REPORT_PERIODS[number]

export interface ReportTransaction {
  id: string
  transaction_type: 'expense' | 'income' | 'transfer' | 'investment' | 'refund'
  description: string
  amount_minor: number
  transaction_date: string
  status: 'pending' | 'confirmed' | 'ignored'
  category_id: string | null
  category_name: string | null
  category_kind: string | null
  from_account_id: string | null
  from_account_name: string | null
  to_account_id: string | null
  original_transaction_type: string | null
  original_category_id: string | null
  original_category_name: string | null
  original_from_account_id: string | null
  original_from_account_name: string | null
}

export interface DateRange { start: string; end: string; previousStart: string | null; previousEnd: string | null }
const iso = (date: Date) => date.toISOString().slice(0, 10)
const utcDate = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day))

/** Calendar-aligned report ranges. End dates are inclusive. `all` has no comparison. */
export function resolveReportPeriod(period: ReportPeriod, now = new Date(), earliest?: string | null): DateRange {
  const year = now.getUTCFullYear(), month = now.getUTCMonth()
  const end = iso(now)
  if (period === 'all') return { start: earliest ?? end, end, previousStart: null, previousEnd: null }
  const months = period === 'thisMonth' ? 1 : period === '3Months' ? 3 : period === '6Months' ? 6 : 12
  const startDate = utcDate(year, month - months + 1, 1)
  const previousStart = utcDate(year, month - months * 2 + 1, 1)
  const previousEnd = new Date(startDate.getTime() - 86_400_000)
  return { start: iso(startDate), end, previousStart: iso(previousStart), previousEnd: iso(previousEnd) }
}

export const isQualifiedRefund = (t: ReportTransaction) => t.transaction_type === 'refund' &&
  (t.original_transaction_type === 'expense' || t.category_kind === 'expense' || t.category_kind === 'both')

const inRange = (t: ReportTransaction, start: string, end: string) =>
  t.status === 'confirmed' && t.transaction_date >= start && t.transaction_date <= end

export function reportTotals(transactions: ReportTransaction[], start: string, end: string) {
  let totalIncomeMinor = 0, totalExpenseMinor = 0, transactionCount = 0
  for (const t of transactions) {
    if (!inRange(t, start, end)) continue
    if (t.transaction_type === 'income') { totalIncomeMinor += t.amount_minor; transactionCount++ }
    else if (t.transaction_type === 'expense') { totalExpenseMinor += t.amount_minor; transactionCount++ }
    else if (isQualifiedRefund(t)) { totalExpenseMinor -= t.amount_minor; transactionCount++ }
  }
  totalExpenseMinor = Math.max(0, totalExpenseMinor)
  const netCashFlowMinor = totalIncomeMinor - totalExpenseMinor
  return { totalIncomeMinor, totalExpenseMinor, netCashFlowMinor,
    savingsRatePercent: totalIncomeMinor > 0 ? netCashFlowMinor / totalIncomeMinor * 100 : null, transactionCount }
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
export function reportCashFlow(transactions: ReportTransaction[], start: string, end: string) {
  const result: { month: string; incomeMinor: number; expenseMinor: number }[] = []
  const cursor = new Date(`${start}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`)
  cursor.setUTCDate(1)
  while (cursor <= last) {
    const month = monthKey(cursor)
    const totals = reportTotals(transactions, `${month}-01`, month === end.slice(0, 7) ? end : iso(utcDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)))
    result.push({ month, incomeMinor: totals.totalIncomeMinor, expenseMinor: totals.totalExpenseMinor })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return result
}

type Breakdown = { id: string | null; name: string; amountMinor: number; percentage: number }
function finishBreakdown(values: Map<string, { id: string | null; name: string; amountMinor: number }>): Breakdown[] {
  const rows = [...values.values()].filter(row => row.amountMinor > 0).sort((a, b) => b.amountMinor - a.amountMinor)
  const total = rows.reduce((sum, row) => sum + row.amountMinor, 0)
  return rows.map(row => ({ ...row, percentage: total ? row.amountMinor / total * 100 : 0 }))
}
function add(values: Map<string, { id: string | null; name: string; amountMinor: number }>, id: string | null, name: string | null, amount: number) {
  const key = id ?? '__uncategorized__', current = values.get(key)
  if (current) current.amountMinor += amount
  else values.set(key, { id, name: name ?? 'Uncategorized', amountMinor: amount })
}

export function categoryBreakdown(transactions: ReportTransaction[], start: string, end: string) {
  const values = new Map<string, { id: string | null; name: string; amountMinor: number }>()
  for (const t of transactions) if (inRange(t, start, end)) {
    if (t.transaction_type === 'expense') add(values, t.category_id, t.category_name, t.amount_minor)
    else if (isQualifiedRefund(t)) add(values, t.original_category_id ?? t.category_id, t.original_category_name ?? t.category_name, -t.amount_minor)
  }
  return finishBreakdown(values).map(({ id: categoryId, name: categoryName, ...rest }) => ({ categoryId, categoryName, ...rest }))
}

export function accountBreakdown(transactions: ReportTransaction[], start: string, end: string) {
  const values = new Map<string, { id: string | null; name: string; amountMinor: number }>()
  for (const t of transactions) if (inRange(t, start, end)) {
    if (t.transaction_type === 'expense') add(values, t.from_account_id, t.from_account_name, t.amount_minor)
    else if (isQualifiedRefund(t)) add(values, t.original_from_account_id, t.original_from_account_name, -t.amount_minor)
  }
  return finishBreakdown(values).filter(row => row.id !== null).map(({ id: accountId, name: accountName, ...rest }) => ({ accountId: accountId!, accountName, ...rest }))
}

export function incomeBreakdown(transactions: ReportTransaction[], start: string, end: string) {
  const values = new Map<string, { id: string | null; name: string; amountMinor: number }>()
  for (const t of transactions) if (inRange(t, start, end) && t.transaction_type === 'income') add(values, t.category_id, t.category_name, t.amount_minor)
  return finishBreakdown(values).map(({ id: categoryId, name: categoryName, ...rest }) => ({ categoryId, categoryName, ...rest }))
}

export function topExpenses(transactions: ReportTransaction[], start: string, end: string, limit = 10) {
  return transactions.filter(t => inRange(t, start, end) && t.transaction_type === 'expense')
    .sort((a, b) => b.amount_minor - a.amount_minor || b.transaction_date.localeCompare(a.transaction_date)).slice(0, limit)
    .map(t => ({ id: t.id, description: t.description, categoryName: t.category_name ?? 'Uncategorized', accountName: t.from_account_name ?? 'Unknown account', transactionDate: t.transaction_date, amountMinor: t.amount_minor }))
}

export function reportInsights(transactions: ReportTransaction[], range: DateRange) {
  const totals = reportTotals(transactions, range.start, range.end), categories = categoryBreakdown(transactions, range.start, range.end)
  const insights: { type: string; message: string; value: number }[] = []
  const top = categories[0]
  if (top) insights.push({ type: 'category_share', message: `${top.categoryName} accounts for ${top.percentage.toFixed(1)}% of your spending.`, value: top.percentage })
  if (range.previousStart && range.previousEnd) {
    const prior = reportTotals(transactions, range.previousStart, range.previousEnd)
    if (prior.totalExpenseMinor > 0) {
      const change = (totals.totalExpenseMinor - prior.totalExpenseMinor) / prior.totalExpenseMinor * 100
      insights.push({ type: 'expense_change', message: `Expenses ${change <= 0 ? 'decreased' : 'increased'} ${Math.abs(change).toFixed(1)}% compared with the previous comparable period.`, value: change })
    }
  }
  if (totals.savingsRatePercent !== null) insights.push({ type: 'savings_rate', message: `You saved ${totals.savingsRatePercent.toFixed(1)}% of your income during this period.`, value: totals.savingsRatePercent })
  return insights
}
