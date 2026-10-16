import type { Env } from '../types'
import { success, methodNotAllowed } from '../lib/http'
import {
  dateOnly,
  dueAt,
  invalid,
  jsonBody,
  minor,
  textValue,
  todayIST,
} from '../lib/workflow-utils'
interface Plan {
  id: string
  workspace_id: string
  name: string
  amount_minor: number
  account_id: string
  category_id: string | null
  transaction_type: string
  investment_id: string | null
  frequency: string
  first_due_date: string
  anchor_day: number
  max_occurrences: number | null
  opening_paid_count: number
  is_active: number
}
export async function billsRoute(
  request: Request,
  env: Env,
  id?: string,
  action?: string,
) {
  const db = env.DB,
    ws = env.DEFAULT_WORKSPACE_ID
  if (!id && request.method === 'GET') {
    const rows = await db
      .prepare(
        `SELECT p.*, a.name account_name, c.name category_name,
   p.opening_paid_count+(SELECT COUNT(*) FROM bill_periods WHERE plan_id=p.id AND status='paid') paid_count,
   (SELECT COUNT(*) FROM bill_periods WHERE plan_id=p.id AND status='skipped') skipped_count
   FROM bill_plans p JOIN accounts a ON a.id=p.account_id LEFT JOIN categories c ON c.id=p.category_id WHERE p.workspace_id=? ORDER BY p.is_active DESC,p.name`,
      )
      .bind(ws)
      .all()
    const periods = await db
      .prepare(
        `SELECT b.*,p.name,p.amount_minor,p.account_id,p.transaction_type FROM bill_periods b JOIN bill_plans p ON p.id=b.plan_id WHERE p.workspace_id=? ORDER BY b.due_date,b.sequence`,
      )
      .bind(ws)
      .all()
    return success({
      plans: rows.results,
      periods: periods.results,
      today: todayIST(),
    })
  }
  if (!id && request.method === 'POST') {
    const b = await jsonBody(request),
      name = textValue(b.name, 'Name'),
      amount = minor(b.amountMinor),
      first = dateOnly(b.firstDueDate),
      account = textValue(b.accountId, 'Account'),
      type = b.transactionType ?? 'expense',
      frequency = b.frequency ?? 'monthly'
    if (
      !['expense', 'investment'].includes(String(type)) ||
      !['monthly', 'quarterly', 'annual'].includes(String(frequency))
    )
      invalid('Invalid payment type or frequency.')
    const opening = b.openingPaidCount ?? 0,
      max = b.maxOccurrences ?? null
    if (
      !Number.isSafeInteger(opening) ||
      (opening as number) < 0 ||
      (max !== null &&
        (!Number.isInteger(max) ||
          (max as number) < 1 ||
          (max as number) > 600 ||
          (opening as number) >= (max as number)))
    )
      invalid(
        'Enter valid paid and total instalment counts; at least one instalment must remain.',
      )
    if (
      !(await db
        .prepare(
          'SELECT id FROM accounts WHERE id=? AND workspace_id=? AND is_active=1',
        )
        .bind(account, ws)
        .first())
    )
      invalid('Choose an active account in this workspace.')
    const category = b.categoryId || null,
      investment = b.investmentId || null
    if (
      category &&
      !(await db
        .prepare(
          'SELECT id FROM categories WHERE id=? AND workspace_id=? AND is_active=1',
        )
        .bind(category, ws)
        .first())
    )
      invalid('Invalid category.')
    if (type === 'investment' && !investment)
      invalid('Choose the investment this payment funds.')
    if (type === 'expense' && investment)
      invalid('An expense cannot fund an investment.')
    if (
      investment &&
      !(await db
        .prepare(
          "SELECT id FROM investments WHERE id=? AND workspace_id=? AND investment_type NOT IN ('epf','nps')",
        )
        .bind(investment, ws)
        .first())
    )
      invalid(
        'Use retirement reconciliation for EPF/NPS; choose another holding here.',
      )
    const requestId = b.requestId
    if (
      requestId !== undefined &&
      (typeof requestId !== 'string' ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(requestId))
    )
      invalid('Invalid request identity.')
    const pid = requestId ? 'bill-' + requestId : crypto.randomUUID(),
      period = crypto.randomUUID(),
      anchor = Number(first.slice(8))
    const prior = await db
      .prepare('SELECT * FROM bill_plans WHERE id=? AND workspace_id=?')
      .bind(pid, ws)
      .first<Plan>()
    if (prior) {
      if (
        prior.name !== name ||
        prior.amount_minor !== amount ||
        prior.first_due_date !== first ||
        prior.account_id !== account ||
        prior.transaction_type !== type ||
        prior.investment_id !== investment ||
        prior.category_id !== category ||
        prior.frequency !== frequency ||
        prior.opening_paid_count !== opening ||
        prior.max_occurrences !== max
      )
        invalid(
          'This request identity was already used for a different schedule.',
          409,
        )
      return success({ id: pid })
    }

    await db.batch([
      db
        .prepare(
          `INSERT INTO bill_plans(id,workspace_id,name,amount_minor,account_id,category_id,transaction_type,investment_id,frequency,first_due_date,anchor_day,max_occurrences,opening_paid_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          pid,
          ws,
          name,
          amount,
          account,
          category,
          type,
          investment,
          frequency,
          first,
          anchor,
          max,
          opening,
        ),
      db
        .prepare(
          'INSERT INTO bill_periods(id,plan_id,sequence,due_date) VALUES (?,?,1,?)',
        )
        .bind(period, pid, first),
    ])
    return success({ id: pid }, { status: 201 })
  }
  const plan = await db
    .prepare('SELECT * FROM bill_plans WHERE id=? AND workspace_id=?')
    .bind(id, ws)
    .first<Plan>()
  if (!plan) invalid('Bill not found.', 404)
  if (!action && request.method === 'PATCH') {
    const b = await jsonBody(request)
    if (typeof b.isActive !== 'boolean') invalid('Provide isActive.')
    await db
      .prepare(
        'UPDATE bill_plans SET is_active=? WHERE id=? AND workspace_id=?',
      )
      .bind(b.isActive ? 1 : 0, id, ws)
      .run()
    return success({ id })
  }
  if (action === 'candidates' && request.method === 'GET') {
    const period = await db
      .prepare(
        "SELECT due_date FROM bill_periods WHERE plan_id=? AND status='upcoming' ORDER BY sequence LIMIT 1",
      )
      .bind(id)
      .first<{ due_date: string }>()
    if (!period) return success([])
    return success(
      (
        await db
          .prepare(
            `SELECT t.id,t.description,t.amount_minor,t.transaction_date FROM transactions t WHERE t.workspace_id=? AND t.from_account_id=? AND t.transaction_type=? AND t.status='confirmed' AND t.transaction_date BETWEEN date(?,'-10 days') AND date(?,'+10 days') AND t.transaction_date<=? AND NOT EXISTS(SELECT 1 FROM bill_periods b WHERE b.transaction_id=t.id) ORDER BY ABS(t.amount_minor-?),ABS(julianday(t.transaction_date)-julianday(?)) LIMIT 40`,
          )
          .bind(
            ws,
            plan.account_id,
            plan.transaction_type,
            period.due_date,
            period.due_date,
            todayIST(),
            plan.amount_minor,
            period.due_date,
          )
          .all()
      ).results,
    )
  }
  if ((action === 'pay' || action === 'skip') && request.method === 'POST') {
    const b = await jsonBody(request),
      periodId = textValue(b.periodId, 'Period'),
      period = await db
        .prepare('SELECT * FROM bill_periods WHERE id=? AND plan_id=?')
        .bind(periodId, id)
        .first<{
          id: string
          status: string
          transaction_id: string | null
          sequence: number
          due_date: string
        }>()
    if (!period) invalid('Period not found.', 404)
    if (period.status !== 'upcoming') {
      if (
        (action === 'pay' &&
          period.status === 'paid' &&
          period.transaction_id === b.transactionId) ||
        (action === 'skip' && period.status === 'skipped')
      )
        return success({ id: period.id })
      invalid('This period has already been settled.', 409)
    }
    if (!plan.is_active)
      invalid('Resume this bill before settling a period.', 409)
    const statements: D1PreparedStatement[] = []
    let txId: string | null = null
    if (action === 'pay') {
      txId = textValue(b.transactionId, 'Select an existing confirmed payment')
      const tx = await db
        .prepare(
          "SELECT * FROM transactions WHERE id=? AND workspace_id=? AND status='confirmed' AND from_account_id=? AND transaction_type=?",
        )
        .bind(txId, ws, plan.account_id, plan.transaction_type)
        .first<{ amount_minor: number; transaction_date: string }>()
      if (!tx || tx.transaction_date > todayIST())
        invalid(
          'Payment must be a confirmed transaction in the selected account.',
        )
      if (
        await db
          .prepare('SELECT id FROM bill_periods WHERE transaction_id=?')
          .bind(txId)
          .first()
      )
        invalid('This payment already settles another bill.', 409)
      if (
        tx.amount_minor !== plan.amount_minor &&
        b.acceptAmountDifference !== true
      )
        invalid('Confirm the difference between expected and actual payment.')
      if (plan.investment_id) {
        const linked = await db
          .prepare(
            'SELECT investment_id FROM investment_payments WHERE transaction_id=?',
          )
          .bind(txId)
          .first<{ investment_id: string }>()
        if (linked && linked.investment_id !== plan.investment_id)
          invalid('Payment already funds a different holding.', 409)
        if (!linked) {
          const h = await db
            .prepare(
              'SELECT valuation_date,ledger_version FROM investments WHERE id=? AND workspace_id=?',
            )
            .bind(plan.investment_id, ws)
            .first<{ valuation_date: string | null; ledger_version: number }>()
          if (!h?.valuation_date || tx.transaction_date <= h.valuation_date)
            invalid(
              'First link this older payment in Investments and specify whether its value is already included.',
            )
          statements.push(
            db
              .prepare(
                `INSERT INTO investment_payments(id,investment_id,transaction_id,amount_minor,payment_date) SELECT ?,?,?,?,? FROM investments WHERE id=? AND ledger_version=?`,
              )
              .bind(
                crypto.randomUUID(),
                plan.investment_id,
                txId,
                tx.amount_minor,
                tx.transaction_date,
                plan.investment_id,
                h.ledger_version,
              ),
            db
              .prepare(
                'UPDATE investments SET ledger_version=ledger_version+1 WHERE id=? AND ledger_version=?',
              )
              .bind(plan.investment_id, h.ledger_version),
          )
        }
      }
    }
    // Unique transaction_id and conditional period update protect retries and competing matches.
    statements.push(
      db
        .prepare('UPDATE bill_periods SET status=?,transaction_id=? WHERE id=?')
        .bind(action === 'pay' ? 'paid' : 'skipped', txId, period.id),
    )
    const next = period.sequence + 1
    if (
      plan.max_occurrences === null ||
      plan.opening_paid_count + next <= plan.max_occurrences
    )
      statements.push(
        db
          .prepare(
            'INSERT INTO bill_periods(id,plan_id,sequence,due_date) VALUES (?,?,?,?) ON CONFLICT(plan_id,sequence) DO NOTHING',
          )
          .bind(
            crypto.randomUUID(),
            id,
            next,
            dueAt(plan.first_due_date, next, plan.frequency, plan.anchor_day),
          ),
      )
    await db.batch(statements)
    return success({ id: period.id })
  }
  return methodNotAllowed()
}
