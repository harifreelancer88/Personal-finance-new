import { accountBreakdown, categoryBreakdown, incomeBreakdown, reportCashFlow, reportInsights, reportTotals, resolveReportPeriod, topExpenses, type ReportPeriod, type ReportTransaction } from '../lib/report-calculations'

async function data(db: D1Database, workspaceId: string) {
  const rows = await db.prepare(`SELECT t.id, t.transaction_type, t.description, t.amount_minor, t.transaction_date, t.status,
    t.category_id, c.name AS category_name, c.kind AS category_kind,
    t.from_account_id, fa.name AS from_account_name, t.to_account_id,
    original.transaction_type AS original_transaction_type, original.category_id AS original_category_id,
    oc.name AS original_category_name, original.from_account_id AS original_from_account_id,
    ofa.name AS original_from_account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts fa ON fa.id = t.from_account_id
    LEFT JOIN transactions original ON original.id = t.original_transaction_id
    LEFT JOIN categories oc ON oc.id = original.category_id
    LEFT JOIN accounts ofa ON ofa.id = original.from_account_id
    WHERE t.workspace_id = ?`).bind(workspaceId).all<ReportTransaction>()
  return rows.results
}

export async function getReport(db: D1Database, workspaceId: string, period: ReportPeriod, kind: string, limit = 10, now = new Date()) {
  const transactions = await data(db, workspaceId)
  const earliest = transactions.filter(t => t.status === 'confirmed').map(t => t.transaction_date).sort()[0]
  const range = resolveReportPeriod(period, now, earliest)
  if (kind === 'summary') return { ...reportTotals(transactions, range.start, range.end), periodStart: range.start, periodEnd: range.end }
  if (kind === 'cash-flow') return reportCashFlow(transactions, range.start, range.end)
  if (kind === 'category-breakdown') return categoryBreakdown(transactions, range.start, range.end)
  if (kind === 'account-breakdown') return accountBreakdown(transactions, range.start, range.end)
  if (kind === 'income-breakdown') return incomeBreakdown(transactions, range.start, range.end)
  if (kind === 'top-expenses') return topExpenses(transactions, range.start, range.end, limit)
  return reportInsights(transactions, range)
}
