import type { TransactionRow } from '../types'

const columns = `id, workspace_id, transaction_type, description, amount_minor,
  category_id, from_account_id, to_account_id, transaction_date, notes,
  source, external_id, original_transaction_id, status, created_at, updated_at`

export interface TransactionFilters {
  search?: string
  type?: string
  categoryId?: string
  accountId?: string
  status?: string
  source?: string
  fromDate?: string
  toDate?: string
  limit: number
  offset: number
}

export interface TransactionWrite {
  transactionType: TransactionRow['transaction_type']
  description: string
  amountMinor: number
  categoryId: string | null
  fromAccountId: string | null
  toAccountId: string | null
  transactionDate: string
  notes: string | null
  originalTransactionId: string | null
  status: TransactionRow['status']
}

const joins = `FROM transactions t
  LEFT JOIN categories c ON c.id=t.category_id AND c.workspace_id=t.workspace_id
  LEFT JOIN accounts fa ON fa.id=t.from_account_id AND fa.workspace_id=t.workspace_id
  LEFT JOIN accounts ta ON ta.id=t.to_account_id AND ta.workspace_id=t.workspace_id
  LEFT JOIN transactions original ON original.id=t.original_transaction_id AND original.workspace_id=t.workspace_id`
const listColumns = columns.split(',').map(column => `t.${column.trim()}`).join(', ')

function listConditions(workspaceId: string, filters: TransactionFilters) {
  const where = ['t.workspace_id = ?']
  const values: unknown[] = [workspaceId]
  if (filters.search) {
    where.push(`(t.description LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR fa.name LIKE ? ESCAPE '\\' OR ta.name LIKE ? ESCAPE '\\')`)
    const term = `%${filters.search.replace(/[\\%_]/g, '\\$&')}%`
    values.push(term, term, term, term, term)
  }
  if (filters.type) { where.push('t.transaction_type = ?'); values.push(filters.type) }
  if (filters.categoryId) { where.push('t.category_id = ?'); values.push(filters.categoryId) }
  if (filters.accountId) { where.push('(t.from_account_id = ? OR t.to_account_id = ?)'); values.push(filters.accountId, filters.accountId) }
  if (filters.status) { where.push('t.status = ?'); values.push(filters.status) }
  if (filters.source) { where.push('t.source = ?'); values.push(filters.source) }
  if (filters.fromDate) { where.push('t.transaction_date >= ?'); values.push(filters.fromDate) }
  if (filters.toDate) { where.push('t.transaction_date <= ?'); values.push(filters.toDate) }
  return { clause: where.join(' AND '), values }
}

function listStatement(db: D1Database, workspaceId: string, filters: TransactionFilters) {
  const { clause, values } = listConditions(workspaceId, filters)
  return db.prepare(`SELECT ${listColumns} ${joins} WHERE ${clause} ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`).bind(...values, filters.limit, filters.offset)
}

export async function listTransactions(db: D1Database, workspaceId: string, filters: TransactionFilters): Promise<TransactionRow[]> {
  const result = await listStatement(db, workspaceId, filters).all<TransactionRow>()
  return result.results
}

/** Count and money summaries cover every matching record, independent of the page limit. */
export async function getTransactionPage(db: D1Database, workspaceId: string, filters: TransactionFilters) {
  const { clause, values } = listConditions(workspaceId, filters)
  const totals = db.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN t.status='confirmed' AND t.transaction_type='income' THEN t.amount_minor ELSE 0 END),0) AS incomeMinor,
    MAX(0,COALESCE(SUM(CASE WHEN t.status<>'confirmed' THEN 0
      WHEN t.transaction_type='expense' THEN t.amount_minor
      WHEN t.transaction_type='refund' AND (original.transaction_type='expense' OR c.kind IN ('expense','both')) THEN -t.amount_minor
      ELSE 0 END),0)) AS expenseMinor,
    COALESCE(SUM(CASE WHEN t.status='confirmed' THEN 1 ELSE 0 END),0) AS confirmedCount
    ${joins} WHERE ${clause}`).bind(...values)
  const [rows, counts] = await db.batch([listStatement(db, workspaceId, filters), totals])
  const aggregate = counts.results[0] as { total: number; incomeMinor: number; expenseMinor: number; confirmedCount: number }
  return { items: rows.results as unknown as TransactionRow[], total: aggregate.total,
    summary: { incomeMinor: aggregate.incomeMinor, expenseMinor: aggregate.expenseMinor,
      netCashFlowMinor: aggregate.incomeMinor-aggregate.expenseMinor, confirmedCount: aggregate.confirmedCount } }
}

export function getTransaction(db: D1Database, workspaceId: string, id: string): Promise<TransactionRow | null> {
  return db.prepare(`SELECT ${columns} FROM transactions WHERE workspace_id = ? AND id = ?`).bind(workspaceId, id).first<TransactionRow>()
}

export async function createTransaction(db: D1Database, workspaceId: string, value: TransactionWrite): Promise<TransactionRow> {
  const id = crypto.randomUUID()
  await db.prepare(`INSERT INTO transactions (id, workspace_id, transaction_type, description, amount_minor, category_id, from_account_id, to_account_id, transaction_date, notes, source, original_transaction_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`)
    .bind(id, workspaceId, value.transactionType, value.description, value.amountMinor, value.categoryId, value.fromAccountId, value.toAccountId, value.transactionDate, value.notes, value.originalTransactionId, value.status).run()
  return (await getTransaction(db, workspaceId, id))!
}

export async function updateTransaction(db: D1Database, workspaceId: string, id: string, value: TransactionWrite): Promise<TransactionRow> {
  await db.prepare(`UPDATE transactions SET transaction_type = ?, description = ?, amount_minor = ?, category_id = ?, from_account_id = ?, to_account_id = ?, transaction_date = ?, notes = ?, original_transaction_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?`)
    .bind(value.transactionType, value.description, value.amountMinor, value.categoryId, value.fromAccountId, value.toAccountId, value.transactionDate, value.notes, value.originalTransactionId, value.status, workspaceId, id).run()
  return (await getTransaction(db, workspaceId, id))!
}

export async function deleteTransaction(db: D1Database, workspaceId: string, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM transactions WHERE workspace_id = ? AND id = ? AND source = 'manual'").bind(workspaceId, id).run()
  return (result.meta.changes ?? 0) > 0
}
