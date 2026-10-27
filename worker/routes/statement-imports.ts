import { importBlockers } from '../../shared/statement-matching'
import type { Env } from '../types'
import type {
  StatementExtraction,
  StatementSource,
  StatementType,
  StatementSelection,
} from '../../shared/statement-import'
import { success, methodNotAllowed } from '../lib/http'
import { invalid, jsonBody, textValue, hash } from '../lib/workflow-utils'
import {
  checkExtraction,
  mergeExtraction,
  statementPrompt,
  callStatementAi,
} from '../lib/statement-ai'
import {
  CHUNK_SIZE,
  reviewStatement,
  statementTarget,
  type StatementBatch,
} from '../lib/statement-review'
import { dailyLimit } from '../repositories/ai-categories'
import { AI_MODEL } from '../lib/ai-categorization'
import { statementCommit } from './statement-commit'
import { normalizeStatementExtraction } from '../lib/statement-normalization'
export async function statementImportsRoute(
  request: Request,
  env: Env,
  id?: string,
  action?: string,
  fetcher: typeof fetch = fetch,
) {
  const db = env.DB,
    ws = env.DEFAULT_WORKSPACE_ID
  if (id === 'status' && request.method === 'GET')
    return success({
      configured: Boolean(env.OPENAI_API_KEY?.trim()),
      model: AI_MODEL,
      maxRows: 600,
      maxCharacters: 100000,
      chunkSize: CHUNK_SIZE,
    })
  if (!id && request.method === 'GET')
    return success(
      (
        await db
          .prepare(
            'SELECT id,statement_type,target_id,file_name,sheet_name,status,next_chunk,error,created_at,result_json FROM statement_imports WHERE workspace_id=? ORDER BY created_at DESC LIMIT 50',
          )
          .bind(ws)
          .all()
      ).results,
    )
  if (!id && request.method === 'POST') {
    const b = await jsonBody(request, 800000),
      type = String(b.statementType) as StatementType,
      target = textValue(b.targetId, 'Destination'),
      source = b.source as StatementSource
    if (!['bank', 'nps', 'epf'].includes(type))
      invalid('Choose Bank/card, NPS or EPFO.')
    await statementTarget(env, type, target)
    if (
      !source ||
      !Array.isArray(source.rows) ||
      source.rows.length < 1 ||
      source.rows.length > 600 ||
      typeof source.fileName !== 'string' ||
      !source.fileName.match(/\.(csv|tsv|txt|xls|xlsx)$/i) ||
      source.fileName.length > 200 ||
      typeof source.sheetName !== 'string' ||
      source.sheetName.length > 200
    )
      invalid('Choose a supported statement with 1–600 source rows.')
    const seen = new Set<number>()
    for (const row of source.rows) {
      if (
        !row ||
        !Number.isInteger(row.number) ||
        row.number < 1 ||
        seen.has(row.number) ||
        !Array.isArray(row.cells) ||
        row.cells.length > 40 ||
        row.cells.some((c) => typeof c !== 'string' || c.length > 2000)
      )
        invalid('Invalid spreadsheet rows or columns.')
      seen.add(row.number)
    }
    if (JSON.stringify(source.rows).length > 100000)
      invalid(
        'This statement is too large for AI review. Choose a smaller date range.',
        413,
      )
    const content = await hash(
        JSON.stringify({
          type,
          target,
          rows: source.rows,
          sheet: source.sheetName,
        }),
      ),
      old = await db
        .prepare(
          'SELECT * FROM statement_imports WHERE workspace_id=? AND statement_type=? AND target_id=? AND content_hash=?',
        )
        .bind(ws, type, target, content)
        .first<StatementBatch>()
    if (old) return success(await reviewStatement(env, old))
    const bid = crypto.randomUUID()
    await db
      .prepare(
        'INSERT INTO statement_imports(id,workspace_id,statement_type,target_id,file_name,sheet_name,content_hash,source_json) VALUES (?,?,?,?,?,?,?,?)',
      )
      .bind(
        bid,
        ws,
        type,
        target,
        source.fileName,
        source.sheetName,
        content,
        JSON.stringify(source),
      )
      .run()
    return success(
      await reviewStatement(
        env,
        (await db
          .prepare('SELECT * FROM statement_imports WHERE id=?')
          .bind(bid)
          .first<StatementBatch>())!,
      ),
      { status: 201 },
    )
  }
  const batch = await db
    .prepare('SELECT * FROM statement_imports WHERE id=? AND workspace_id=?')
    .bind(id, ws)
    .first<StatementBatch>()
  if (!batch) invalid('Statement import not found.', 404)
  if (!action && request.method === 'DELETE') {
    const result = await db
      .prepare(
        "DELETE FROM statement_imports WHERE id=? AND workspace_id=? AND status IN ('uploaded','failed','review') AND NOT EXISTS(SELECT 1 FROM statement_import_items WHERE import_id=statement_imports.id)",
      )
      .bind(id, ws)
      .run()
    if (!result.meta.changes)
      invalid(
        'Only an unimported statement that is not currently parsing can be discarded.',
        409,
      )
    return success({ discarded: true })
  }
  if (!action && request.method === 'GET')
    return success(await reviewStatement(env, batch))
  if (action === 'source' && request.method === 'GET') {
    const source: StatementSource = JSON.parse(batch.source_json),
      row = source.rows.find(
        (r) =>
          r.number === Number(new URL(request.url).searchParams.get('row')),
      )
    if (!row) invalid('Source row not found.', 404)
    return success(row)
  }
  if (action === 'audit' && request.method === 'GET')
    return success(
      (
        await db
          .prepare(
            'SELECT id,chunk_number,model,request_json,response_json,request_id,http_status,input_tokens,output_tokens,estimated_cost_nano_usd,error,created_at FROM statement_ai_attempts WHERE import_id=? AND workspace_id=? ORDER BY created_at,id',
          )
          .bind(id, ws)
          .all()
      ).results,
    )
  if (action === 'parse' && request.method === 'POST') {
    if (!env.OPENAI_API_KEY?.trim())
      invalid(
        'Configure the existing OPENAI_API_KEY Worker secret to parse statements.',
        503,
      )
    if (['review', 'committed'].includes(batch.status))
      return success(await reviewStatement(env, batch))
    const lease = crypto.randomUUID(),
      claimed = await db
        .prepare(
          "UPDATE statement_imports SET status='parsing',lease_token=?,lease_at=CURRENT_TIMESTAMP,attempts=attempts+1,error=NULL WHERE id=? AND workspace_id=? AND next_chunk=? AND attempts<2 AND (status IN ('uploaded','failed') OR (status='parsing' AND lease_at<datetime('now','-3 minutes')))",
        )
        .bind(lease, id, ws, batch.next_chunk)
        .run()
    if (!claimed.meta.changes)
      invalid(
        'Parsing is running, or this chunk reached its two-attempt limit. Refresh the review; no duplicate request was sent.',
        409,
      )
    try {
      const quota = await db
        .prepare(
          "INSERT INTO ai_category_usage(workspace_id,day,requests) VALUES(?,date('now','+5 hours','+30 minutes'),1) ON CONFLICT(workspace_id,day) DO UPDATE SET requests=requests+1 WHERE requests<?",
        )
        .bind(ws, dailyLimit(env))
        .run()
      if (!quota.meta.changes) {
        await db
          .prepare(
            "UPDATE statement_imports SET status='uploaded',attempts=attempts-1,lease_token=NULL,error='Daily AI request limit reached. Resume after the quota resets.' WHERE id=? AND lease_token=?",
          )
          .bind(id, lease)
          .run()
        invalid(
          'Daily AI limit reached. This shares the existing AI categorisation quota. Resume after it resets.',
          429,
        )
      }
      const source: StatementSource = JSON.parse(batch.source_json),
        block = source.rows.slice(
          batch.next_chunk * CHUNK_SIZE,
          (batch.next_chunk + 1) * CHUNK_SIZE,
        ),
        context = [
          ...source.rows.slice(0, 12),
          ...source.rows.slice(-8),
        ].filter((r) => !block.some((b) => b.number === r.number))
      const [categories, examples] = await Promise.all([
        db
          .prepare(
            'SELECT id,name,kind FROM categories WHERE workspace_id=? AND is_active=1 ORDER BY name LIMIT 100',
          )
          .bind(ws)
          .all<{ id: string; name: string; kind: string }>(),
        db
          .prepare(
            "SELECT description,category_id categoryId FROM transactions WHERE workspace_id=? AND category_origin='manual' AND category_id IS NOT NULL ORDER BY updated_at DESC LIMIT 8",
          )
          .bind(ws)
          .all<{ description: string; categoryId: string }>(),
      ])
      const body = statementPrompt(
        batch.statement_type,
        block,
        context,
        categories.results,
        examples.results,
        source.rows,
      )
      await db
        .prepare(
          'INSERT INTO statement_ai_attempts(id,import_id,workspace_id,chunk_number,model,request_json) VALUES (?,?,?,?,?,?)',
        )
        .bind(lease, id, ws, batch.next_chunk, AI_MODEL, body)
        .run()
      const response = await callStatementAi(env.OPENAI_API_KEY, body, fetcher)
      await db
        .prepare(
          'UPDATE statement_ai_attempts SET response_json=?,request_id=?,http_status=?,input_tokens=?,output_tokens=?,cached_input_tokens=?,estimated_cost_nano_usd=?,completed_at=CURRENT_TIMESTAMP WHERE id=?',
        )
        .bind(
          response.raw.slice(0, 200000),
          response.requestId,
          response.status,
          response.usage?.inputTokens ?? null,
          response.usage?.outputTokens ?? null,
          response.usage?.cachedInputTokens ?? null,
          response.cost,
          lease,
        )
        .run()
      if (response.status < 200 || response.status >= 300)
        invalid(
          `OpenAI returned HTTP ${response.status}. Check the AI audit and retry.`,
          502,
        )
      if (
        response.choice?.finish_reason !== 'stop' ||
        response.choice.message?.refusal ||
        !response.choice.message?.content
      )
        invalid(
          'AI did not finish a complete result. No financial data was imported. Retry this chunk.',
          502,
        )
      let parsed: unknown
      try {
        parsed = JSON.parse(response.choice.message.content)
      } catch {
        invalid(
          'AI returned invalid JSON. No financial records were imported.',
          502,
        )
      }
      const next = normalizeStatementExtraction(
          mergeExtraction(
            normalizeStatementExtraction(
              JSON.parse(batch.parsed_json),
              source.rows,
              batch.statement_type,
            ),
            normalizeStatementExtraction(
              checkExtraction(parsed, block),
              source.rows,
              batch.statement_type,
            ),
          ),
          source.rows,
          batch.statement_type,
        ),
        finished = (batch.next_chunk + 1) * CHUNK_SIZE >= source.rows.length
      const saved = await db
        .prepare(
          'UPDATE statement_imports SET parsed_json=?,next_chunk=next_chunk+1,status=?,attempts=0,lease_token=NULL,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=? AND next_chunk=?',
        )
        .bind(
          JSON.stringify(next),
          finished ? 'review' : 'uploaded',
          id,
          lease,
          batch.next_chunk,
        )
        .run()
      if (!saved.meta.changes)
        invalid('Parsing lease changed. Refresh before continuing.', 409)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'AI parsing failed.'
      await db.batch([
        db
          .prepare(
            "UPDATE statement_imports SET status='failed',lease_token=NULL,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?",
          )
          .bind(message.slice(0, 500), id, lease),
        db
          .prepare(
            'UPDATE statement_ai_attempts SET error=?,completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP) WHERE id=?',
          )
          .bind(message.slice(0, 500), lease),
      ])
      throw e
    }
    return success(
      await reviewStatement(
        env,
        (await db
          .prepare('SELECT * FROM statement_imports WHERE id=?')
          .bind(id)
          .first<StatementBatch>())!,
      ),
    )
  }
  if (action === 'review' && request.method === 'POST') {
    if (batch.status !== 'review')
      invalid('Finish AI parsing before reviewing.', 409)
    const b = await jsonBody(request),
      parsed = applyCorrections(batch, b),
      review = await reviewStatement(env, {
        ...batch,
        parsed_json: JSON.stringify(parsed),
      })
    return success(review)
  }
  if (action === 'commit' && request.method === 'POST') {
    if (batch.status === 'committed')
      return success(await reviewStatement(env, batch))
    if (batch.status !== 'review')
      invalid('Finish AI parsing before importing.', 409)
    const b = await jsonBody(request)
    if (b.confirmTarget !== true || b.confirmReview !== true)
      invalid('Confirm the destination and review before importing.')
    const extraction = applyCorrections(batch, b),
      review = await reviewStatement(env, {
        ...batch,
        parsed_json: JSON.stringify(extraction),
      })
    if (b.expectedTarget !== review.expectedTarget)
      invalid(
        'Records changed since review. Refresh matches and confirm again.',
        409,
      )
    const blockers = importBlockers(
      review.blockers,
      review.statementType === 'bank',
      Array.isArray(b.selections) ? b.selections : [],
    )
    if (blockers.length) invalid(blockers.join(' '))
    if (
      !Array.isArray(b.selections) ||
      b.selections.length !== review.rows.length ||
      new Set(b.selections.map((s: any) => s?.sourceRow)).size !==
        review.rows.length
    )
      invalid('Provide one decision for every parsed row.')
    await statementCommit(
      env,
      batch,
      review,
      b.selections as StatementSelection[],
      {
        preserveBalance: b.preserveBalance === true,
        updateValuation: b.updateValuation === true,
        extraction,
      },
    )
    return success(
      await reviewStatement(
        env,
        (await db
          .prepare('SELECT * FROM statement_imports WHERE id=?')
          .bind(id)
          .first<StatementBatch>())!,
      ),
    )
  }
  return methodNotAllowed()
}
function applyCorrections(
  batch: StatementBatch,
  b: Record<string, unknown>,
): StatementExtraction {
  const parsed = normalizeStatementExtraction(
    JSON.parse(batch.parsed_json),
    (JSON.parse(batch.source_json) as StatementSource).rows,
    batch.statement_type,
  )
  if (b.corrections !== undefined) {
    if (!Array.isArray(b.corrections) || b.corrections.length > 600)
      invalid('Invalid row corrections.')
    const seen = new Set<number>()
    for (const correction of b.corrections) {
      const row = parsed.rows.find((r) => r.sourceRow === correction.sourceRow)
      if (!row || seen.has(row.sourceRow))
        invalid('Invalid correction source row.')
      seen.add(row.sourceRow)
      for (const field of [
        'date',
        'direction',
        'reference',
        'salaryMonth',
        'description',
        'amount',
        'kind',
        'categoryId',
        'employee',
        'employer',
        'pension',
      ] as const)
        if (field in correction) {
          const value = correction[field]
          if (
            (value === null &&
              ['description', 'kind', 'direction', 'reference'].includes(
                field,
              )) ||
            (value !== null &&
              (typeof value !== 'string' || value.length > 200))
          )
            invalid('Invalid correction field.')
          ;(row as any)[field] = value
        }
      if (correction.confirmed === true) row.reviewReason = null
    }
  }
  if (b.summary !== undefined) {
    if (!b.summary || typeof b.summary !== 'object')
      invalid('Invalid summary correction.')
    for (const k of [
      'statementDate',
      'openingBalance',
      'closingBalance',
      'principal',
      'employeeBalance',
      'employerBalance',
      'pensionBalance',
    ] as const)
      if (k in b.summary) {
        const value = (b.summary as Record<string, unknown>)[k]
        if (value !== null && (typeof value !== 'string' || value.length > 80))
          invalid('Invalid summary value.')
        parsed[k] = value as string | null
      }
  }
  if (b.summaryConfirmed === true)
    parsed.warnings = parsed.warnings.filter(
      (w) => !w.startsWith('Conflicting summary field:'),
    )
  return parsed
}
