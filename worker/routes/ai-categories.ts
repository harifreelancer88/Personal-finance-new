import { success, methodNotAllowed } from '../lib/http'
import { aiEnabled, dailyLimit, enqueueUnmatched } from '../repositories/ai-categories'
import { ApiError } from '../lib/transaction-validation'
import type { Env } from '../types'
export async function aiCategoriesRoute(request: Request, env: Env) {
  const workspace = env.DEFAULT_WORKSPACE_ID
  if (request.method === 'POST') {
    if (!aiEnabled(env)) throw new ApiError(409,'AI_NOT_CONFIGURED','Enable AI categorisation and configure the server API key first.')
    return success({ queued: await enqueueUnmatched(env) })
  }
  if (request.method !== 'GET') return methodNotAllowed()
  const usage = await env.DB.prepare("SELECT requests FROM ai_category_usage WHERE workspace_id=? AND day=date('now','+5 hours','+30 minutes')").bind(workspace).first<{requests:number}>()
  const jobs = (await env.DB.prepare(`SELECT j.transaction_id AS transactionId,t.description,t.transaction_type AS transactionType,j.state,j.attempts,j.model,j.category_id AS categoryId,c.name AS categoryName,j.keyword,j.reason,j.error_code AS errorCode,j.input_tokens AS inputTokens,j.output_tokens AS outputTokens,j.updated_at AS updatedAt FROM ai_category_jobs j JOIN transactions t ON t.id=j.transaction_id AND t.workspace_id=j.workspace_id LEFT JOIN categories c ON c.id=j.category_id AND c.workspace_id=j.workspace_id WHERE j.workspace_id=? ORDER BY j.updated_at DESC,j.transaction_id LIMIT 30`).bind(workspace).all()).results
  const counts = (await env.DB.prepare('SELECT state,COUNT(*) AS count FROM ai_category_jobs WHERE workspace_id=? GROUP BY state').bind(workspace).all()).results
  return success({ enabled:aiEnabled(env), keyConfigured:Boolean(env.OPENAI_API_KEY?.trim()), model:'gpt-4o-mini', dailyLimit:dailyLimit(env), usedToday:usage?.requests??0, jobs, counts })
}

export async function aiAuditDetailsRoute(request: Request, env: Env, transactionId: string) {
  if (request.method !== 'GET') return methodNotAllowed()
  const workspace = env.DEFAULT_WORKSPACE_ID
  const job = await env.DB.prepare(`SELECT j.transaction_id AS transactionId,t.description,j.state,j.model,c.name AS categoryName,j.keyword,j.reason,j.input_tokens AS inputTokens,j.output_tokens AS outputTokens,j.attempts,j.updated_at AS updatedAt,j.error_code AS errorCode FROM ai_category_jobs j JOIN transactions t ON t.id=j.transaction_id AND t.workspace_id=j.workspace_id LEFT JOIN categories c ON c.id=j.category_id AND c.workspace_id=j.workspace_id WHERE j.workspace_id=? AND j.transaction_id=?`).bind(workspace,transactionId).first()
  if (!job) throw new ApiError(404,'AI_AUDIT_NOT_FOUND','No AI history is available for this transaction.')
  const audits = (await env.DB.prepare(`SELECT id,attempt_number AS attemptNumber,model,request_json AS requestJson,response_json AS responseJson,request_id AS requestId,http_status AS httpStatus,input_tokens AS inputTokens,cached_input_tokens AS cachedInputTokens,output_tokens AS outputTokens,estimated_cost_nano_usd AS estimatedCostNanoUsd,pricing_version AS pricingVersion,duration_ms AS durationMs,error_code AS errorCode,started_at AS startedAt,completed_at AS completedAt FROM ai_category_audits WHERE workspace_id=? AND transaction_id=? ORDER BY attempt_number,started_at,id`).bind(workspace,transactionId).all()).results
  return success({ job, audits })
}
