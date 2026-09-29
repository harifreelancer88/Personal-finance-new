import { failure, methodNotAllowed, notFound, success } from '../lib/http'
import { accountToApi, categoryToApi, investmentToApi, transactionToApi } from '../lib/api-mappers'
import { listAccounts } from '../repositories/accounts'
import { listCategories } from '../repositories/categories'
import { listInvestments } from '../repositories/investments'
import { listTransactions } from '../repositories/transactions'
import type { Env } from '../types'

type ReadHandler = (db: D1Database, workspaceId: string) => Promise<unknown[]>

const readRoutes: Record<string, ReadHandler> = {
  '/api/accounts': async (db, workspaceId) => (await listAccounts(db, workspaceId)).map(accountToApi),
  '/api/categories': async (db, workspaceId) => (await listCategories(db, workspaceId)).map(categoryToApi),
  '/api/transactions': async (db, workspaceId) => (await listTransactions(db, workspaceId)).map(transactionToApi),
  '/api/investments': async (db, workspaceId) => (await listInvestments(db, workspaceId)).map(investmentToApi),
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()

  const { pathname } = new URL(request.url)

  try {
    if (pathname === '/api/health') {
      await env.DB.prepare('SELECT 1 AS healthy').first<{ healthy: number }>()
      return Response.json({ ok: true, database: 'connected' })
    }

    const handler = readRoutes[pathname]
    if (!handler) return notFound()

    return success(await handler(env.DB, env.DEFAULT_WORKSPACE_ID))
  } catch (error) {
    console.error('API request failed', { pathname, error })
    return failure('DATABASE_ERROR', 'The database request could not be completed.')
  }
}
