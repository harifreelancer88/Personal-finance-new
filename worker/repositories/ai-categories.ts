import { tokenCostNanoUsd, AI_PRICING_VERSION } from '../../shared/ai-audit'
import type { Env } from '../types'
import { cleanNarration, requestAiCategory, type AiCategory } from '../lib/ai-categorization'
import { assignCategory, listCategoryRules } from './category-rules'
import { normalizeKeyword } from '../lib/category-rules'

type EligibleTransaction = { id: string; transaction_type: string; description: string; category_revision: number; category_origin: string | null }
export const aiEnabled = (env: Env) => env.AI_CATEGORIZATION_ENABLED === 'true' && Boolean(env.OPENAI_API_KEY?.trim())
export function dailyLimit(env: Env) { const n = Number(env.AI_DAILY_REQUEST_LIMIT ?? 20); return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 20 }
async function eligible(env: Env, id: string) {
  return env.DB.prepare(`SELECT id,transaction_type,description,category_revision,category_origin FROM transactions WHERE id=? AND workspace_id=? AND category_id IS NULL AND category_origin IS NOT 'manual' AND status<>'ignored' AND transaction_type IN ('expense','income','refund')`).bind(id, env.DEFAULT_WORKSPACE_ID).first<EligibleTransaction>()
}
export async function enqueueAi(env: Env, id: string) {
  if (!aiEnabled(env) || !await eligible(env, id)) return
  await env.DB.prepare('INSERT OR IGNORE INTO ai_category_jobs(transaction_id,workspace_id) VALUES(?,?)').bind(id, env.DEFAULT_WORKSPACE_ID).run()
}
export async function enqueueUnmatched(env: Env) {
  if (!aiEnabled(env)) return 0
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO ai_category_jobs(transaction_id,workspace_id) SELECT id,workspace_id FROM transactions WHERE workspace_id=? AND category_id IS NULL AND category_origin IS NOT 'manual' AND status<>'ignored' AND transaction_type IN ('expense','income','refund') AND NOT EXISTS(SELECT 1 FROM ai_category_jobs j WHERE j.transaction_id=transactions.id) ORDER BY created_at DESC LIMIT 20`).bind(env.DEFAULT_WORKSPACE_ID).run()
  return result.meta.changes ?? 0
}
export async function markManualCategory(env: Env, id: string, categoryId: string | null) {
  const workspace = env.DEFAULT_WORKSPACE_ID
  await env.DB.batch([
    env.DB.prepare("UPDATE transactions SET category_origin='manual' WHERE id=? AND workspace_id=?").bind(id, workspace),
    env.DB.prepare("UPDATE category_rules SET category_id=?,is_active=?,source='manual',updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND source='ai' AND keyword=(SELECT keyword FROM ai_category_jobs WHERE transaction_id=? AND workspace_id=?) AND transaction_type=(SELECT transaction_type FROM transactions WHERE id=? AND workspace_id=?)").bind(categoryId,categoryId?1:0,workspace,id,workspace,id,workspace),
    env.DB.prepare("UPDATE ai_category_jobs SET state='corrected',corrected_category_id=?,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE transaction_id=? AND workspace_id=?").bind(categoryId, id, workspace),
  ])
}
export async function processAiJob(env: Env, id: string, fetcher: typeof fetch = fetch) {
  if (!aiEnabled(env)) return
  const db = env.DB, workspace = env.DEFAULT_WORKSPACE_ID, lease = crypto.randomUUID()
  const claim = await db.prepare(`UPDATE ai_category_jobs SET state='processing',attempts=attempts+1,lease_token=?,updated_at=CURRENT_TIMESTAMP WHERE transaction_id=? AND workspace_id=? AND attempts<2 AND next_attempt_at<=CURRENT_TIMESTAMP AND (state='queued' OR (state='processing' AND updated_at<datetime('now','-2 minutes')))` ).bind(lease, id, workspace).run()
  if (!claim.meta.changes) return
  const finish = async (state: string, error: string | null = null) => db.prepare(`UPDATE ai_category_jobs SET state=?,error_code=?,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE transaction_id=? AND workspace_id=? AND lease_token=?`).bind(state, error, id, workspace, lease).run()
  try {
    const t = await eligible(env, id)
    if (!t) { await finish('superseded'); return }
    const rules = await listCategoryRules(db, workspace)
    const narration = cleanNarration(t.description)
    // Explicit paused or conflicting rules block AI overrides as well as ordinary matching.
    if (rules.some(r => r.transaction_type === t.transaction_type && ` ${normalizeKeyword(narration)} `.includes(` ${r.keyword} `) && r.source !== 'ai' && (!r.is_active || !r.category_id))) { await finish('review', 'RULE_BLOCKED'); return }
    const match = await assignCategory(db, workspace, t.transaction_type, t.description)
    if (match) {
      await db.prepare(`UPDATE transactions SET category_id=?,category_origin='rule',category_revision=category_revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND category_id IS NULL AND category_revision=? AND status<>'ignored'`).bind(match,id,workspace,t.category_revision).run()
      await finish('superseded'); return
    }
    if (rules.some(r => r.source !== 'ai' && r.transaction_type === t.transaction_type && ` ${normalizeKeyword(narration)} `.includes(` ${r.keyword} `))) { await finish('review','RULE_CONFLICT'); return }
    const categories = (await db.prepare("SELECT id,name,kind FROM categories WHERE workspace_id=? AND is_active=1 AND (kind='both' OR kind=?) ORDER BY name LIMIT 100").bind(workspace,t.transaction_type==='income'?'income':'expense').all<AiCategory>()).results
    if (!categories.length) { await finish('review','NO_CATEGORIES'); return }
    const examples = (await db.prepare(`SELECT description,category_id AS categoryId FROM transactions WHERE workspace_id=? AND category_origin='manual' AND category_id IN (SELECT value FROM json_each(?)) AND transaction_type=? ORDER BY updated_at DESC LIMIT 6`).bind(workspace,JSON.stringify(categories.map(c=>c.id)),t.transaction_type).all<{description:string;categoryId:string}>()).results
    // Reserve quota atomically BEFORE any network call; failed requests consume quota too.
    const quota = await db.prepare(`INSERT INTO ai_category_usage(workspace_id,day,requests) VALUES(?,date('now','+5 hours','+30 minutes'),1) ON CONFLICT(workspace_id,day) DO UPDATE SET requests=requests+1 WHERE requests<?`).bind(workspace,dailyLimit(env)).run()
    if (!quota.meta.changes) {
      await db.prepare(`UPDATE ai_category_jobs SET state='queued',attempts=attempts-1,next_attempt_at=datetime('now','+1 hour'),lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE transaction_id=? AND workspace_id=? AND lease_token=?`).bind(id,workspace,lease).run(); return
    }
    const attempt = await db.prepare('SELECT attempts FROM ai_category_jobs WHERE transaction_id=? AND workspace_id=? AND lease_token=?').bind(id,workspace,lease).first<{attempts:number}>()
    if (!attempt) return
    const { decision } = await requestAiCategory(env.OPENAI_API_KEY!,narration,t.transaction_type,categories,examples,fetcher, {
      onRequest: async body => {
        await db.prepare(`INSERT INTO ai_category_audits(id,transaction_id,workspace_id,attempt_number,model,request_json,pricing_version) VALUES(?,?,?,?,?,?,?)`).bind(lease,id,workspace,attempt.attempts,'gpt-4o-mini',body,AI_PRICING_VERSION).run()
      },
      onResponse: async result => {
        const usage = result.usage
        await db.batch([
          db.prepare(`UPDATE ai_category_audits SET response_json=?,request_id=?,http_status=?,input_tokens=?,cached_input_tokens=?,output_tokens=?,estimated_cost_nano_usd=?,duration_ms=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?`).bind(result.body,result.requestId,result.status,usage?.inputTokens??null,usage?.cachedInputTokens??null,usage?.outputTokens??null,usage?tokenCostNanoUsd(usage):null,result.durationMs,lease,workspace),
          db.prepare(`UPDATE ai_category_jobs SET input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE transaction_id=? AND workspace_id=?`).bind(usage?.inputTokens??0,usage?.outputTokens??0,id,workspace),
        ])
      },
    })
    await db.prepare(`UPDATE ai_category_jobs SET category_id=?,keyword=?,reason=?,error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE transaction_id=? AND workspace_id=? AND lease_token=?`).bind(decision.categoryId,decision.keyword,decision.reason,id,workspace,lease).run()
    if (decision.decision !== 'categorise') { await finish('review'); return }
    // Re-check rules after the network request; a person may have added a rule meanwhile.
    const currentRules = await listCategoryRules(db,workspace)
    if (currentRules.some(r=>r.transaction_type===t.transaction_type && r.source!=='ai' && ` ${normalizeKeyword(narration)} `.includes(` ${r.keyword} `))) { await finish('superseded','RULE_CHANGED'); return }
    if (currentRules.some(r=>r.source==='ai' && r.keyword===decision.keyword && r.transaction_type===t.transaction_type && r.category_id!==decision.categoryId)) { await finish('review','AI_RULE_DISAGREEMENT'); return }
    // Both the assignment and candidate insertion use the same guarded batch transaction.
    await db.batch([
      db.prepare(`UPDATE transactions SET category_id=?,category_origin='ai',category_revision=category_revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND category_id IS NULL AND category_origin IS NOT 'manual' AND category_revision=? AND transaction_type=? AND description=? AND status<>'ignored' AND NOT EXISTS(SELECT 1 FROM category_rules WHERE workspace_id=? AND source<>'ai' AND transaction_type=? AND instr(?, ' '||keyword||' ')>0) AND EXISTS(SELECT 1 FROM ai_category_jobs WHERE transaction_id=? AND lease_token=? AND state='processing') AND EXISTS(SELECT 1 FROM categories WHERE id=? AND workspace_id=? AND is_active=1 AND (kind='both' OR kind=?))`).bind(decision.categoryId,id,workspace,t.category_revision,t.transaction_type,t.description,workspace,t.transaction_type,` ${normalizeKeyword(narration)} `,id,lease,decision.categoryId,workspace,t.transaction_type==='income'?'income':'expense'),
      db.prepare(`INSERT OR IGNORE INTO category_rules(id,workspace_id,keyword,transaction_type,category_id,is_active,source) SELECT ?,?,?,?,?,0,'ai' FROM transactions WHERE id=? AND workspace_id=? AND category_origin='ai' AND category_id=? AND category_revision=? AND EXISTS(SELECT 1 FROM ai_category_jobs WHERE transaction_id=? AND lease_token=? AND state='processing')`).bind(crypto.randomUUID(),workspace,decision.keyword,t.transaction_type,decision.categoryId,id,workspace,decision.categoryId,t.category_revision+1,id,lease),
      db.prepare(`UPDATE ai_category_jobs SET state=CASE WHEN EXISTS(SELECT 1 FROM transactions WHERE id=? AND workspace_id=? AND category_origin='ai' AND category_id=? AND category_revision=?) THEN 'applied' ELSE 'superseded' END,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE transaction_id=? AND workspace_id=? AND lease_token=?`).bind(id,workspace,decision.categoryId,t.category_revision+1,id,workspace,lease),
    ])
  } catch (error) {
    const code = error instanceof Error && /^(OPENAI_HTTP_\d+|INVALID_AI_\w+|AI_NO_DECISION)$/.test(error.message) ? error.message : 'AI_REQUEST_FAILED'
    await db.prepare('UPDATE ai_category_audits SET error_code=?,completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP) WHERE id=? AND workspace_id=?').bind(code,lease,workspace).run()
    const permanent = /^(OPENAI_HTTP_(400|401|403)|INVALID_AI_|AI_NO_DECISION)/.test(code)
    await db.prepare(`UPDATE ai_category_jobs SET state=CASE WHEN attempts>=2 OR ? THEN 'failed' ELSE 'queued' END,error_code=?,lease_token=NULL,next_attempt_at=datetime('now','+5 minutes'),updated_at=CURRENT_TIMESTAMP WHERE transaction_id=? AND workspace_id=? AND lease_token=?`).bind(permanent?1:0,code,id,workspace,lease).run()
  }
}
export async function drainAiQueue(env: Env) {
  if (!aiEnabled(env)) return
  // Recover a lost final lease without issuing a third paid request.
  await env.DB.prepare(`UPDATE ai_category_jobs SET state='failed',error_code='LEASE_EXPIRED',lease_token=NULL WHERE workspace_id=? AND state='processing' AND attempts>=2 AND updated_at<datetime('now','-2 minutes')`).bind(env.DEFAULT_WORKSPACE_ID).run()
  const rows = (await env.DB.prepare(`SELECT transaction_id FROM ai_category_jobs WHERE workspace_id=? AND attempts<2 AND next_attempt_at<=CURRENT_TIMESTAMP AND (state='queued' OR (state='processing' AND updated_at<datetime('now','-2 minutes'))) ORDER BY created_at LIMIT 2`).bind(env.DEFAULT_WORKSPACE_ID).all<{transaction_id:string}>()).results
  await Promise.all(rows.map(row=>processAiJob(env,row.transaction_id)))
}
