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

export async function listTransactions(db: D1Database, workspaceId: string, filters: TransactionFilters): Promise<TransactionRow[]> {
  const where = ['workspace_id = ?']
  const values: unknown[] = [workspaceId]
  if (filters.search) { where.push('(description LIKE ? ESCAPE \'\\\' OR notes LIKE ? ESCAPE \'\\\')'); const term = `%${filters.search.replace(/[\\%_]/g, '\\$&')}%`; values.push(term, term) }
  if (filters.type) { where.push('transaction_type = ?'); values.push(filters.type) }
  if (filters.categoryId) { where.push('category_id = ?'); values.push(filters.categoryId) }
  if (filters.accountId) { where.push('(from_account_id = ? OR to_account_id = ?)'); values.push(filters.accountId, filters.accountId) }
  if (filters.status) { where.push('status = ?'); values.push(filters.status) }
  if (filters.source) { where.push('source = ?'); values.push(filters.source) }
  if (filters.fromDate) { where.push('transaction_date >= ?'); values.push(filters.fromDate) }
  if (filters.toDate) { where.push('transaction_date <= ?'); values.push(filters.toDate) }
  values.push(filters.limit, filters.offset)
  const result = await db.prepare(`SELECT ${columns} FROM transactions WHERE ${where.join(' AND ')} ORDER BY transaction_date DESC, created_at DESC LIMIT ? OFFSET ?`).bind(...values).all<TransactionRow>()
  return result.results
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
