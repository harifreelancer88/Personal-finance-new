import { failure, success } from '../lib/http'
import { ApiError, parseJsonObject } from '../lib/transaction-validation'
import { parseSms } from '../lib/sms-parser'
import { mappedCategoryName } from '../lib/sms-category'
import { getSmsByDedupe } from '../repositories/sms-messages'
import type { Env } from '../types'
import { isSmsAuthorized, smsDedupeKey } from '../lib/sms-security'

const MAX_BODY_BYTES = 32 * 1024
const MAX_MESSAGE_CHARS = 10_000

function result(row: Awaited<ReturnType<typeof getSmsByDedupe>>, duplicate: boolean) {
  return { duplicate, smsMessageId: row!.id, parseStatus: row!.parse_status, transactionId: row!.transaction_id }
}

export async function ingestSms(request: Request, env: Env): Promise<Response> {
  if (!(await isSmsAuthorized(request, env.SMS_INGEST_TOKEN))) return failure('UNAUTHORIZED', 'A valid SMS ingestion token is required.', 401)
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return failure('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.', 415)
  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) return failure('PAYLOAD_TOO_LARGE', 'The SMS request is too large.', 413)
  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return failure('PAYLOAD_TOO_LARGE', 'The SMS request is too large.', 413)
  let input: Record<string, unknown>
  try { input = parseJsonObject(JSON.parse(rawBody)) } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'INVALID_JSON', 'The request body must contain valid JSON.')
  }
  const message = input.message, receivedAt = input.receivedAt
  const sender = input.sender === undefined || input.sender === null ? null : input.sender
  const externalId = input.externalId === undefined || input.externalId === null ? null : input.externalId
  if (typeof message !== 'string' || !message.trim()) throw new ApiError(400, 'VALIDATION_ERROR', 'message is required.')
  if (message.length > MAX_MESSAGE_CHARS) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'message is too large.')
  if (typeof receivedAt !== 'string' || !receivedAt.trim() || !Number.isFinite(Date.parse(receivedAt))) throw new ApiError(400, 'VALIDATION_ERROR', 'receivedAt must be a valid ISO date-time.')
  if (sender !== null && (typeof sender !== 'string' || sender.length > 100)) throw new ApiError(400, 'VALIDATION_ERROR', 'sender must be a string of at most 100 characters.')
  if (externalId !== null && (typeof externalId !== 'string' || !externalId.trim() || externalId.length > 255)) throw new ApiError(400, 'VALIDATION_ERROR', 'externalId must be a non-empty string of at most 255 characters.')
  const workspaceId = env.DEFAULT_WORKSPACE_ID
  const dedupeKey = await smsDedupeKey(externalId, sender, receivedAt, message)
  const existing = await getSmsByDedupe(env.DB, workspaceId, dedupeKey)
  if (existing) return success(result(existing, true))

  const smsId = crypto.randomUUID()
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO sms_messages
    (id, workspace_id, external_id, dedupe_key, sender, raw_text, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(smsId, workspaceId, externalId, dedupeKey, sender, message, receivedAt).run()
  if ((inserted.meta.changes ?? 0) === 0) return success(result(await getSmsByDedupe(env.DB, workspaceId, dedupeKey), true))

  const parsed = parseSms(message, receivedAt, sender)
  let accountId: string | null = null
  if (parsed.accountLast4) {
    const matches = await env.DB.prepare('SELECT id FROM accounts WHERE workspace_id = ? AND is_active = 1 AND last4 = ? LIMIT 2').bind(workspaceId, parsed.accountLast4).all<{ id: string }>()
    if (matches.results.length === 1) accountId = matches.results[0].id
  }
  let categoryId: string | null = null
  const categoryName = mappedCategoryName(message)
  if (categoryName) categoryId = (await env.DB.prepare('SELECT id FROM categories WHERE workspace_id = ? AND is_active = 1 AND name = ? COLLATE NOCASE').bind(workspaceId, categoryName).first<{ id: string }>())?.id ?? null
  let transactionId: string | null = null
  if (parsed.status === 'parsed' && parsed.transactionType && parsed.amountMinor && parsed.description) {
    transactionId = crypto.randomUUID()
    const fromAccount = parsed.transactionType === 'expense' ? accountId : null
    const toAccount = parsed.transactionType === 'income' || parsed.transactionType === 'refund' ? accountId : null
    await env.DB.prepare(`INSERT INTO transactions (id, workspace_id, transaction_type, description, amount_minor, category_id,
      from_account_id, to_account_id, transaction_date, source, external_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sms', ?, 'pending')`)
      .bind(transactionId, workspaceId, parsed.transactionType, parsed.description, parsed.amountMinor, categoryId, fromAccount, toAccount, parsed.transactionDate, dedupeKey).run()
  }
  const notes = `${parsed.notes}${parsed.accountLast4 ? accountId ? ' Unique active account matched.' : ' Account was not uniquely matched.' : ''}${categoryName ? categoryId ? ` Category ${categoryName} matched.` : ` Category rule ${categoryName} had no existing category.` : ''}`
  await env.DB.prepare(`UPDATE sms_messages SET parse_status = ?, parse_confidence = ?, parse_notes = ?, parsed_transaction_type = ?,
    parsed_amount_minor = ?, parsed_description = ?, parsed_transaction_date = ?, parsed_account_last4 = ?, transaction_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(parsed.status, parsed.confidence, notes, parsed.transactionType, parsed.amountMinor, parsed.description, parsed.transactionDate, parsed.accountLast4, transactionId, smsId).run()
  return success(result(await getSmsByDedupe(env.DB, workspaceId, dedupeKey), false), { status: 201 })
}
