import type { Env } from '../types'
import { success, methodNotAllowed } from '../lib/http'
import {
  dateOnly,
  invalid,
  jsonBody,
  textValue,
  todayIST,
} from '../lib/workflow-utils'
import {
  effectiveTransactionDate,
  isExpenseRefund,
} from '../lib/financial-semantics'
import { refundAllocations } from '../lib/category-allocations'
import { reportData } from '../repositories/reports'
function csvCell(s: unknown) {
  let v = String(s ?? '')
  if (/^[=+@\-\t\r]/.test(v)) v = "'" + v
  return '"' + v.replaceAll('"', '""') + '"'
}
export async function analyticsRoute(
  request: Request,
  env: Env,
  action: string,
) {
  const db = env.DB,
    ws = env.DEFAULT_WORKSPACE_ID
  if (action === 'views') {
    if (request.method === 'GET')
      return success(
        (
          await db
            .prepare(
              'SELECT id,name,filters_json FROM saved_report_views WHERE workspace_id=? ORDER BY name',
            )
            .bind(ws)
            .all()
        ).results,
      )
    if (request.method === 'POST') {
      const b = await jsonBody(request),
        name = textValue(b.name, 'View name', 80),
        f = b.filters as Record<string, unknown>
      if (!f) invalid('Provide filters.')
      dateOnly(f.from)
      dateOnly(f.to)
      if (!['category', 'merchant', 'account'].includes(String(f.dimension)))
        invalid('Invalid dimension.')
      await db
        .prepare(
          'INSERT INTO saved_report_views(id,workspace_id,name,filters_json) VALUES (?,?,?,?) ON CONFLICT(workspace_id,name) DO UPDATE SET filters_json=excluded.filters_json',
        )
        .bind(
          crypto.randomUUID(),
          ws,
          name,
          JSON.stringify({
            from: f.from,
            to: f.to,
            dimension: f.dimension,
            accountId: f.accountId ?? '',
            categoryId: f.categoryId ?? '',
          }),
        )
        .run()
      return success({ saved: true })
    }
    return methodNotAllowed()
  }
  if (request.method !== 'GET') return methodNotAllowed()
  const url = new URL(request.url),
    from = dateOnly(
      url.searchParams.get('from') ?? todayIST().slice(0, 7) + '-01',
    ),
    to = dateOnly(url.searchParams.get('to') ?? todayIST()),
    dimension = url.searchParams.get('dimension') ?? 'category',
    account = url.searchParams.get('accountId'),
    category = url.searchParams.get('categoryId')
  if (
    from > to ||
    to > todayIST() ||
    Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 10 ||
    !['category', 'merchant', 'account'].includes(dimension)
  )
    invalid(
      'Choose an ordered date range of at most 10 years, ending today or earlier.',
    )
  const all = await reportData(db, ws),
    months: string[] = []
  let cursor = from.slice(0, 7) + '-01'
  while (cursor <= to) {
    months.push(cursor.slice(0, 7))
    const d = new Date(cursor + 'T12:00:00Z')
    d.setUTCMonth(d.getUTCMonth() + 1)
    cursor = d.toISOString().slice(0, 10)
  }
  const grouped = new Map<
    string,
    {
      key: string
      label: string
      values: Record<string, number>
      totalMinor: number
      transactionIds: string[]
      entries: {
        id: string
        date: string
        description: string
        amountMinor: number
      }[]
    }
  >()
  const byId = new Map(all.map((t) => [t.id, t]))
  for (const t of all) {
    const date = effectiveTransactionDate(t)
    if (
      t.status !== 'confirmed' ||
      date < from ||
      date > to ||
      (!isExpenseRefund(t) && t.transaction_type !== 'expense') ||
      (account &&
        (t.transaction_type === 'refund'
          ? t.original_from_account_id
          : t.from_account_id) !== account)
    )
      continue
    const original = byId.get(t.original_transaction_id ?? ''),
      parts =
        t.transaction_type === 'expense'
          ? (t.allocations ?? [])
          : t.originalAllocations
            ? refundAllocations(
                t.amount_minor,
                t.originalAllocations,
                t.category_id,
              )
            : [
                {
                  categoryId: t.original_category_id ?? t.category_id,
                  categoryName:
                    t.original_category_name ??
                    t.category_name ??
                    'Uncategorized',
                  amountMinor: -t.amount_minor,
                },
              ]
    for (const part of parts) {
      if (category && part.categoryId !== category) continue
      const label =
          dimension === 'category'
            ? part.categoryName
            : dimension === 'account'
              ? (t.original_from_account_name ??
                t.from_account_name ??
                'Unknown account')
              : (original?.description ?? t.description)
                  .trim()
                  .replace(/\s+/g, ' '),
        key =
          dimension === 'category'
            ? (part.categoryId ?? 'uncategorized')
            : dimension === 'account'
              ? (t.original_from_account_id ?? t.from_account_id ?? 'unknown')
              : label.toLocaleLowerCase('en-IN')
      const row = grouped.get(key) ?? {
        key,
        label,
        values: Object.fromEntries(months.map((m) => [m, 0])),
        totalMinor: 0,
        transactionIds: [],
        entries: [],
      }
      row.values[date.slice(0, 7)] += part.amountMinor
      row.totalMinor += part.amountMinor
      const entry = row.entries.find((e) => e.id === t.id)
      if (entry) entry.amountMinor += part.amountMinor
      else
        row.entries.push({
          id: t.id,
          date,
          description: t.description,
          amountMinor: part.amountMinor,
        })
      if (!row.transactionIds.includes(t.id)) row.transactionIds.push(t.id)
      grouped.set(key, row)
    }
  }
  const rows = [...grouped.values()].sort(
      (a, b) => b.totalMinor - a.totalMinor,
    ),
    totals = Object.fromEntries(
      months.map((m) => [m, rows.reduce((n, r) => n + r.values[m], 0)]),
    ),
    result = {
      from,
      to,
      dimension,
      months,
      rows,
      totals,
      totalMinor: rows.reduce((n, r) => n + r.totalMinor, 0),
    }
  if (action === 'export') {
    const lines = [
      ['Name', ...months, 'Total INR'],
      ...rows.map((r) => [
        r.label,
        ...months.map((m) => (r.values[m] / 100).toFixed(2)),
        (r.totalMinor / 100).toFixed(2),
      ]),
    ]
    return new Response(
      '\uFEFF' + lines.map((r) => r.map(csvCell).join(',')).join('\r\n'),
      {
        headers: {
          'Content-Type': 'text/csv;charset=utf-8',
          'Content-Disposition':
            'attachment; filename="personal-finance-report.csv"',
        },
      },
    )
  }
  return success(result)
}
