import { failure, methodNotAllowed, notFound, success } from '../lib/http'
import { accountToApi, categoryToApi, investmentToApi, transactionToApi } from '../lib/api-mappers'
import { ApiError, parseJsonObject, validateReferences, validateTransaction } from '../lib/transaction-validation'
import { validateAccount } from '../lib/account-validation'
import { accountInUse, createAccount, deleteAccount, getAccount, listAccounts, updateAccount } from '../repositories/accounts'
import { listCategories } from '../repositories/categories'
import { listInvestments } from '../repositories/investments'
import { createTransaction, deleteTransaction, getTransaction, listTransactions, updateTransaction } from '../repositories/transactions'
import { getDashboardCashFlow, getDashboardSummary } from '../repositories/dashboard'
import { getReport } from '../repositories/reports'
import { REPORT_PERIODS, type ReportPeriod } from '../lib/report-calculations'
import type { Env } from '../types'

const transactionTypes = new Set(['expense', 'income', 'transfer', 'investment', 'refund'])
const statuses = new Set(['pending', 'confirmed', 'ignored'])
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function parseListQuery(url: URL) {
  const value = (name: string) => url.searchParams.get(name)?.trim() || undefined
  const type = value('type'); const status = value('status'); const fromDate = value('fromDate'); const toDate = value('toDate')
  if (type && !transactionTypes.has(type)) throw new ApiError(400, 'INVALID_FILTER', 'type filter is invalid.')
  if (status && !statuses.has(status)) throw new ApiError(400, 'INVALID_FILTER', 'status filter is invalid.')
  if (fromDate && !datePattern.test(fromDate)) throw new ApiError(400, 'INVALID_FILTER', 'fromDate must use YYYY-MM-DD.')
  if (toDate && !datePattern.test(toDate)) throw new ApiError(400, 'INVALID_FILTER', 'toDate must use YYYY-MM-DD.')
  const limitRaw = value('limit'); const offsetRaw = value('offset')
  const limit = limitRaw === undefined ? 100 : Number(limitRaw); const offset = offsetRaw === undefined ? 0 : Number(offsetRaw)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'INVALID_FILTER', 'limit must be an integer between 1 and 100.')
  if (!Number.isInteger(offset) || offset < 0) throw new ApiError(400, 'INVALID_FILTER', 'offset must be a non-negative integer.')
  return { search: value('search'), type, categoryId: value('categoryId'), accountId: value('accountId'), status, fromDate, toDate, limit, offset }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try { return parseJsonObject(await request.json()) } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'INVALID_JSON', 'The request body must contain valid JSON.')
  }
}

async function transactions(request: Request, env: Env, id?: string): Promise<Response> {
  const workspaceId = env.DEFAULT_WORKSPACE_ID
  if (!id && request.method === 'GET') return success((await listTransactions(env.DB, workspaceId, parseListQuery(new URL(request.url)))).map(transactionToApi))
  if (!id && request.method === 'POST') {
    const value = validateTransaction(await body(request)); await validateReferences(env.DB, workspaceId, value)
    return success(transactionToApi(await createTransaction(env.DB, workspaceId, value)), { status: 201 })
  }
  if (!id) return methodNotAllowed()
  const existing = await getTransaction(env.DB, workspaceId, id)
  if (!existing) throw new ApiError(404, 'TRANSACTION_NOT_FOUND', 'The transaction was not found.')
  if (request.method === 'GET') return success(transactionToApi(existing))
  if (request.method === 'PATCH') {
    const value = validateTransaction(await body(request), existing); await validateReferences(env.DB, workspaceId, value, id)
    return success(transactionToApi(await updateTransaction(env.DB, workspaceId, id, value)))
  }
  if (request.method === 'DELETE') {
    if (existing.source !== 'manual') throw new ApiError(409, 'TRANSACTION_NOT_MANUAL', 'Only manually-created transactions can be deleted.')
    await deleteTransaction(env.DB, workspaceId, id)
    return success({ id })
  }
  return methodNotAllowed()
}

async function accounts(request: Request, env: Env, id?: string): Promise<Response> {
  const workspaceId = env.DEFAULT_WORKSPACE_ID
  if (!id && request.method === 'GET') return success((await listAccounts(env.DB, workspaceId)).map(accountToApi))
  if (!id && request.method === 'POST') return success(accountToApi(await createAccount(env.DB, workspaceId, validateAccount(await body(request)))), { status: 201 })
  if (!id) return methodNotAllowed()
  const existing = await getAccount(env.DB, workspaceId, id)
  if (!existing) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'The account was not found.')
  if (request.method === 'GET') return success(accountToApi(existing))
  if (request.method === 'PATCH') return success(accountToApi(await updateAccount(env.DB, workspaceId, id, validateAccount(await body(request), existing))))
  if (request.method === 'DELETE') {
    if (await accountInUse(env.DB, workspaceId, id)) throw new ApiError(409, 'ACCOUNT_IN_USE', 'This account is referenced by financial history. Deactivate it instead.')
    await deleteAccount(env.DB, workspaceId, id)
    return success({ id })
  }
  return methodNotAllowed()
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url)
  try {
    if (pathname === '/api/health') {
      if (request.method !== 'GET') return methodNotAllowed()
      await env.DB.prepare('SELECT 1 AS healthy').first<{ healthy: number }>()
      return success({ database: 'connected' })
    }
    if (pathname === '/api/dashboard/summary' || pathname === '/api/dashboard/cash-flow') {
      if (request.method !== 'GET') return methodNotAllowed()
      return success(pathname.endsWith('summary')
        ? await getDashboardSummary(env.DB, env.DEFAULT_WORKSPACE_ID)
        : await getDashboardCashFlow(env.DB, env.DEFAULT_WORKSPACE_ID))
    }
    const reportMatch = pathname.match(/^\/api\/reports\/(summary|cash-flow|category-breakdown|account-breakdown|income-breakdown|top-expenses|insights)$/)
    if (reportMatch) {
      if (request.method !== 'GET') return methodNotAllowed()
      const url = new URL(request.url), period = url.searchParams.get('period') ?? '6Months'
      if (!REPORT_PERIODS.includes(period as ReportPeriod)) throw new ApiError(400, 'INVALID_PERIOD', 'period must be thisMonth, 3Months, 6Months, 1Year, or all.')
      const rawLimit = url.searchParams.get('limit'), limit = rawLimit === null ? 10 : Number(rawLimit)
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ApiError(400, 'INVALID_LIMIT', 'limit must be an integer between 1 and 50.')
      return success(await getReport(env.DB, env.DEFAULT_WORKSPACE_ID, period as ReportPeriod, reportMatch[1], limit))
    }
    const match = pathname.match(/^\/api\/transactions(?:\/([^/]+))?$/)
    if (match) return transactions(request, env, match[1] ? decodeURIComponent(match[1]) : undefined)
    const accountMatch = pathname.match(/^\/api\/accounts(?:\/([^/]+))?$/)
    if (accountMatch) return accounts(request, env, accountMatch[1] ? decodeURIComponent(accountMatch[1]) : undefined)
    if (request.method !== 'GET') return methodNotAllowed()
    if (pathname === '/api/categories') return success((await listCategories(env.DB, env.DEFAULT_WORKSPACE_ID)).map(categoryToApi))
    if (pathname === '/api/investments') return success((await listInvestments(env.DB, env.DEFAULT_WORKSPACE_ID)).map(investmentToApi))
    return notFound()
  } catch (error) {
    if (error instanceof ApiError) return failure(error.code, error.message, error.status)
    console.error('API request failed', { pathname, error })
    return failure('DATABASE_ERROR', 'The database request could not be completed.')
  }
}
