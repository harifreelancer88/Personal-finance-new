import { aiCategoriesRoute } from './ai-categories'
import { enqueueAi, markManualCategory } from '../repositories/ai-categories'
import { categoryRulesRoute } from './category-rules'
import { payrollList, payrollTransactions, payrollMatch, guardPayrollTransaction } from './payroll'
import { assignCategory,learnManualCategory } from '../repositories/category-rules'
import { failure, methodNotAllowed, notFound, success } from '../lib/http'
import { accountToApi, transactionToApi } from '../lib/api-mappers'
import {
  ApiError,
  parseJsonObject,
  validateReferences,
  validateTransaction,
} from '../lib/transaction-validation'
import { validateAccount } from '../lib/account-validation'
import {
  accountInUse,
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from '../repositories/accounts'
import { investmentsRoute, categoriesRoute, settingsStatus } from './wealth'
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  getTransactionPage,
  listTransactions,
  updateTransaction,
} from '../repositories/transactions'
import {
  getDashboardCashFlow,
  getDashboardSummary,
} from '../repositories/dashboard'
import { getReport } from '../repositories/reports'
import { REPORT_PERIODS, type ReportPeriod } from '../lib/report-calculations'
import type { Env } from '../types'
import { ingestSms } from './sms-ingestion'
import {
  getSmsForTransaction,
  listSmsMessages,
} from '../repositories/sms-messages'
import { SMS_AUTO_CONFIRM_NOTE } from '../lib/sms-approval'

const transactionTypes = new Set([
  'expense',
  'income',
  'transfer',
  'investment',
  'refund',
])
const statuses = new Set(['pending', 'confirmed', 'ignored'])
const sources = new Set(['sms', 'manual'])
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function parseListQuery(url: URL) {
  const value = (name: string) =>
    url.searchParams.get(name)?.trim() || undefined
  const type = value('type')
  const status = value('status')
  const source = value('source')
  const fromDate = value('fromDate')
  const toDate = value('toDate')
  if (type && !transactionTypes.has(type))
    throw new ApiError(400, 'INVALID_FILTER', 'type filter is invalid.')
  if (status && !statuses.has(status))
    throw new ApiError(400, 'INVALID_FILTER', 'status filter is invalid.')
  if (source && !sources.has(source))
    throw new ApiError(400, 'INVALID_FILTER', 'source filter is invalid.')
  if (fromDate && !datePattern.test(fromDate))
    throw new ApiError(400, 'INVALID_FILTER', 'fromDate must use YYYY-MM-DD.')
  if (toDate && !datePattern.test(toDate))
    throw new ApiError(400, 'INVALID_FILTER', 'toDate must use YYYY-MM-DD.')
  const limitRaw = value('limit')
  const offsetRaw = value('offset')
  const limit = limitRaw === undefined ? 100 : Number(limitRaw)
  const offset = offsetRaw === undefined ? 0 : Number(offsetRaw)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new ApiError(
      400,
      'INVALID_FILTER',
      'limit must be an integer between 1 and 100.',
    )
  if (!Number.isInteger(offset) || offset < 0)
    throw new ApiError(
      400,
      'INVALID_FILTER',
      'offset must be a non-negative integer.',
    )
  return {
    search: value('search'),
    type,
    categoryId: value('categoryId'),
    accountId: value('accountId'),
    status,
    source,
    fromDate,
    toDate,
    limit,
    offset,
  }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return parseJsonObject(await request.json())
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      400,
      'INVALID_JSON',
      'The request body must contain valid JSON.',
    )
  }
}

async function transactions(
  request: Request,
  env: Env,
  id?: string,
): Promise<Response> {
  const workspaceId = env.DEFAULT_WORKSPACE_ID
  if (!id && request.method === 'GET') {
    const url = new URL(request.url),
      filters = parseListQuery(url)
    if (url.searchParams.get('paginated') === 'true') {
      const page = await getTransactionPage(env.DB, workspaceId, filters)
      return success({ ...page, items: page.items.map(transactionToApi) })
    }
    return success(
      (await listTransactions(env.DB, workspaceId, filters)).map(
        transactionToApi,
      ),
    )
  }
  if (!id && request.method === 'POST') {
    const input = await body(request)
    const value = validateTransaction(input)
    if (!value.categoryId) value.categoryId = await assignCategory(env.DB, workspaceId, value.transactionType, value.description)
    await validateReferences(env.DB, workspaceId, value)
    const created = await createTransaction(env.DB, workspaceId, value)
    if (input.categoryId) await env.DB.prepare("UPDATE transactions SET category_origin='manual' WHERE id=? AND workspace_id=?").bind(created.id,workspaceId).run()
    else if (value.categoryId) await env.DB.prepare("UPDATE transactions SET category_origin='rule' WHERE id=? AND workspace_id=?").bind(created.id,workspaceId).run()
    else try { await enqueueAi(env, created.id) } catch { /* Capture must succeed even if AI setup is incomplete. */ }
    return success(transactionToApi(await getTransaction(env.DB,workspaceId,created.id) ?? created),{status:201})
  }
  if (!id) return methodNotAllowed()
  const existing = await getTransaction(env.DB, workspaceId, id)
  if (!existing)
    throw new ApiError(
      404,
      'TRANSACTION_NOT_FOUND',
      'The transaction was not found.',
    )
  if (request.method === 'GET') {
    const data = transactionToApi(existing)
    if (existing.source !== 'sms') return success(data)
    const sms = await getSmsForTransaction(env.DB, workspaceId, id)
    return success({
      ...data,
      sms: sms
        ? {
            sender: sms.sender,
            rawText: sms.raw_text,
            receivedAt: sms.received_at,
            parseStatus: sms.parse_status,
            parseConfidence: sms.parse_confidence,
          }
        : null,
    })
  }
  if (request.method === 'PATCH') {
    const input = await body(request)
    const value = validateTransaction(input, existing)
    await guardPayrollTransaction(env, id, value.transactionType, value.amountMinor)
    await validateReferences(env.DB, workspaceId, value, id)
    // A human edit ends automatic reconciliation ownership of this record.
    if (value.notes === SMS_AUTO_CONFIRM_NOTE) value.notes = null
    const saved = await updateTransaction(env.DB, workspaceId, id, value)
    if ('categoryId' in input) {
      await markManualCategory(env,id,value.categoryId)
      await learnManualCategory(env.DB,workspaceId,value.transactionType,value.description,value.categoryId)
    }
    return success(transactionToApi(await getTransaction(env.DB,workspaceId,id) ?? saved))
  }
  if (request.method === 'DELETE') {
    await guardPayrollTransaction(env, id)
    if (
      await env.DB.prepare(
        'SELECT id FROM transactions WHERE workspace_id=? AND original_transaction_id=? LIMIT 1',
      )
        .bind(workspaceId, id)
        .first()
    )
      throw new ApiError(
        409,
        'TRANSACTION_HAS_REFUNDS',
        'Delete the linked refunds before deleting this transaction.',
      )
    await deleteTransaction(env.DB, workspaceId, id)
    return success({ id })
  }
  return methodNotAllowed()
}

async function assignCategories(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'PATCH') return methodNotAllowed()
  const input = await body(request),
    ids = input.transactionIds,
    categoryId = input.categoryId
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== 'string' || !id.trim()) ||
    new Set(ids).size !== ids.length
  )
    throw new ApiError(
      400,
      'INVALID_SELECTION',
      'Select 1–100 distinct transactions.',
    )
  if (
    categoryId !== null &&
    (typeof categoryId !== 'string' || !categoryId.trim())
  )
    throw new ApiError(
      400,
      'INVALID_CATEGORY',
      'Choose a category or Uncategorised.',
    )
  if (
    categoryId !== null &&
    !(await env.DB.prepare(
      'SELECT id FROM categories WHERE workspace_id=? AND id=? AND is_active=1',
    )
      .bind(env.DEFAULT_WORKSPACE_ID, categoryId)
      .first())
  )
    throw new ApiError(
      404,
      'CATEGORY_NOT_FOUND',
      'Choose an active category in this workspace.',
    )
  // The count guard and category guard run inside the same UPDATE. If any selected ID
  // vanished or belongs to another workspace, no selected row is changed.
  const updated = await env.DB.prepare(
    `WITH selected AS (SELECT value AS id FROM json_each(?)) UPDATE transactions SET category_id=?, category_origin='manual',category_revision=category_revision+1, notes=CASE WHEN notes=? THEN NULL ELSE notes END, updated_at=CURRENT_TIMESTAMP
    WHERE workspace_id=? AND id IN (SELECT id FROM selected)
    AND (SELECT COUNT(*) FROM transactions WHERE workspace_id=? AND id IN (SELECT id FROM selected))=?
    AND (? IS NULL OR EXISTS(SELECT 1 FROM categories WHERE workspace_id=? AND id=? AND is_active=1))`,
  )
    .bind(
      JSON.stringify(ids),
      categoryId,
      SMS_AUTO_CONFIRM_NOTE,
      env.DEFAULT_WORKSPACE_ID,
      env.DEFAULT_WORKSPACE_ID,
      ids.length,
      categoryId,
      env.DEFAULT_WORKSPACE_ID,
      categoryId,
    )
    .run()
  if (updated.meta.changes !== ids.length)
    throw new ApiError(
      409,
      'SELECTION_CHANGED',
      'Some selected transactions are no longer available. Refresh and select again. No categories were changed.',
    )
  const selectedRows = (await env.DB.prepare('SELECT id,description,transaction_type FROM transactions WHERE workspace_id=? AND id IN (SELECT value FROM json_each(?))').bind(env.DEFAULT_WORKSPACE_ID,JSON.stringify(ids)).all<{id:string;description:string;transaction_type:string}>()).results
  for (const row of selectedRows) { await markManualCategory(env,row.id,categoryId as string|null); await learnManualCategory(env.DB,env.DEFAULT_WORKSPACE_ID,row.transaction_type,row.description,categoryId as string|null) }
  return success({ updatedCount: ids.length })
}

async function accounts(
  request: Request,
  env: Env,
  id?: string,
): Promise<Response> {
  const workspaceId = env.DEFAULT_WORKSPACE_ID
  if (!id && request.method === 'GET')
    return success((await listAccounts(env.DB, workspaceId)).map(accountToApi))
  if (!id && request.method === 'POST')
    return success(
      accountToApi(
        await createAccount(
          env.DB,
          workspaceId,
          validateAccount(await body(request)),
        ),
      ),
      { status: 201 },
    )
  if (!id) return methodNotAllowed()
  const existing = await getAccount(env.DB, workspaceId, id)
  if (!existing)
    throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'The account was not found.')
  if (request.method === 'GET') return success(accountToApi(existing))
  if (request.method === 'PATCH')
    return success(
      accountToApi(
        await updateAccount(
          env.DB,
          workspaceId,
          id,
          validateAccount(await body(request), existing),
        ),
      ),
    )
  if (request.method === 'DELETE') {
    if (await accountInUse(env.DB, workspaceId, id))
      throw new ApiError(
        409,
        'ACCOUNT_IN_USE',
        'This account is referenced by financial history. Deactivate it instead.',
      )
    await deleteAccount(env.DB, workspaceId, id)
    return success({ id })
  }
  return methodNotAllowed()
}

export async function handleApiRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const { pathname } = new URL(request.url)
  try {
    if (pathname === '/api/ai-categories') return await aiCategoriesRoute(request,env)
    if (pathname === '/api/ingest/sms') {
      if (request.method !== 'POST') return methodNotAllowed()
      return await ingestSms(request, env)
    }
    if (pathname === '/api/sms-messages') {
      if (request.method !== 'GET') return methodNotAllowed()
      const url = new URL(request.url),
        parseStatus = url.searchParams.get('parseStatus')?.trim() || undefined
      const limit = Number(url.searchParams.get('limit') ?? 50),
        offset = Number(url.searchParams.get('offset') ?? 0)
      if (
        parseStatus &&
        ![
          'received',
          'parsed',
          'unparsed',
          'non_financial',
          'needs_review',
          'deleted',
        ].includes(parseStatus)
      )
        throw new ApiError(400, 'INVALID_FILTER', 'parseStatus is invalid.')
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isInteger(offset) ||
        offset < 0
      )
        throw new ApiError(
          400,
          'INVALID_FILTER',
          'limit must be 1–100 and offset must be non-negative.',
        )
      const rows = await listSmsMessages(
        env.DB,
        env.DEFAULT_WORKSPACE_ID,
        parseStatus,
        limit,
        offset,
      )
      return success(
        rows.map((row) => ({
          id: row.id,
          externalId: row.external_id,
          sender: row.sender,
          rawText: row.raw_text,
          receivedAt: row.received_at,
          parseStatus: row.parse_status,
          parseConfidence: row.parse_confidence,
          parseNotes: row.parse_notes,
          transactionId: row.transaction_id,
          createdAt: row.created_at,
        })),
      )
    }
    if (pathname === '/api/health') {
      if (request.method !== 'GET') return methodNotAllowed()
      await env.DB.prepare('SELECT 1 AS healthy').first<{ healthy: number }>()
      return success({ database: 'connected' })
    }
    if (
      pathname === '/api/dashboard/summary' ||
      pathname === '/api/dashboard/cash-flow'
    ) {
      if (request.method !== 'GET') return methodNotAllowed()
      return success(
        pathname.endsWith('summary')
          ? await getDashboardSummary(env.DB, env.DEFAULT_WORKSPACE_ID)
          : await getDashboardCashFlow(env.DB, env.DEFAULT_WORKSPACE_ID),
      )
    }
    const reportMatch = pathname.match(
      /^\/api\/reports\/(summary|cash-flow|category-breakdown|account-breakdown|income-breakdown|top-expenses|insights|sankey)$/,
    )
    if (reportMatch) {
      if (request.method !== 'GET') return methodNotAllowed()
      const url = new URL(request.url),
        period = url.searchParams.get('period') ?? '6Months'
      if (!REPORT_PERIODS.includes(period as ReportPeriod))
        throw new ApiError(
          400,
          'INVALID_PERIOD',
          'period must be thisMonth, 3Months, 6Months, 1Year, or all.',
        )
      const rawLimit = url.searchParams.get('limit'),
        limit = rawLimit === null ? 10 : Number(rawLimit)
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        throw new ApiError(
          400,
          'INVALID_LIMIT',
          'limit must be an integer between 1 and 50.',
        )
      return success(
        await getReport(
          env.DB,
          env.DEFAULT_WORKSPACE_ID,
          period as ReportPeriod,
          reportMatch[1],
          limit,
        ),
      )
    }
    if (pathname === '/api/transactions/categories')
      return await assignCategories(request, env)
    if (pathname === '/api/payroll') {
      if (request.method !== 'GET') return methodNotAllowed()
      return success(await payrollList(env))
    }
    const payrollTransaction = pathname.match(/^\/api\/payroll\/transactions\/([^/]+)(\/employer)?$/)
    if (payrollTransaction) return await payrollTransactions(request, env, decodeURIComponent(payrollTransaction[1]), Boolean(payrollTransaction[2]))
    const payrollContribution = pathname.match(/^\/api\/payroll\/contributions\/([^/]+)$/)
    if (payrollContribution) return await payrollMatch(request, env, decodeURIComponent(payrollContribution[1]))
    const match = pathname.match(/^\/api\/transactions(?:\/([^/]+))?$/)
    if (match)
      return await transactions(
        request,
        env,
        match[1] ? decodeURIComponent(match[1]) : undefined,
      )
    const accountMatch = pathname.match(/^\/api\/accounts(?:\/([^/]+))?$/)
    if (accountMatch)
      return await accounts(
        request,
        env,
        accountMatch[1] ? decodeURIComponent(accountMatch[1]) : undefined,
      )
    const holdingMatch = pathname.match(
      /^\/api\/investments(?:\/([^/]+)(\/activity)?)?$/,
    )
    if (holdingMatch)
      return await investmentsRoute(
        request,
        env,
        holdingMatch[1] ? decodeURIComponent(holdingMatch[1]) : undefined,
        Boolean(holdingMatch[2]),
      )
    const categoryMatch = pathname.match(/^\/api\/categories(?:\/([^/]+))?$/)
    if (categoryMatch)
      return await categoriesRoute(
        request,
        env,
        categoryMatch[1] ? decodeURIComponent(categoryMatch[1]) : undefined,
      )
    const rulesMatch = pathname.match(/^\/api\/category-rules(?:\/([^/]+))?$/)
    if (rulesMatch) return await categoryRulesRoute(request,env,rulesMatch[1])
    if (pathname === '/api/settings/status') {
      if (request.method !== 'GET') return methodNotAllowed()
      return await settingsStatus(env)
    }
    return notFound()
  } catch (error) {
    if (error instanceof ApiError)
      return failure(error.code, error.message, error.status)
    const detail = error instanceof Error ? error.message : ''
    if (/PAYROLL_|UNIQUE constraint failed: payroll_/.test(detail))
      return failure('PAYROLL_CONFLICT', 'The salary record or statement match changed or is already in use. Reload and check the linked records.', 409)
    console.error('API request failed', { pathname, error })
    return failure(
      'DATABASE_ERROR',
      'The database request could not be completed.',
    )
  }
}
