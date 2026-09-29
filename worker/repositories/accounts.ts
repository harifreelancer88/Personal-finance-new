import type { AccountRow } from '../types'

export async function listAccounts(db: D1Database, workspaceId: string): Promise<AccountRow[]> {
  const result = await db.prepare(`
    SELECT id, workspace_id, name, institution, account_type, last4,
      opening_balance_minor, opening_balance_date, credit_limit_minor, billing_day, due_day,
      notes, is_active, created_at, updated_at
    FROM accounts
    WHERE workspace_id = ?
    ORDER BY is_active DESC, name ASC
  `).bind(workspaceId).all<AccountRow>()

  return result.results
}
