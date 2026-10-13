import { handleApiRequest } from './routes/api'
import { drainAiQueue } from './repositories/ai-categories'
import type { Env } from './types'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const response = await handleApiRequest(request, env)
      if (response.ok && request.method === 'POST' && ['/api/ingest/sms','/api/transactions','/api/ai-categories'].includes(pathname)) ctx.waitUntil(drainAiQueue(env).catch(() => { /* Jobs remain recoverable by the scheduled worker. */ }))
      return response
    }

    return env.ASSETS.fetch(request)
  },
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(drainAiQueue(env))
  },
} satisfies ExportedHandler<Env>
