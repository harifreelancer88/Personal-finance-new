import { failure, success } from '../lib/http'
import { ApiError, parseJsonObject } from '../lib/transaction-validation'
import { extractBankReference, isFinancialSmsCandidate, parseSms } from '../lib/sms-parser'
import { mappedCategoryName } from '../lib/sms-category'
import { getRecentSmsByBankReference, getSmsByDedupe } from '../repositories/sms-messages'
import type { Env } from '../types'
import { isSmsAuthorized, smsDedupeKey } from '../lib/sms-security'
import { canAutoConfirmSms, mayReconcileSms, SMS_AUTO_CONFIRM_NOTE } from '../lib/sms-approval'

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
  // Replays can recover an unparsed SMS after a parser fix. An external ID
  // collision must never substitute new content for the stored original.
  if (existing && (existing.transaction_id || existing.raw_text !== message)) return success(result(existing, true))

  const smsId = existing?.id ?? crypto.randomUUID()
  const bankReference = extractBankReference(message)
  if (!existing) {
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO sms_messages
      (id, workspace_id, external_id, dedupe_key, sender, raw_text, received_at, bank_reference)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(smsId, workspaceId, externalId, dedupeKey, sender, message, receivedAt, bankReference).run()
    if ((inserted.meta.changes ?? 0) === 0) return success(result(await getSmsByDedupe(env.DB, workspaceId, dedupeKey), true))
  }

  const parsed = parseSms(message, receivedAt, sender)
  const findAccounts = async (suffix: string | null, accountType?: 'credit_card') => {
    if (!suffix) return [] as string[]
    const rows = accountType
      ? await env.DB.prepare('SELECT id FROM accounts WHERE workspace_id = ? AND is_active = 1 AND last4 = ? AND account_type = ? LIMIT 2').bind(workspaceId, suffix, accountType).all<{ id: string }>()
      : await env.DB.prepare('SELECT id FROM accounts WHERE workspace_id = ? AND is_active = 1 AND last4 = ? LIMIT 2').bind(workspaceId, suffix).all<{ id: string }>()
    return rows.results.map(row => row.id)
  }
  const directionalPair = !!parsed.sourceAccountLast4 && !!parsed.destinationAccountLast4
  const sources = await findAccounts(parsed.isCreditCardRepayment ? parsed.sourceAccountLast4 : directionalPair ? parsed.sourceAccountLast4 : parsed.transactionType === 'expense' ? parsed.accountLast4 : null)
  const destinations = await findAccounts(parsed.isCreditCardRepayment ? parsed.accountLast4 : directionalPair ? parsed.destinationAccountLast4 : parsed.transactionType === 'income' || parsed.transactionType === 'refund' ? parsed.accountLast4 : null, parsed.isCreditCardRepayment ? 'credit_card' : undefined)
  const sourceId = sources.length === 1 ? sources[0] : null
  const destinationId = destinations.length === 1 ? destinations[0] : null
  const approve = canAutoConfirmSms(parsed.transactionType, sourceId, destinationId)
  let categoryId: string | null = null
  const categoryName = mappedCategoryName(message)
  if (categoryName) categoryId = (await env.DB.prepare('SELECT id FROM categories WHERE workspace_id = ? AND is_active = 1 AND name = ? COLLATE NOCASE').bind(workspaceId, categoryName).first<{ id: string }>())?.id ?? null
  let parseStatus: string = sourceId && sourceId === destinationId ? 'needs_review' : parsed.status
  let transactionId: string | null = null
  let pairingNote = ''
  type Transaction = { id: string; transaction_type: string; status: string; amount_minor: number; notes: string | null; from_account_id: string | null; to_account_id: string | null }
  const fields = 'id, transaction_type, status, amount_minor, notes, from_account_id, to_account_id'
  // Both delivery paths and both sides of a UPI transfer use the same identity.
  // The existing unique external-ID index also serializes simultaneous inserts.
  const identity = bankReference && parsed.amountMinor
    ? `bankref:${bankReference}:${parsed.transactionDate}:${parsed.amountMinor}` : dedupeKey
  const pairedSms = bankReference ? await getRecentSmsByBankReference(env.DB, workspaceId, bankReference, parsed.amountMinor, receivedAt, smsId) : null
  let transaction = await env.DB.prepare(`SELECT ${fields} FROM transactions WHERE workspace_id = ? AND source = 'sms' AND external_id = ?`).bind(workspaceId, identity).first<Transaction>()
  if (!transaction && pairedSms?.transaction_id) transaction = await env.DB.prepare(`SELECT ${fields} FROM transactions WHERE workspace_id = ? AND id = ?`).bind(workspaceId, pairedSms.transaction_id).first<Transaction>()
  // A controlled API recovery can temporarily create a manual record while
  // production is awaiting the parser deployment. Adopt only an exact recovery
  // identity with the same amount/date/type/accounts, never ordinary manual rows.
  if (!transaction && approve && bankReference) {
    const recoveryNote = `Recovered SMS: ${identity}`
    const recovered = await env.DB.prepare(`SELECT ${fields} FROM transactions WHERE workspace_id = ? AND source = 'manual'
      AND notes = ? AND transaction_type = ? AND amount_minor = ? AND transaction_date = ?
      AND from_account_id IS ? AND to_account_id IS ? LIMIT 2`)
      .bind(workspaceId, recoveryNote, parsed.transactionType, parsed.amountMinor, parsed.transactionDate, sourceId, destinationId).all<Transaction>()
    if (recovered.results.length === 1) {
      await env.DB.prepare(`UPDATE transactions SET source = 'sms', external_id = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE workspace_id = ? AND id = ? AND source = 'manual' AND notes = ?`)
        .bind(identity, SMS_AUTO_CONFIRM_NOTE, workspaceId, recovered.results[0].id, recoveryNote).run()
      transaction = await env.DB.prepare(`SELECT ${fields} FROM transactions WHERE workspace_id = ? AND source = 'sms' AND external_id = ?`).bind(workspaceId, identity).first<Transaction>()
    }
  }

  if (parseStatus === 'parsed' && parsed.transactionType && parsed.amountMinor && parsed.description) {
    if (!transaction) {
      const id = crypto.randomUUID()
      await env.DB.prepare(`INSERT OR IGNORE INTO transactions (id, workspace_id, transaction_type, description, amount_minor, category_id,
        from_account_id, to_account_id, transaction_date, source, external_id, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sms', ?, ?, ?)`)
        .bind(id, workspaceId, parsed.transactionType, parsed.description, parsed.amountMinor, categoryId, sourceId, destinationId, parsed.transactionDate,
          identity, approve ? 'confirmed' : 'pending', approve ? SMS_AUTO_CONFIRM_NOTE : null).run()
      transaction = await env.DB.prepare(`SELECT ${fields} FROM transactions WHERE workspace_id = ? AND source = 'sms' AND external_id = ?`).bind(workspaceId, identity).first<Transaction>()
      if (!transaction) throw new Error('SMS transaction insert was not acknowledged')
    }
    transactionId = transaction.id
    if (directionalPair && transaction.transaction_type !== 'transfer') {
      if (mayReconcileSms(transaction.status, transaction.notes)) {
        // A credit alert may arrive first and be auto-confirmed. Reconcile only
        // pending or untouched automatic records, never a human-reviewed record.
        await env.DB.prepare(`UPDATE transactions SET transaction_type = 'transfer', description = 'UPI transfer', category_id = NULL,
          from_account_id = ?, to_account_id = ?, transaction_date = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
          WHERE workspace_id = ? AND id = ? AND (status = 'pending' OR (status = 'confirmed' AND notes = ?))`)
          .bind(sourceId, destinationId, parsed.transactionDate, approve ? 'confirmed' : 'pending', approve ? SMS_AUTO_CONFIRM_NOTE : null, workspaceId, transaction.id, SMS_AUTO_CONFIRM_NOTE).run()
        parseStatus = 'paired'
        pairingNote = ' Reconciled both bank alerts into one transfer.'
      } else {
        parseStatus = 'pairing_conflict'
        pairingNote = ' Existing human-reviewed transaction retained; manual reconciliation is required.'
      }
    } else if (transaction.transaction_type !== parsed.transactionType && transaction.transaction_type !== 'transfer') {
      parseStatus = 'pairing_conflict'
      pairingNote = ' Conflicting bank-reference transaction retained for review.'
    } else {
      if (pairedSms?.transaction_id || transaction.notes === SMS_AUTO_CONFIRM_NOTE) parseStatus = pairedSms?.transaction_id ? 'paired' : 'parsed'
      pairingNote = approve ? ' Automatically confirmed after unique account matching.' : ' Incomplete or ambiguous account mapping remains in review.'
    }
    if (bankReference && parseStatus !== 'pairing_conflict') {
      await env.DB.prepare(`UPDATE sms_messages SET transaction_id = ?, parse_status = 'paired',
        parse_notes = COALESCE(parse_notes || ' ', '') || ?, updated_at = CURRENT_TIMESTAMP
        WHERE workspace_id = ? AND bank_reference = ? AND id <> ? AND transaction_id IS NULL
          AND parsed_amount_minor = ? AND julianday(received_at) BETWEEN julianday(?) - 3 AND julianday(?) + 3`)
        .bind(transaction.id, 'Linked matching bank-reference delivery to the existing transaction.', workspaceId, bankReference, smsId, parsed.amountMinor, receivedAt, receivedAt).run()
    }
  }
  const accountNotes = ` Source account ${sourceId ? 'matched' : sources.length > 1 ? 'ambiguous' : 'not matched'}; destination account ${destinationId ? 'matched' : destinations.length > 1 ? 'ambiguous' : 'not matched'}.`
  const notes = parsed.notes + accountNotes + pairingNote
  await env.DB.prepare(`UPDATE sms_messages SET bank_reference = ?, parse_status = ?, parse_confidence = ?, parse_notes = ?, parsed_transaction_type = ?,
    parsed_amount_minor = ?, parsed_description = ?, parsed_transaction_date = ?, parsed_account_last4 = ?, transaction_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(bankReference, parseStatus, parsed.confidence, notes, parsed.transactionType, parsed.amountMinor, parsed.description, parsed.transactionDate, parsed.accountLast4, transactionId, smsId).run()
  return success(result(await getSmsByDedupe(env.DB, workspaceId, dedupeKey), !!existing), { status: existing ? 200 : 201 })
}
