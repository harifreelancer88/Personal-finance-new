import { calculateCashFlow, calculateDashboard, type DashboardAccount, type DashboardTransaction } from '../lib/dashboard-calculations'

async function dashboardData(db: D1Database, workspaceId: string) {
  const [accounts, transactions] = await Promise.all([
    db.prepare(`SELECT a.account_type, a.opening_balance_minor + COALESCE(SUM(CASE
      WHEN t.status <> 'confirmed' THEN 0 WHEN t.from_account_id = a.id THEN -t.amount_minor
      WHEN t.to_account_id = a.id THEN t.amount_minor ELSE 0 END), 0) AS current_balance_minor
      FROM accounts a LEFT JOIN transactions t ON (t.from_account_id = a.id OR t.to_account_id = a.id)
      WHERE a.workspace_id = ? GROUP BY a.id`).bind(workspaceId).all<DashboardAccount>(),
    db.prepare(`SELECT t.transaction_type, t.amount_minor, t.transaction_date, t.status,
      original.transaction_type AS original_transaction_type, c.kind AS category_kind
      FROM transactions t LEFT JOIN transactions original ON original.id = t.original_transaction_id
      LEFT JOIN categories c ON c.id = t.category_id WHERE t.workspace_id = ?`).bind(workspaceId).all<DashboardTransaction>(),
  ])
  return { accounts: accounts.results, transactions: transactions.results }
}

export async function getDashboardSummary(db: D1Database, workspaceId: string, now = new Date()) {
  const { accounts, transactions } = await dashboardData(db, workspaceId)
  return calculateDashboard(accounts, transactions, now)
}

export async function getDashboardCashFlow(db: D1Database, workspaceId: string, now = new Date()) {
  const { transactions } = await dashboardData(db, workspaceId)
  return calculateCashFlow(transactions, now)
}
