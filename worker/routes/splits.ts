import type { Env } from '../types'
import { success, methodNotAllowed } from '../lib/http'
import { invalid, jsonBody, minor, textValue } from '../lib/workflow-utils'
export async function splitsRoute(request: Request, env: Env, id: string) {
  const db = env.DB,
    ws = env.DEFAULT_WORKSPACE_ID,
    tx = await db
      .prepare('SELECT * FROM transactions WHERE id=? AND workspace_id=?')
      .bind(id, ws)
      .first<{
        amount_minor: number
        transaction_type: string
        category_id: string | null
      }>()
  if (!tx) invalid('Transaction not found.', 404)
  if (request.method === 'GET')
    return success(
      (
        await db
          .prepare(
            'SELECT s.*,c.name category_name FROM transaction_splits s JOIN categories c ON c.id=s.category_id WHERE transaction_id=? ORDER BY c.name',
          )
          .bind(id)
          .all()
      ).results,
    )
  if (request.method !== 'PUT') return methodNotAllowed()
  const b = await jsonBody(request),
    splits = b.splits
  if (!['expense', 'income'].includes(tx.transaction_type))
    invalid('Only expenses and income can be split.')
  if (!Array.isArray(splits) || splits.length > 10)
    invalid('Use up to 10 split rows.')
  if (
    await db
      .prepare(
        'SELECT id FROM transactions WHERE original_transaction_id=? AND workspace_id=? LIMIT 1',
      )
      .bind(id, ws)
      .first()
  )
    invalid('Unlink existing refunds before changing category splits.', 409)
  const rows = splits.map((s) => ({
    categoryId: textValue(s?.categoryId, 'Category'),
    amountMinor: minor(s?.amountMinor),
  }))
  const total = rows.reduce((n, r) => n + r.amountMinor, 0)
  if (
    !Number.isSafeInteger(total) ||
    total > tx.amount_minor ||
    new Set(rows.map((r) => r.categoryId)).size !== rows.length ||
    rows.some((r) => r.categoryId === tx.category_id)
  )
    invalid(
      'Split categories must be distinct from each other and the main category; their total cannot exceed the payment.',
    )
  for (const row of rows)
    if (
      !(await db
        .prepare(
          'SELECT id FROM categories WHERE id=? AND workspace_id=? AND is_active=1',
        )
        .bind(row.categoryId, ws)
        .first())
    )
      invalid('Choose categories in this workspace.')
  await db.batch([
    db
      .prepare('DELETE FROM transaction_splits WHERE transaction_id=?')
      .bind(id),
    ...rows.map((r) =>
      db
        .prepare(
          'INSERT INTO transaction_splits(id,transaction_id,category_id,amount_minor) VALUES (?,?,?,?)',
        )
        .bind(crypto.randomUUID(), id, r.categoryId, r.amountMinor),
    ),
  ])
  return success({
    id,
    splitTotalMinor: total,
    remainderMinor: tx.amount_minor - total,
  })
}
