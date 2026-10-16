import type { Env } from '../types'
import type {
  StatementExtraction,
  StatementReview,
  StatementSelection,
} from '../../shared/statement-import'
import { invalid, hash } from '../lib/workflow-utils'
import {
  stateQuery,
  statementState,
  statementTarget,
  type StatementBatch,
} from '../lib/statement-review'
import {
  validateTransaction,
  validateReferences,
} from '../lib/transaction-validation'
export async function statementCommit(
  env: Env,
  batch: StatementBatch,
  review: StatementReview,
  selections: StatementSelection[],
  options: {
    preserveBalance: boolean
    updateValuation: boolean
    extraction: StatementExtraction
  },
) {
  const db = env.DB,
    ws = env.DEFAULT_WORKSPACE_ID,
    bank = batch.statement_type === 'bank',
    target = await statementTarget(env, batch.statement_type, batch.target_id)
  const state = await statementState(env, batch)
  if ((await hash(state)) !== review.expectedTarget)
    invalid(
      'Records changed during import preparation. Refresh matches and review again.',
      409,
    )
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO statement_commit_context(import_id,workspace_id,eligible) SELECT ?,?,CASE WHEN state=? AND EXISTS(SELECT 1 FROM statement_imports WHERE id=? AND status='review' AND parsed_json=?) THEN 1 ELSE 0 END FROM (${stateQuery()})`,
      )
      .bind(
        batch.id,
        ws,
        state,
        batch.id,
        batch.parsed_json,
        ...Array(7).fill(ws),
      ),
  ]
  const txs: any[] = [],
    activities: any[] = [],
    receipts: any[] = [],
    payrollMatches: any[] = [],
    npsMatches: any[] = [],
    allowed: Record<string, string[]> = {},
    chosenIds = new Set<string>()
  const refundTotals = new Map<string, number>()
  let added = 0,
    matched = 0,
    skipped = 0,
    delta = 0
  for (const row of review.rows) {
    const selection = selections.find((s) => s.sourceRow === row.sourceRow)!
    if (!selection || !['new', 'match', 'skip'].includes(selection.action))
      invalid('Choose New, Match or Skip for each row.')
    if (selection.action === 'skip') {
      skipped++
      continue
    }
    if (row.status === 'already_imported')
      invalid('This statement row is already imported. Leave it skipped.', 409)
    if (row.errors.length || row.reviewReason)
      invalid(
        `Row ${row.sourceRow}: correct and confirm the flagged fields before importing.`,
      )
    if (
      row.candidates.length &&
      selection.action === 'new' &&
      selection.acknowledgeDuplicate !== true
    )
      invalid(
        `Row ${row.sourceRow}: confirm this is a separate movement before adding it.`,
      )
    let transactionId: string | null = null,
      activityId: string | null = null,
      contributionId: string | null = null
    const itemId = `statement-${batch.id}-${row.sourceRow}`,
      candidate =
        selection.action === 'match' && selection.matchId
          ? row.candidates.find((c) => c.id === selection.matchId)
          : undefined
    if (bank) {
      if (
        !['expense', 'income', 'transfer', 'investment', 'refund'].includes(
          row.kind,
        )
      )
        invalid('Invalid bank transaction type.')
      if (selection.action === 'match') {
        if (
          !candidate ||
          candidate.type !== 'transaction' ||
          chosenIds.has(candidate.id)
        )
          invalid(
            'Choose one unused existing transaction with the same amount and direction.',
          )
        const t = await db
          .prepare('SELECT * FROM transactions WHERE id=? AND workspace_id=?')
          .bind(candidate.id, ws)
          .first<Record<string, any>>()
        if (
          !t ||
          t.transaction_type !== row.kind ||
          t.status !== 'confirmed' ||
          t.amount_minor !== row.amountMinor
        )
          invalid(
            'The selected transaction type/amount differs. Correct the parsed type or choose another match.',
          )
        transactionId = t.id
        chosenIds.add(t.id)
        matched++
      } else {
        const debit = row.direction === 'debit',
          transfer = row.kind === 'transfer'
        if (
          ((row.kind === 'expense' || row.kind === 'investment') && !debit) ||
          ((row.kind === 'income' || row.kind === 'refund') && debit)
        )
          invalid('Transaction type and bank direction disagree.')
        const write = validateTransaction({
          transactionType: row.kind,
          description: row.description,
          amountMinor: row.amountMinor,
          categoryId: row.categoryId,
          fromAccountId: transfer
            ? debit
              ? batch.target_id
              : selection.otherAccountId
            : debit
              ? batch.target_id
              : null,
          toAccountId: transfer
            ? debit
              ? selection.otherAccountId
              : batch.target_id
            : debit
              ? null
              : batch.target_id,
          transactionDate: row.date,
          status: 'confirmed',
          originalTransactionId:
            row.kind === 'refund' ? selection.originalTransactionId : null,
          notes: `Statement ${batch.file_name} · row ${row.sourceRow}${row.reference ? ' · ' + row.reference : ''}`,
        })
        await validateReferences(db, ws, write)
        for (const account of [write.fromAccountId, write.toAccountId])
          if (
            account &&
            !(await db
              .prepare(
                'SELECT id FROM accounts WHERE id=? AND workspace_id=? AND is_active=1',
              )
              .bind(account, ws)
              .first())
          )
            invalid('Choose active accounts for this import.')
        if (
          write.categoryId &&
          !(await db
            .prepare(
              'SELECT id FROM categories WHERE id=? AND workspace_id=? AND is_active=1',
            )
            .bind(write.categoryId, ws)
            .first())
        )
          invalid('Choose active categories for this import.')
        if (row.kind === 'refund') {
          const original = await db
            .prepare(
              "SELECT * FROM transactions WHERE id=? AND workspace_id=? AND transaction_type='expense' AND status='confirmed'",
            )
            .bind(write.originalTransactionId, ws)
            .first<Record<string, any>>()
          if (!original)
            invalid('Choose the original confirmed expense for this refund.')
          const prior = await db
            .prepare(
              "SELECT COALESCE(SUM(amount_minor),0) n FROM transactions WHERE original_transaction_id=? AND status='confirmed' AND transaction_type='refund'",
            )
            .bind(original.id)
            .first<{ n: number }>()
          const total = (refundTotals.get(original.id) ?? 0) + row.amountMinor
          if (total + (prior?.n ?? 0) > original.amount_minor)
            invalid(
              'Selected refunds exceed the original expense after existing refunds.',
            )
          refundTotals.set(original.id, total)
        }

        if (
          target.opening_balance_date &&
          row.date! <= target.opening_balance_date &&
          !options.preserveBalance
        )
          invalid(
            'Historical rows on/before the opening balance date require Preserve current account balance.',
          )
        transactionId = itemId
        txs.push({ id: itemId, ...write, externalId: itemId })
        allowed[itemId] = selection.acknowledgeDuplicate
          ? row.candidates
              .filter((c) => c.type === 'transaction')
              .map((c) => c.id)
          : []
        delta += debit ? -row.amountMinor : row.amountMinor
        added++
      }
    } else {
      if (!['contribution', 'interest', 'fee', 'withdrawal'].includes(row.kind))
        invalid('Invalid retirement movement.')
      const matches =
        selection.action === 'match' ? (selection.payrollMatches ?? []) : []
      if (
        matches.length > 3 ||
        new Set(matches.map((m) => m.component)).size !== matches.length
      )
        invalid('Choose distinct employee/employer contribution matches.')
      if (selection.action === 'match' && !candidate && !matches.length)
        invalid('Choose existing retirement evidence to match.')
      if (candidate) {
        if (chosenIds.has(candidate.id))
          invalid('Evidence can only match one source row.')
        chosenIds.add(candidate.id)
        if (candidate.type === 'transaction') {
          if (
            batch.statement_type !== 'nps' ||
            row.kind !== 'contribution' ||
            !row.salaryMonth
          )
            invalid(
              'Only NPS contributions with a salary month can match a bank deduction.',
            )
          transactionId = candidate.id
          npsMatches.push({
            id: candidate.id,
            date: row.date,
            month: row.salaryMonth,
            amount: row.amountMinor,
          })
        } else if (candidate.type === 'activity') activityId = candidate.id
        else
          invalid('Choose employee/employer matches in their component fields.')
      }
      if (matches.length && (row.kind !== 'contribution' || !row.salaryMonth))
        invalid('Only dated salary contributions can match payroll.')
      const components =
        row.kind === 'contribution' &&
        row.employeeMinor !== null &&
        row.employerMinor !== null
          ? [
              { component: 'employee', amount: row.employeeMinor },
              { component: 'employer', amount: row.employerMinor },
            ]
          : [{ component: 'total', amount: row.amountMinor }]
      if (!activityId)
        for (const component of components) {
          if (!component.amount) continue
          const aid = itemId + '-' + component.component
          activities.push({
            id: aid,
            type:
              row.kind === 'contribution'
                ? 'contribution'
                : row.kind === 'interest'
                  ? 'interest'
                  : row.kind === 'withdrawal'
                    ? 'sale'
                    : 'adjustment',
            date: row.date,
            amount: component.amount,
            description: `${row.description} · ${component.component} · ${batch.file_name} row ${row.sourceRow}`,
          })
          activityId ??= aid
        }
      for (const m of matches) {
        if (chosenIds.has(m.id))
          invalid('A payroll allocation can only match once.')
        const c = row.candidates.find(
            (c) => c.id === m.id && c.type === 'payroll',
          ),
          component =
            m.component === 'pension'
              ? { component: 'pension', amount: row.pensionMinor }
              : components.find((c) => c.component === m.component)
        if (!c || !component || component.amount !== c.amountMinor)
          invalid(
            'Payroll contribution amount must equal the selected component.',
          )
        const actual = await db
          .prepare(
            'SELECT c.*,p.payroll_month FROM payroll_contributions c JOIN payroll_records p ON p.id=c.payroll_id WHERE c.id=? AND p.workspace_id=?',
          )
          .bind(m.id, ws)
          .first<Record<string, any>>()
        if (
          !actual ||
          actual.credited_date ||
          actual.scheme !==
            (m.component === 'pension' ? 'eps' : batch.statement_type) ||
          actual.payroll_month !== row.salaryMonth ||
          (m.component !== 'total' &&
            actual.contributor !==
              (m.component === 'pension' ? 'employer' : m.component))
        )
          invalid('Payroll evidence changed or belongs to another component.')
        payrollMatches.push({
          id: m.id,
          revision: c.revision,
          date: row.date,
          scheme: actual.scheme,
          activityId:
            m.component === 'pension'
              ? null
              : activityId && candidate?.type === 'activity'
                ? components.length === 1
                  ? activityId
                  : null
                : components.length === 1
                  ? activityId
                  : itemId + '-' + m.component,
          reference: itemId + '-' + m.component,
          payrollId: actual.payroll_id,
        })
        contributionId ??= m.id
        chosenIds.add(m.id)
      }
      if (selection.action === 'match') matched++
      else added++
    }
    receipts.push({
      id: itemId,
      sourceRow: row.sourceRow,
      key: row.key,
      data: JSON.stringify({
        parsed: {
          ...row,
          candidates: undefined,
          sourceCells: undefined,
          receipt: undefined,
        },
        decision: selection,
      }),
      transactionId,
      activityId,
      contributionId,
    })
  }
  if (!Number.isSafeInteger(delta))
    invalid('The selected statement total is too large.')
  if (
    options.updateValuation &&
    (bank || !review.valuation || !review.canUpdateValuation)
  )
    invalid(
      'This snapshot cannot replace the holding valuation. Keep the newer value and import history only.',
    )
  if (!receipts.length && !options.updateValuation)
    invalid(
      'Select at least one new/matched row or a newer retirement valuation.',
    )
  if (bank && txs.length) {
    const json = JSON.stringify(txs)
    statements.push(
      db
        .prepare(
          "INSERT INTO import_batches(id,workspace_id,account_id,file_name,content_hash,payload_json,status,opening_adjustment_minor) VALUES (?,?,?,?,?,?,'committed',?)",
        )
        .bind(
          batch.id,
          ws,
          batch.target_id,
          'AI · ' + batch.file_name,
          'ai-' + batch.content_hash,
          JSON.stringify({ aiStatementId: batch.id }),
          options.preserveBalance ? -delta : 0,
        ),
      db
        .prepare(
          'INSERT INTO import_commit_guards(batch_id,workspace_id,planned_ids_json,allowed_matches_json) VALUES (?,?,?,?)',
        )
        .bind(
          batch.id,
          ws,
          JSON.stringify(txs.map((t) => t.id)),
          JSON.stringify(allowed),
        ),
      db
        .prepare(
          `INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,category_id,from_account_id,to_account_id,transaction_date,accounting_date,notes,source,external_id,original_transaction_id,status,category_origin) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.transactionType'),json_extract(value,'$.description'),json_extract(value,'$.amountMinor'),json_extract(value,'$.categoryId'),json_extract(value,'$.fromAccountId'),json_extract(value,'$.toAccountId'),json_extract(value,'$.transactionDate'),json_extract(value,'$.accountingDate'),json_extract(value,'$.notes'),'import',json_extract(value,'$.externalId'),json_extract(value,'$.originalTransactionId'),'confirmed',CASE WHEN json_extract(value,'$.categoryId') IS NULL THEN NULL ELSE 'manual' END FROM json_each(?)`,
        )
        .bind(ws, json),
      db
        .prepare(
          `INSERT INTO import_rows(batch_id,row_number,transaction_id,fingerprint) SELECT ?,CAST(key AS INTEGER)+1,json_extract(value,'$.id'),json_extract(value,'$.id') FROM json_each(?)`,
        )
        .bind(batch.id, json),
    )
    if (options.preserveBalance)
      statements.push(
        db
          .prepare(
            'UPDATE accounts SET opening_balance_minor=opening_balance_minor-?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?',
          )
          .bind(delta, batch.target_id, ws),
      )
    statements.push(
      db
        .prepare('DELETE FROM import_commit_guards WHERE batch_id=?')
        .bind(batch.id),
    )
  }
  if (activities.length)
    statements.push(
      db
        .prepare(
          `INSERT INTO investment_activity(id,investment_id,activity_type,activity_date,amount_minor,description) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.type'),json_extract(value,'$.date'),json_extract(value,'$.amount'),json_extract(value,'$.description') FROM json_each(?)`,
        )
        .bind(batch.target_id, JSON.stringify(activities)),
    )
  for (const m of payrollMatches)
    statements.push(
      db
        .prepare(
          'UPDATE payroll_contributions SET investment_id=?,activity_id=?,credited_date=?,statement_reference=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=? AND credited_date IS NULL',
        )
        .bind(
          m.scheme === 'eps' ? null : batch.target_id,
          m.activityId,
          m.date,
          m.reference,
          m.id,
          m.revision,
        ),
      db
        .prepare(
          'UPDATE payroll_records SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',
        )
        .bind(m.payrollId),
    )
  if (npsMatches.length)
    statements.push(
      db
        .prepare(
          `INSERT INTO nps_credit_matches(investment_id,transaction_id,credit_date,salary_month,amount_minor) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.date'),json_extract(value,'$.month'),json_extract(value,'$.amount') FROM json_each(?)`,
        )
        .bind(batch.target_id, JSON.stringify(npsMatches)),
    )
  if (receipts.length)
    statements.push(
      db
        .prepare(
          `INSERT INTO statement_import_items(id,import_id,workspace_id,statement_type,target_id,source_row,fingerprint,data_json,transaction_id,contribution_id,activity_id) SELECT json_extract(value,'$.id'),?,?,?,?,json_extract(value,'$.sourceRow'),json_extract(value,'$.key'),json_extract(value,'$.data'),json_extract(value,'$.transactionId'),json_extract(value,'$.contributionId'),json_extract(value,'$.activityId') FROM json_each(?)`,
        )
        .bind(
          batch.id,
          ws,
          batch.statement_type,
          batch.target_id,
          JSON.stringify(receipts),
        ),
    )
  if (options.updateValuation) {
    const v = review.valuation!
    statements.push(
      db
        .prepare(
          'INSERT INTO investment_valuations(id,investment_id,valuation_date,invested_minor,value_minor,basis_kind,source) VALUES (?,?,?,?,?,?,?)',
        )
        .bind(
          'valuation-' + batch.id,
          batch.target_id,
          v.date,
          v.investedMinor,
          v.valueMinor,
          v.basisKind,
          'AI-reviewed ' +
            batch.statement_type.toUpperCase() +
            ' statement · ' +
            batch.file_name,
        ),
      db
        .prepare(
          'UPDATE investments SET invested_minor=?,current_value_minor=?,valuation_date=?,basis_kind=?,ledger_version=ledger_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?',
        )
        .bind(
          v.investedMinor,
          v.valueMinor,
          v.date,
          v.basisKind,
          batch.target_id,
          ws,
        ),
    )
  }
  const result = {
    added,
    matched,
    skipped,
    valuationUpdated: options.updateValuation,
    balanceChangeMinor: bank && !options.preserveBalance ? delta : 0,
  }
  statements.push(
    db
      .prepare(
        "UPDATE statement_imports SET status='committed',parsed_json=?,result_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(
        JSON.stringify(options.extraction),
        JSON.stringify(result),
        batch.id,
      ),
    db
      .prepare('DELETE FROM statement_commit_context WHERE import_id=?')
      .bind(batch.id),
  )
  if (statements.length > 48)
    invalid(
      'This selection contains too many independent payroll matches. Import a smaller statement range.',
    )
  await db.batch(statements)
}
