import type { TransactionRow } from '../types'

export async function listTransactions(db: D1Database, workspaceId: string): Promise<TransactionRow[]> {
  const result = await db.prepare(`
    SELECT id, workspace_id, transaction_type, description, amount_minor,
      category_id, from_account_id, to_account_id, transaction_date, notes,
      source, external_id, original_transaction_id, status, created_at, updated_at
    FROM transactions
    WHERE workspace_id = ?
    ORDER BY transaction_date DESC, created_at DESC
    LIMIT 100
  `).bind(workspaceId).all<TransactionRow>()

  return result.results
}
