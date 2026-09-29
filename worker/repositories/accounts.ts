import type { AccountRow } from '../types'

export interface AccountWrite {
  name: string; institution: string; accountType: AccountRow['account_type']; last4: string | null
  openingBalanceMinor: number; openingBalanceDate: string | null; creditLimitMinor: number | null
  billingDay: number | null; dueDay: number | null; notes: string | null; isActive: boolean
}

export type AccountWithBalance = AccountRow & { current_balance_minor: number }

export async function listAccounts(db: D1Database, workspaceId: string): Promise<AccountWithBalance[]> {
  const result = await db.prepare(`
    SELECT a.*, a.opening_balance_minor + COALESCE(SUM(CASE
      WHEN t.status <> 'confirmed' THEN 0
      WHEN t.from_account_id = a.id THEN -t.amount_minor
      WHEN t.to_account_id = a.id THEN t.amount_minor ELSE 0 END), 0) AS current_balance_minor
    FROM accounts a LEFT JOIN transactions t ON (t.from_account_id = a.id OR t.to_account_id = a.id)
    WHERE a.workspace_id = ? GROUP BY a.id ORDER BY a.is_active DESC, a.name ASC
  `).bind(workspaceId).all<AccountWithBalance>()

  return result.results
}

export function getAccount(db: D1Database, workspaceId: string, id: string): Promise<AccountWithBalance | null> {
  return db.prepare(`SELECT a.*, a.opening_balance_minor + COALESCE(SUM(CASE WHEN t.status <> 'confirmed' THEN 0 WHEN t.from_account_id = a.id THEN -t.amount_minor WHEN t.to_account_id = a.id THEN t.amount_minor ELSE 0 END), 0) AS current_balance_minor FROM accounts a LEFT JOIN transactions t ON (t.from_account_id = a.id OR t.to_account_id = a.id) WHERE a.workspace_id = ? AND a.id = ? GROUP BY a.id`).bind(workspaceId, id).first<AccountWithBalance>()
}

export async function createAccount(db: D1Database, workspaceId: string, value: AccountWrite) {
  const id = crypto.randomUUID()
  await db.prepare(`INSERT INTO accounts (id, workspace_id, name, institution, account_type, last4, opening_balance_minor, opening_balance_date, credit_limit_minor, billing_day, due_day, notes, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, workspaceId, value.name, value.institution, value.accountType, value.last4, value.openingBalanceMinor, value.openingBalanceDate, value.creditLimitMinor, value.billingDay, value.dueDay, value.notes, value.isActive ? 1 : 0).run()
  return (await getAccount(db, workspaceId, id))!
}

export async function updateAccount(db: D1Database, workspaceId: string, id: string, value: AccountWrite) {
  await db.prepare(`UPDATE accounts SET name=?, institution=?, account_type=?, last4=?, opening_balance_minor=?, opening_balance_date=?, credit_limit_minor=?, billing_day=?, due_day=?, notes=?, is_active=?, updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?`)
    .bind(value.name, value.institution, value.accountType, value.last4, value.openingBalanceMinor, value.openingBalanceDate, value.creditLimitMinor, value.billingDay, value.dueDay, value.notes, value.isActive ? 1 : 0, workspaceId, id).run()
  return (await getAccount(db, workspaceId, id))!
}

export async function accountInUse(db: D1Database, workspaceId: string, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS found FROM transactions WHERE workspace_id=? AND (from_account_id=? OR to_account_id=?) LIMIT 1').bind(workspaceId, id, id).first()
  return Boolean(row)
}

export async function deleteAccount(db: D1Database, workspaceId: string, id: string) {
  const result = await db.prepare('DELETE FROM accounts WHERE workspace_id=? AND id=?').bind(workspaceId, id).run()
  return (result.meta.changes ?? 0) > 0
}
