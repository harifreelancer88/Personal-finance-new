import { failure, success } from '../lib/http'
import { ApiError, parseJsonObject } from '../lib/transaction-validation'
import { isFinancialSmsCandidate, parseSms, resolveDirectionalTransaction } from '../lib/sms-parser'
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
  // Screen before computing dedupe or writing raw text so OTPs and marketing
  // messages never accumulate in D1. A completed monetary transaction wins
  // over incidental security advice such as dispute/BLOCK instructions.
  if (!isFinancialSmsCandidate(message)) return success({ ignored: true, reason: 'non_financial' })
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
  const findAccounts = async (last4: string | null, accountType?: 'credit_card') => {
    if (!last4) return [] as string[]
    const matches = accountType
      ? await env.DB.prepare('SELECT id FROM accounts WHERE workspace_id = ? AND is_active = 1 AND last4 = ? AND account_type = ? LIMIT 2').bind(workspaceId, last4, accountType).all<{ id: string }>()
      : await env.DB.prepare('SELECT id FROM accounts WHERE workspace_id = ? AND is_active = 1 AND last4 = ? LIMIT 2').bind(workspaceId, last4).all<{ id: string }>()
    return matches.results.map(({ id }) => id)
  }
  const directionalPair = !!parsed.sourceAccountLast4 && !!parsed.destinationAccountLast4
  const sourceMatches = await findAccounts(parsed.isCreditCardRepayment ? parsed.sourceAccountLast4 : directionalPair ? parsed.sourceAccountLast4 : parsed.transactionType === 'expense' ? parsed.accountLast4 : null)
  const destinationMatches = await findAccounts(parsed.isCreditCardRepayment ? parsed.accountLast4 : directionalPair ? parsed.destinationAccountLast4 : parsed.transactionType === 'income' || parsed.transactionType === 'refund' ? parsed.accountLast4 : null, parsed.isCreditCardRepayment ? 'credit_card' : undefined)
  const direction = resolveDirectionalTransaction(sourceMatches, destinationMatches)
  const sourceAccountId = sourceMatches.length === 1 ? sourceMatches[0] : null
  const destinationAccountId = destinationMatches.length === 1 ? destinationMatches[0] : null
  let resolvedType = parsed.transactionType
  let resolvedStatus = parsed.status
  if (directionalPair && parsed.amountMinor && parsed.description) {
    resolvedType = direction.transactionType
    if (resolvedType) resolvedStatus = 'parsed'
  }
  let categoryId: string | null = null
  const categoryName = mappedCategoryName(message)
  if (categoryName) categoryId = (await env.DB.prepare('SELECT id FROM categories WHERE workspace_id = ? AND is_active = 1 AND name = ? COLLATE NOCASE').bind(workspaceId, categoryName).first<{ id: string }>())?.id ?? null
  let transactionId: string | null = null
  if (resolvedStatus === 'parsed' && resolvedType && parsed.amountMinor && parsed.description) {
    transactionId = crypto.randomUUID()
    const fromAccount = resolvedType === 'expense' || resolvedType === 'transfer' ? sourceAccountId : null
    const toAccount = resolvedType === 'income' || resolvedType === 'refund' || resolvedType === 'transfer' ? destinationAccountId : null
    await env.DB.prepare(`INSERT INTO transactions (id, workspace_id, transaction_type, description, amount_minor, category_id,
      from_account_id, to_account_id, transaction_date, source, external_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sms', ?, 'pending')`)
      .bind(transactionId, workspaceId, resolvedType, parsed.description, parsed.amountMinor, categoryId, fromAccount, toAccount, parsed.transactionDate, dedupeKey).run()
  }
  const accountNotes = directionalPair
    ? ` Source account ${sourceAccountId ? 'matched' : sourceMatches.length > 1 ? 'was ambiguous' : 'was not matched'}; destination account ${destinationAccountId ? 'matched' : destinationMatches.length > 1 ? 'was ambiguous' : 'was not matched'}.`
    : parsed.accountLast4 ? ` Account ${sourceAccountId || destinationAccountId ? 'uniquely matched' : sourceMatches.length > 1 || destinationMatches.length > 1 ? 'was ambiguous' : 'was not matched'}.` : ''
  const notes = `${parsed.notes}${accountNotes ? ` ${accountNotes}` : ''}${categoryName ? categoryId ? ` Category ${categoryName} matched.` : ` Category rule ${categoryName} had no existing category.` : ''}`
  await env.DB.prepare(`UPDATE sms_messages SET parse_status = ?, parse_confidence = ?, parse_notes = ?, parsed_transaction_type = ?,
    parsed_amount_minor = ?, parsed_description = ?, parsed_transaction_date = ?, parsed_account_last4 = ?, transaction_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(resolvedStatus, parsed.confidence, notes, resolvedType, parsed.amountMinor, parsed.description, parsed.transactionDate, parsed.accountLast4, transactionId, smsId).run()
  return success(result(await getSmsByDedupe(env.DB, workspaceId, dedupeKey), false), { status: 201 })
}
