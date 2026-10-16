import type {
  StatementExtraction,
  StatementSource,
  StatementType,
  ReviewedStatementRow,
  StatementReview,
  StatementCandidate,
} from '../../shared/statement-import'
import type { Env } from '../types'
import { parseMoney } from './statement-parser'
import { normalizeStatementExtraction } from './statement-normalization'
import { dateOnly, hash, todayIST, invalid } from './workflow-utils'
export interface StatementBatch {
  id: string
  workspace_id: string
  statement_type: StatementType
  target_id: string
  file_name: string
  sheet_name: string
  content_hash: string
  source_json: string
  status: string
  parsed_json: string
  next_chunk: number
  lease_token: string | null
  attempts: number
  error: string | null
  result_json: string | null
}
export const CHUNK_SIZE = 40
export function targetSql(type: StatementType) {
  return type === 'bank'
    ? 'SELECT * FROM accounts WHERE id=? AND workspace_id=?'
    : 'SELECT * FROM investments WHERE id=? AND workspace_id=? AND investment_type=?'
}
export async function statementTarget(
  env: Env,
  type: StatementType,
  id: string,
) {
  const query = env.DB.prepare(targetSql(type))
  const row = await (
    type === 'bank'
      ? query.bind(id, env.DEFAULT_WORKSPACE_ID)
      : query.bind(id, env.DEFAULT_WORKSPACE_ID, type)
  ).first<Record<string, any>>()
  if (
    !row ||
    (type === 'bank' &&
      (!row.is_active ||
        !['bank', 'credit_card', 'wallet', 'cash'].includes(row.account_type)))
  )
    invalid(
      'Choose a matching account or retirement holding in this workspace.',
    )
  return row
}
export function validDate(value: string | null) {
  try {
    return value && dateOnly(value) <= todayIST() ? value : null
  } catch {
    return null
  }
}
export function positiveMoney(v: string | null) {
  const n = v === null ? null : parseMoney(v)
  return n !== null && n > 0 ? n : null
}
export function nonnegativeMoney(v: string | null) {
  const n = v === null ? null : parseMoney(v)
  return n !== null && n >= 0 ? n : null
}
function numericCells(cells: string[]) {
  return cells
    .map((c) => parseMoney(c.replace(/^Rs\.?\s*/i, '')))
    .filter((n): n is number => n !== null)
    .map(Math.abs)
}
export function fingerprintText(
  row: {
    date: string | null
    description: string
    kind: string
    direction: string
    amountMinor: number
    reference: string
    salaryMonth: string | null
  },
  occurrence = 0,
) {
  return JSON.stringify([
    row.date,
    row.kind,
    row.direction,
    row.amountMinor,
    row.reference.trim().toUpperCase(),
    row.reference
      ? ''
      : row.description.trim().replace(/\s+/g, ' ').toUpperCase(),
    row.salaryMonth,
    occurrence,
  ])
}
export async function reviewStatement(
  env: Env,
  batch: StatementBatch,
): Promise<StatementReview> {
  const source: StatementSource = JSON.parse(batch.source_json),
    extraction: StatementExtraction =
      batch.status === 'committed'
        ? JSON.parse(batch.parsed_json)
        : normalizeStatementExtraction(
            JSON.parse(batch.parsed_json),
            source.rows,
            batch.statement_type,
          ),
    target = await statementTarget(env, batch.statement_type, batch.target_id),
    ws = env.DEFAULT_WORKSPACE_ID,
    bank = batch.statement_type === 'bank'
  const [txs, credits, receipts, audit, activities, nps] = await Promise.all([
    env.DB.prepare(
      bank
        ? 'SELECT * FROM transactions WHERE workspace_id=? AND (from_account_id=? OR to_account_id=?)'
        : "SELECT * FROM transactions WHERE workspace_id=? AND transaction_type='investment' AND status='confirmed' AND instr(COALESCE(notes,''),?)>0 AND NOT EXISTS(SELECT 1 FROM nps_credit_matches m WHERE m.transaction_id=transactions.id)",
    )
      .bind(
        ...(bank
          ? [ws, batch.target_id, batch.target_id]
          : [ws, `[investment-holding:${batch.target_id}]`]),
      )
      .all<Record<string, any>>(),
    env.DB.prepare(
      'SELECT c.*,p.payroll_month,t.status transaction_status FROM payroll_contributions c JOIN payroll_records p ON p.id=c.payroll_id JOIN transactions t ON t.id=p.transaction_id WHERE p.workspace_id=? AND c.scheme IN (?,?)',
    )
      .bind(
        ws,
        batch.statement_type,
        batch.statement_type === 'epf' ? 'eps' : batch.statement_type,
      )
      .all<Record<string, any>>(),
    env.DB.prepare(
      'SELECT * FROM statement_import_items WHERE workspace_id=? AND statement_type=? AND target_id=?',
    )
      .bind(ws, batch.statement_type, batch.target_id)
      .all<Record<string, any>>(),
    env.DB.prepare(
      'SELECT COALESCE(SUM(input_tokens+output_tokens),0) tokens FROM statement_ai_attempts WHERE import_id=?',
    )
      .bind(batch.id)
      .first<{ tokens: number }>(),
    env.DB.prepare('SELECT * FROM investment_activity WHERE investment_id=?')
      .bind(batch.target_id)
      .all<Record<string, any>>(),
    env.DB.prepare(
      'SELECT data_json FROM nps_statements WHERE investment_id=? AND workspace_id=?',
    )
      .bind(batch.target_id, ws)
      .all<{ data_json: string }>(),
  ])
  const seen = new Map<string, number>(),
    sourceById = new Map(source.rows.map((r) => [r.number, r])),
    rows: ReviewedStatementRow[] = []
  for (const parsed of extraction.rows) {
    const errors: string[] = [],
      amount = positiveMoney(parsed.amount),
      employee = nonnegativeMoney(parsed.employee),
      employer = nonnegativeMoney(parsed.employer),
      pension = nonnegativeMoney(parsed.pension),
      sourceRow = sourceById.get(parsed.sourceRow)
    if (!['debit', 'credit'].includes(parsed.direction))
      errors.push('Choose debit or credit.')
    if (!parsed.description?.trim() || parsed.description.length > 200)
      errors.push('Description is required (maximum 200 characters).')
    if (!validDate(parsed.date))
      errors.push('Choose a valid date no later than today.')
    if (amount === null) errors.push('Enter a positive amount in rupees.')
    if (!sourceRow) errors.push('Source row is missing.')
    if (
      parsed.salaryMonth !== null &&
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(parsed.salaryMonth)
    )
      errors.push('Salary month is invalid.')
    if (
      bank &&
      !['expense', 'income', 'transfer', 'investment', 'refund'].includes(
        parsed.kind,
      )
    )
      errors.push('Choose a bank transaction type.')
    if (
      !bank &&
      !['contribution', 'interest', 'fee', 'withdrawal'].includes(parsed.kind)
    )
      errors.push('Choose a retirement movement type.')
    if (
      !bank &&
      parsed.kind === 'contribution' &&
      employee !== null &&
      employer !== null &&
      employee + employer !== amount
    )
      errors.push(
        'Employee + employer EPF/NPS must equal the contribution; exclude EPS.',
      )
    if (
      !Number.isSafeInteger((employee ?? 0) + (employer ?? 0)) ||
      !Number.isSafeInteger((employee ?? 0) + (employer ?? 0) + (pension ?? 0))
    )
      errors.push('Contribution total exceeds supported precision.')
    const sourceAmounts = sourceRow ? numericCells(sourceRow.cells) : []
    if (
      (parsed.employee !== null && employee === null) ||
      (parsed.employer !== null && employer === null) ||
      (parsed.pension !== null && pension === null)
    )
      errors.push('Invalid retirement component amount.')
    if (
      amount !== null &&
      !sourceAmounts.includes(amount) &&
      !(
        employee !== null &&
        employer !== null &&
        employee + employer === amount &&
        sourceAmounts.includes(employee) &&
        sourceAmounts.includes(employer)
      )
    )
      errors.push(
        'Amount is not supported by numeric source cells. Check the row.',
      )
    const item = {
        ...parsed,
        amountMinor: amount ?? 0,
        employeeMinor: employee,
        employerMinor: employer,
        pensionMinor: pension,
      },
      base = fingerprintText(item),
      occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    const key = await hash(fingerprintText(item, occurrence)),
      receipt = receipts.results.find((r) => r.fingerprint === key)
    const candidates: StatementCandidate[] = []
    const legacyNps =
      !bank &&
      batch.statement_type === 'nps' &&
      parsed.kind === 'contribution' &&
      nps.results.some((s) => {
        try {
          return JSON.parse(s.data_json).credits?.some(
            (c: any) =>
              c.date === parsed.date &&
              c.salaryMonth === parsed.salaryMonth &&
              c.amountMinor === amount,
          )
        } catch {
          return false
        }
      })
    if (!bank)
      for (const a of activities.results)
        if (
          a.activity_date === parsed.date &&
          a.amount_minor === amount &&
          a.activity_type ===
            (parsed.kind === 'contribution'
              ? 'contribution'
              : parsed.kind === 'interest'
                ? 'interest'
                : parsed.kind === 'withdrawal'
                  ? 'sale'
                  : 'adjustment')
        )
          candidates.push({
            id: a.id,
            label: a.description,
            date: a.activity_date,
            amountMinor: a.amount_minor,
            type: 'activity',
            revision: 0,
          })
    for (const t of txs.results) {
      const sameDirection = bank
        ? parsed.direction === 'debit'
          ? t.from_account_id === batch.target_id
          : t.to_account_id === batch.target_id
        : true
      if (
        t.status === 'confirmed' &&
        t.amount_minor === amount &&
        sameDirection &&
        ((!bank &&
          parsed.salaryMonth &&
          String(t.notes).includes(
            `[salary-ledger:${parsed.salaryMonth}:nps]`,
          )) ||
          (parsed.date &&
            Math.abs(
              Date.parse(t.transaction_date) - Date.parse(parsed.date),
            ) <=
              3 * 86400000) ||
          (parsed.reference && t.external_id === parsed.reference))
      ) {
        if (!bank && receipts.results.some((r) => r.transaction_id === t.id))
          continue
        if (
          !bank &&
          (!parsed.salaryMonth ||
            !String(t.notes).includes(
              `[salary-ledger:${parsed.salaryMonth}:nps]`,
            ))
        )
          continue
        candidates.push({
          id: t.id,
          label: t.description + ' · ' + t.transaction_type,
          date: t.transaction_date,
          amountMinor: t.amount_minor,
          type: 'transaction',
          revision: t.category_revision ?? 0,
          categoryId: t.category_id,
        })
      }
    }
    if (!bank && parsed.kind === 'contribution')
      for (const c of credits.results) {
        if (
          !c.credited_date &&
          c.transaction_status !== 'ignored' &&
          parsed.salaryMonth === c.payroll_month &&
          (c.scheme === 'eps'
            ? pension === c.amount_minor
            : [amount, employee, employer].includes(c.amount_minor))
        )
          candidates.push({
            id: c.id,
            label: `${c.scheme === 'eps' ? 'pension' : c.contributor} ${c.scheme.toUpperCase()} · ${c.payroll_month}`,
            date: parsed.date ?? '',
            amountMinor: c.amount_minor,
            type: 'payroll',
            revision: c.revision,
          })
      }
    rows.push({
      ...item,
      sourceCells: sourceRow?.cells ?? [],
      key,
      errors,
      candidates,
      status:
        receipt || legacyNps
          ? 'already_imported'
          : errors.length || parsed.reviewReason
            ? 'needs_review'
            : candidates.length
              ? 'possible_match'
              : 'new',
      ...(receipt
        ? {
            receipt: {
              transactionId: receipt.transaction_id,
              activityId: receipt.activity_id,
              contributionId: receipt.contribution_id,
            },
          }
        : {}),
    })
  }
  const blockers: string[] = [],
    warnings = [...extraction.warnings]
  if (new Set(rows.map((r) => r.sourceRow)).size !== rows.length)
    blockers.push('A source row was parsed more than once.')
  const sourceValues = new Set(
    source.rows.flatMap((r) => numericCells(r.cells)),
  )
  for (const field of [
    'openingBalance',
    'closingBalance',
    'principal',
    'employeeBalance',
    'employerBalance',
    'pensionBalance',
  ] as const) {
    const raw = extraction[field]
    if (raw !== null) {
      const value = parseMoney(raw)
      if (value === null) blockers.push('Invalid summary amount: ' + field)
      else if (
        !sourceValues.has(Math.abs(value)) &&
        !(
          field === 'closingBalance' &&
          batch.statement_type === 'epf' &&
          nonnegativeMoney(extraction.employeeBalance) !== null &&
          nonnegativeMoney(extraction.employerBalance) !== null &&
          value ===
            nonnegativeMoney(extraction.employeeBalance)! +
              nonnegativeMoney(extraction.employerBalance)!
        )
      )
        blockers.push(
          'Summary amount is not supported by source cells: ' + field,
        )
    }
  }
  if (bank && batch.status === 'review' && !rows.length)
    blockers.push(
      'No bank movements were parsed. Check the selected worksheet.',
    )
  if (
    extraction.warnings.some((w) => w.startsWith('Conflicting summary field'))
  )
    blockers.push(
      'AI found conflicting statement totals. Correct the source or use a complete single-account statement.',
    )
  const opening = bank
      ? extraction.openingBalance === null
        ? null
        : parseMoney(extraction.openingBalance)
      : nonnegativeMoney(extraction.openingBalance),
    closing = bank
      ? extraction.closingBalance === null
        ? null
        : parseMoney(extraction.closingBalance)
      : nonnegativeMoney(extraction.closingBalance),
    movement = rows.reduce(
      (n, r) =>
        n +
        (bank
          ? r.direction === 'credit'
            ? r.amountMinor
            : -r.amountMinor
          : ['fee', 'withdrawal'].includes(r.kind)
            ? -r.amountMinor
            : r.amountMinor),
      0,
    )
  const difference =
    opening !== null && closing !== null ? opening + movement - closing : null
  if (difference !== null && difference !== 0)
    blockers.push(
      'Opening balance + statement movements does not match closing balance.',
    )
  if (difference === null)
    warnings.push(
      'Opening/closing balance reconciliation is unavailable. Verify completeness against the source.',
    )
  let valuation: StatementReview['valuation'] = null
  if (!bank) {
    const date = validDate(extraction.statementDate),
      ee = nonnegativeMoney(extraction.employeeBalance),
      er = nonnegativeMoney(extraction.employerBalance),
      principal = nonnegativeMoney(extraction.principal)
    let value = closing
    if (batch.statement_type === 'epf') {
      if (ee === null || er === null)
        blockers.push(
          'EPF closing employee and employer balances are required; pension stays separate.',
        )
      else {
        value = ee + er
        if (closing !== null && closing !== value)
          blockers.push(
            'EPF closing balance must exclude EPS/pension and equal employee + employer EPF.',
          )
      }
    }
    if (!date || value === null)
      blockers.push(
        'A valid statement date and closing holding value are required.',
      )
    if (batch.statement_type === 'nps') {
      if (rows.some((r) => r.kind === 'withdrawal'))
        blockers.push(
          'NPS withdrawals require separate cost-basis reconciliation; this importer supports contributions and fees.',
        )
      if (principal === null)
        blockers.push(
          'NPS requires explicitly reported lifetime contributions.',
        )
      if (!extraction.schemes.length)
        blockers.push('NPS scheme summaries with units/NAV are required.')
      let sum = 0
      const names = new Set<string>()
      for (const scheme of extraction.schemes) {
        const v = nonnegativeMoney(scheme.value),
          units = decimal4(scheme.units),
          nav = decimal4(scheme.nav)
        const cells = sourceById.get(scheme.sourceRow)?.cells ?? []
        if (
          !numericCells(cells).includes(v ?? -1) ||
          !cells.some((c) => decimal4(c) === units) ||
          !cells.some((c) => decimal4(c) === nav)
        )
          blockers.push(
            'NPS scheme summary is not supported by its source row.',
          )
        if (
          v === null ||
          units === null ||
          nav === null ||
          names.has(scheme.name) ||
          Math.abs(
            Number(
              (BigInt(units ?? 0) * BigInt(nav ?? 0) + 500000n) / 1000000n,
            ) - (v ?? 0),
          ) > 2
        )
          blockers.push('NPS scheme values, units or NAV do not reconcile.')
        sum += v ?? 0
        names.add(scheme.name)
      }
      if (sum !== value)
        blockers.push(
          'NPS scheme values do not equal the closing holding value.',
        )
      if (
        principal !== null &&
        rows
          .filter((r) => r.kind === 'contribution')
          .reduce((n, r) => n + r.amountMinor, 0) > principal
      )
        blockers.push(
          'Period contributions exceed reported lifetime contributions.',
        )
    }
    if (date && value !== null && Number.isSafeInteger(value))
      valuation = {
        date,
        valueMinor: value,
        investedMinor: principal ?? target.invested_minor,
        basisKind: principal === null ? 'recorded' : 'actual_cost',
      }
  }
  // A commit snapshot includes the destination, matching candidates, evidence and category/account state.
  const state = await statementState(env, batch)
  return {
    id: batch.id,
    statementType: batch.statement_type,
    targetId: batch.target_id,
    fileName: batch.file_name,
    sheetName: batch.sheet_name,
    status: batch.status,
    progress: batch.next_chunk,
    totalChunks: Math.ceil(source.rows.length / CHUNK_SIZE),
    error: batch.error,
    rows,
    extraction,
    warnings: [...new Set(warnings)],
    blockers: [...new Set(blockers)],
    model: 'gpt-4o-mini',
    tokens: audit?.tokens ?? 0,
    expectedTarget: await hash(state),
    canUpdateValuation:
      !!valuation &&
      (!target.valuation_date || valuation.date > target.valuation_date),
    valuation,
    reconciliation: {
      openingMinor: opening,
      closingMinor: closing,
      movementMinor: movement,
      differenceMinor: difference,
    },
    ...(batch.result_json ? { result: JSON.parse(batch.result_json) } : {}),
  }
}
export function decimal4(text: string) {
  const s = text.replaceAll(',', '').trim()
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null
  const [w, f = ''] = s.split('.'),
    n = Number(w) * 10000 + Number(f.padEnd(4, '0'))
  return Number.isSafeInteger(n) ? n : null
}
export function stateQuery() {
  return `SELECT json_object('activities',json((SELECT json_group_array(json_object('id',id,'type',activity_type,'date',activity_date,'amount',amount_minor)) FROM (SELECT a.* FROM investment_activity a JOIN investments i ON i.id=a.investment_id WHERE i.workspace_id=? ORDER BY a.id))),'accounts',json((SELECT json_group_array(json_object('id',id,'active',is_active,'opening',opening_balance_minor,'date',opening_balance_date)) FROM (SELECT * FROM accounts WHERE workspace_id=? ORDER BY id))),'holdings',json((SELECT json_group_array(json_object('id',id,'type',investment_type,'version',ledger_version,'basis',invested_minor,'value',current_value_minor,'date',valuation_date,'updated',updated_at)) FROM (SELECT * FROM investments WHERE workspace_id=? ORDER BY id))),'transactions',json((SELECT json_group_array(json_object('id',id,'type',transaction_type,'date',transaction_date,'amount',amount_minor,'from',from_account_id,'to',to_account_id,'status',status,'revision',category_revision,'notes',notes,'original',original_transaction_id,'reference',external_id)) FROM (SELECT * FROM transactions WHERE workspace_id=? ORDER BY id))),'payroll',json((SELECT json_group_array(json_object('id',id,'revision',revision,'credit',credited_date,'amount',amount_minor,'holding',investment_id,'month',payroll_month,'parentRevision',parent_revision)) FROM (SELECT c.*,p.payroll_month,p.revision parent_revision FROM payroll_contributions c JOIN payroll_records p ON p.id=c.payroll_id WHERE p.workspace_id=? ORDER BY c.id))),'receipts',json((SELECT json_group_array(id) FROM (SELECT id FROM statement_import_items WHERE workspace_id=? ORDER BY id))),'categories',json((SELECT json_group_array(json_object('id',id,'active',is_active)) FROM (SELECT * FROM categories WHERE workspace_id=? ORDER BY id)))) state`
}
export async function statementState(env: Env, _batch: StatementBatch) {
  const row = await env.DB.prepare(stateQuery())
    .bind(...Array(7).fill(env.DEFAULT_WORKSPACE_ID))
    .first<{ state: string }>()
  return row!.state
}
