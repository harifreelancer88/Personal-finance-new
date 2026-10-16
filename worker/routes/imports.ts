import type { Env } from '../types'
import { success, methodNotAllowed } from '../lib/http'
import {
  invalid,
  jsonBody,
  textValue,
  hash,
  todayIST,
} from '../lib/workflow-utils'
import {
  parseCsv,
  parseMoney,
  parseStatementDate,
} from '../lib/statement-parser'
interface CandidateRow {
  id: string
  description: string
  amount_minor: number
  transaction_date: string
}
interface PreviewRow {
  number: number
  date: string
  amountMinor: number
  type: 'income' | 'expense'
  description: string
  reference: string
  categoryId: string | null
  error: string | null
  candidates: {
    id: string
    description: string
    amount_minor: number
    transaction_date: string
  }[]
}
interface Batch {
  id: string
  account_id: string
  status: string
  payload_json: string
  opening_adjustment_minor: number
  content_hash: string
}
export async function importsRoute(
  request: Request,
  env: Env,
  id?: string,
  action?: string,
) {
  const db = env.DB,
    ws = env.DEFAULT_WORKSPACE_ID
  if (!id && request.method === 'GET')
    return success(
      (
        await db
          .prepare(
            'SELECT id,file_name,account_id,status,created_at,committed_at,opening_adjustment_minor FROM import_batches WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100',
          )
          .bind(ws)
          .all()
      ).results,
    )
  if (!id && request.method === 'POST') {
    const b = await jsonBody(request, 600_000),
      raw = textValue(b.csv, 'CSV', 500_000),
      account = textValue(b.accountId, 'Account'),
      filename = textValue(b.fileName, 'File name'),
      mapping = b.mapping as Record<string, unknown>
    if (!mapping || typeof mapping !== 'object')
      invalid('Map the statement columns.')
    const a = await db
      .prepare(
        'SELECT id,opening_balance_date FROM accounts WHERE id=? AND workspace_id=? AND is_active=1',
      )
      .bind(account, ws)
      .first<{ id: string; opening_balance_date: string | null }>()
    if (!a) invalid('Choose an active account.')
    let csv: string[][]
    try {
      csv = parseCsv(raw)
    } catch (e) {
      invalid(e instanceof Error ? e.message : 'Invalid CSV.')
    }
    if (csv.length < 2 || csv.length > 501)
      invalid('Use 1–500 statement rows plus a header.')
    const header = csv[0],
      column = (name: string, required = false) => {
        const v = mapping[name]
        if (v === undefined || v === null || v === '') {
          if (required) invalid(`Map ${name}.`)
          return -1
        }
        const n = Number(v)
        if (!Number.isInteger(n) || n < 0 || n >= header.length)
          invalid(`Invalid ${name} column.`)
        return n
      }
    const dc = column('date', true),
      desc = column('description', true),
      amount = column('amount'),
      debit = column('debit'),
      credit = column('credit'),
      ref = column('reference')
    if (amount < 0 && (debit < 0 || credit < 0))
      invalid('Map signed amount OR separate debit and credit columns.')
    if (amount >= 0 && (debit >= 0 || credit >= 0))
      invalid('Choose one amount convention.')
    if (!['DMY', 'MDY', 'ISO'].includes(String(b.dateFormat)))
      invalid('Choose the date format explicitly.')
    const existing = (
      await db
        .prepare(
          'SELECT id,description,amount_minor,transaction_date,transaction_type,external_id,(SELECT bank_reference FROM sms_messages s WHERE s.transaction_id=transactions.id AND s.workspace_id=transactions.workspace_id AND bank_reference IS NOT NULL LIMIT 1) bank_reference FROM transactions WHERE workspace_id=? AND (from_account_id=? OR to_account_id=?)',
        )
        .bind(ws, account, account)
        .all<{
          id: string
          description: string
          amount_minor: number
          transaction_date: string
          transaction_type: string
          external_id: string | null
          bank_reference: string | null
        }>()
    ).results
    const rows: PreviewRow[] = csv.slice(1).map((cells, i) => {
      let n: number | null = null,
        error: string | null = null
      if (cells.length !== header.length)
        error = 'Column count does not match the header.'
      if (amount >= 0) n = parseMoney(cells[amount] ?? '')
      else {
        const dr = (cells[debit] ?? '').trim(),
          cr = (cells[credit] ?? '').trim()
        const d = dr ? parseMoney(dr) : 0,
          c = cr ? parseMoney(cr) : 0
        if (d !== null && c !== null && d >= 0 && c >= 0 && d > 0 !== c > 0)
          n = c - d
      }
      const date = parseStatementDate(cells[dc] ?? '', String(b.dateFormat)),
        description = (cells[desc] ?? '').trim(),
        reference = ref >= 0 ? (cells[ref] ?? '').trim() : ''
      if (!date || date > todayIST())
        error = 'Invalid or future transaction date.'
      if (!description || description.length > 200)
        error = 'Description is required (maximum 200 characters).'
      if (n === null || n === 0)
        error = 'Invalid amount; check debit/credit and decimal format.'
      const type = n !== null && n > 0 ? 'income' : 'expense'
      const candidates = existing
        .filter(
          (t) =>
            (t.transaction_date === date &&
              t.amount_minor === Math.abs(n ?? 0)) ||
            (reference &&
              (t.external_id === reference || t.bank_reference === reference)),
        )
        .slice(0, 10)
      if (
        a.opening_balance_date &&
        date &&
        date <= a.opening_balance_date &&
        b.preserveBalance !== true
      )
        error =
          'This row is on/before the opening balance date. Choose historical backfill or omit it.'
      return {
        number: i + 1,
        date: date ?? '',
        description,
        reference,
        amountMinor: Math.abs(n ?? 0),
        type,
        categoryId: null,
        error,
        candidates,
      }
    })
    const signature = await hash(
        JSON.stringify({
          raw,
          account,
          mapping,
          dateFormat: b.dateFormat,
          preserveBalance: b.preserveBalance === true,
        }),
      ),
      old = await db
        .prepare(
          'SELECT id,status FROM import_batches WHERE workspace_id=? AND account_id=? AND content_hash=?',
        )
        .bind(ws, account, signature)
        .first<{ id: string; status: string }>()
    if (old)
      return success({
        id: old.id,
        status: old.status,
        rows:
          old.status === 'preview'
            ? JSON.parse(
                (await db
                  .prepare('SELECT payload_json FROM import_batches WHERE id=?')
                  .bind(old.id)
                  .first<{ payload_json: string }>())!.payload_json,
              ).rows
            : [],
        alreadyExists: true,
      })
    const bid = crypto.randomUUID(),
      payload = JSON.stringify({
        rows,
        preserveBalance: b.preserveBalance === true,
      })
    await db
      .prepare(
        'INSERT INTO import_batches(id,workspace_id,account_id,file_name,content_hash,payload_json) VALUES (?,?,?,?,?,?)',
      )
      .bind(bid, ws, account, filename, signature, payload)
      .run()
    return success({ id: bid, status: 'preview', rows }, { status: 201 })
  }
  const batch = await db
    .prepare('SELECT * FROM import_batches WHERE id=? AND workspace_id=?')
    .bind(id, ws)
    .first<Batch>()
  if (!batch) invalid('Import not found.', 404)
  if (!action && request.method === 'GET') {
    const payload = JSON.parse(batch.payload_json),
      live = (
        await db
          .prepare(
            'SELECT id,description,amount_minor,transaction_date FROM transactions WHERE workspace_id=? AND (from_account_id=? OR to_account_id=?)',
          )
          .bind(ws, batch.account_id, batch.account_id)
          .all<CandidateRow>()
      ).results
    return success({
      ...batch,
      ...payload,
      rows: (payload.rows as PreviewRow[]).map((r) => ({
        ...r,
        candidates: live
          .filter(
            (t) =>
              t.transaction_date === r.date && t.amount_minor === r.amountMinor,
          )
          .slice(0, 10),
      })),
    })
  }
  if (action === 'commit' && request.method === 'POST') {
    if (batch.status === 'committed')
      return success({ id, alreadyCommitted: true })
    if (batch.status !== 'preview')
      invalid('This batch is no longer importable.', 409)
    const b = await jsonBody(request),
      selected = b.selectedRows,
      overrides = (b.categories ?? {}) as Record<string, string>,
      accepted = b.acceptDuplicateRows ?? []
    if (
      !Array.isArray(selected) ||
      selected.length < 1 ||
      selected.length > 500 ||
      new Set(selected).size !== selected.length
    )
      invalid('Select 1–500 distinct rows.')
    const payload = JSON.parse(batch.payload_json),
      all = payload.rows as PreviewRow[],
      rows = selected.map((n) => all.find((r) => r.number === n))
    if (rows.some((r) => !r || r.error))
      invalid('Selection contains invalid statement rows.')
    for (const cat of new Set(Object.values(overrides)))
      if (
        cat &&
        !(await db
          .prepare(
            'SELECT id FROM categories WHERE id=? AND workspace_id=? AND is_active=1',
          )
          .bind(cat, ws)
          .first())
      )
        invalid('Invalid category.')
    // Re-evaluate against live transactions, including SMS received since preview.
    const current = (
      await db
        .prepare(
          'SELECT id,amount_minor,transaction_date FROM transactions WHERE workspace_id=? AND (from_account_id=? OR to_account_id=?)',
        )
        .bind(ws, batch.account_id, batch.account_id)
        .all<{ id: string; amount_minor: number; transaction_date: string }>()
    ).results
    for (const r of rows as PreviewRow[])
      if (
        current.some(
          (t) =>
            t.transaction_date === r.date && t.amount_minor === r.amountMinor,
        ) &&
        (!Array.isArray(accepted) || !accepted.includes(r.number))
      )
        invalid(
          `Row ${r.number} now has a possible duplicate. Review it before importing.`,
          409,
        )
    const posted = (rows as PreviewRow[]).map((r) => ({
        ...r,
        id: `import-${id}-${r.number}`,
        categoryId: overrides[String(r.number)] || null,
      })),
      json = JSON.stringify(posted),
      delta = posted.reduce(
        (s, r) => s + (r.type === 'income' ? r.amountMinor : -r.amountMinor),
        0,
      )
    if (!Number.isSafeInteger(delta))
      invalid('The statement total is too large.')
    const stmts = [
      db
        .prepare('INSERT INTO workflow_claims(id,workspace_id) VALUES (?,?)')
        .bind('commit-' + id, ws),
      db
        .prepare(
          'INSERT INTO import_commit_guards(batch_id,workspace_id,planned_ids_json,allowed_matches_json) VALUES (?,?,?,?)',
        )
        .bind(
          id,
          ws,
          JSON.stringify(posted.map((r) => r.id)),
          JSON.stringify(
            Object.fromEntries(
              posted.map((r) => [
                r.id,
                Array.isArray(accepted) && accepted.includes(r.number)
                  ? current
                      .filter(
                        (t) =>
                          t.transaction_date === r.date &&
                          t.amount_minor === r.amountMinor,
                      )
                      .map((t) => t.id)
                  : [],
              ]),
            ),
          ),
        ),
      db
        .prepare(
          `INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,category_id,from_account_id,to_account_id,transaction_date,notes,source,external_id,status,category_origin)
   SELECT json_extract(value,'$.id'),?,json_extract(value,'$.type'),json_extract(value,'$.description'),json_extract(value,'$.amountMinor'),json_extract(value,'$.categoryId'),CASE WHEN json_extract(value,'$.type')='expense' THEN ? END,CASE WHEN json_extract(value,'$.type')='income' THEN ? END,json_extract(value,'$.date'),json_extract(value,'$.reference'),'import',json_extract(value,'$.id'),'confirmed',CASE WHEN json_extract(value,'$.categoryId') IS NOT NULL THEN 'manual' END FROM json_each(?)`,
        )
        .bind(ws, batch.account_id, batch.account_id, json),
      db
        .prepare(
          `INSERT INTO import_rows(batch_id,row_number,transaction_id,fingerprint) SELECT ?,json_extract(value,'$.number'),json_extract(value,'$.id'),json_extract(value,'$.id') FROM json_each(?)`,
        )
        .bind(id, json),
    ]
    if (payload.preserveBalance)
      stmts.push(
        db
          .prepare(
            'UPDATE accounts SET opening_balance_minor=opening_balance_minor-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?',
          )
          .bind(delta, batch.account_id, ws),
      )
    stmts.push(
      db
        .prepare(
          "UPDATE import_batches SET status='committed',committed_at=CURRENT_TIMESTAMP,opening_adjustment_minor=? WHERE id=? AND status='preview'",
        )
        .bind(payload.preserveBalance ? -delta : 0, id),
    )
    stmts.push(
      db.prepare('DELETE FROM import_commit_guards WHERE batch_id=?').bind(id),
    )
    await db.batch(stmts)
    return success({
      id,
      imported: posted.length,
      balanceChangeMinor: payload.preserveBalance ? 0 : delta,
    })
  }
  if (action === 'undo' && request.method === 'POST') {
    if (batch.status === 'undone') return success({ id })
    if (batch.status !== 'committed')
      invalid('Only completed imports can be undone.')
    const ids = (
      await db
        .prepare('SELECT transaction_id FROM import_rows WHERE batch_id=?')
        .bind(id)
        .all<{ transaction_id: string }>()
    ).results.map((r) => r.transaction_id)
    const json = JSON.stringify(ids)
    const remaining = await db
      .prepare(
        'SELECT COUNT(*) n FROM transactions WHERE workspace_id=? AND id IN (SELECT value FROM json_each(?))',
      )
      .bind(ws, json)
      .first<{ n: number }>()
    if (remaining?.n !== ids.length)
      invalid(
        'An imported transaction was deleted. This batch requires manual reconciliation before undo.',
        409,
      )
    // Refuse rather than erase later edits, salary evidence, investment matches or bill links.
    const changed = await db
      .prepare(
        `SELECT t.id FROM transactions t WHERE t.id IN (SELECT value FROM json_each(?)) AND (t.category_revision>0 OR t.status<>'confirmed' OR t.transaction_type NOT IN ('income','expense') OR EXISTS(SELECT 1 FROM transactions r WHERE r.original_transaction_id=t.id) OR EXISTS(SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id) OR EXISTS(SELECT 1 FROM payroll_records p WHERE p.transaction_id=t.id) OR EXISTS(SELECT 1 FROM bill_periods p WHERE p.transaction_id=t.id) OR EXISTS(SELECT 1 FROM investment_payments p WHERE p.transaction_id=t.id)) LIMIT 1`,
      )
      .bind(json)
      .first()
    if (changed)
      invalid(
        'An imported transaction was edited or linked to another record. Review those links before undoing.',
        409,
      )
    await db.batch([
      db
        .prepare(
          `INSERT INTO workflow_claims(id,workspace_id,eligible) SELECT ?,?,CASE WHEN
          (SELECT count(*) FROM transactions WHERE workspace_id=? AND id IN (SELECT value FROM json_each(?)))=?
          AND NOT EXISTS(SELECT 1 FROM transactions t WHERE t.id IN (SELECT value FROM json_each(?)) AND (t.category_revision>0 OR t.status<>'confirmed' OR t.transaction_type NOT IN ('income','expense') OR EXISTS(SELECT 1 FROM transactions r WHERE r.original_transaction_id=t.id) OR EXISTS(SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id) OR EXISTS(SELECT 1 FROM payroll_records p WHERE p.transaction_id=t.id) OR EXISTS(SELECT 1 FROM bill_periods p WHERE p.transaction_id=t.id) OR EXISTS(SELECT 1 FROM investment_payments p WHERE p.transaction_id=t.id)))
          THEN 1 ELSE 0 END`,
        )
        .bind('undo-' + id, ws, ws, json, ids.length, json),
      db.prepare('DELETE FROM import_rows WHERE batch_id=?').bind(id),
      db
        .prepare(
          'DELETE FROM transactions WHERE workspace_id=? AND id IN (SELECT value FROM json_each(?))',
        )
        .bind(ws, json),
      db
        .prepare(
          'UPDATE accounts SET opening_balance_minor=opening_balance_minor-? WHERE id=? AND workspace_id=?',
        )
        .bind(batch.opening_adjustment_minor, batch.account_id, ws),
      db
        .prepare("UPDATE import_batches SET status='undone' WHERE id=?")
        .bind(id),
    ])
    return success({ id, removed: ids.length })
  }
  return methodNotAllowed()
}
