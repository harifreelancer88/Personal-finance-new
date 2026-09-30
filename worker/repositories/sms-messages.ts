import type { SmsMessageRow } from '../types'

const columns = `id, workspace_id, external_id, dedupe_key, sender, raw_text, received_at,
  parse_status, parse_confidence, parse_notes, parsed_transaction_type, parsed_amount_minor,
  parsed_description, parsed_transaction_date, parsed_account_last4, bank_reference, transaction_id, created_at, updated_at`

export function getSmsByDedupe(db: D1Database, workspaceId: string, dedupeKey: string) {
  return db.prepare(`SELECT ${columns} FROM sms_messages WHERE workspace_id = ? AND dedupe_key = ?`).bind(workspaceId, dedupeKey).first<SmsMessageRow>()
}

export function getSmsForTransaction(db: D1Database, workspaceId: string, transactionId: string) {
  return db.prepare(`SELECT ${columns} FROM sms_messages WHERE workspace_id = ? AND transaction_id = ?`).bind(workspaceId, transactionId).first<SmsMessageRow>()
}

export function getRecentSmsByBankReference(db: D1Database, workspaceId: string, bankReference: string, amountMinor: number | null, receivedAt: string, smsId: string) {
  return db.prepare(`SELECT ${columns} FROM sms_messages
    WHERE workspace_id = ? AND bank_reference = ? AND parsed_amount_minor = ? AND id <> ?
      AND julianday(received_at) BETWEEN julianday(?) - 3 AND julianday(?) + 3
    ORDER BY CASE WHEN transaction_id IS NULL THEN 1 ELSE 0 END, ABS(julianday(received_at) - julianday(?))
    LIMIT 1`).bind(workspaceId, bankReference, amountMinor, smsId, receivedAt, receivedAt, receivedAt).first<SmsMessageRow>()
}

export async function listSmsMessages(db: D1Database, workspaceId: string, parseStatus: string | undefined, limit: number, offset: number) {
  const status = parseStatus ? ' AND parse_status = ?' : ''
  const args: unknown[] = [workspaceId]
  if (parseStatus) args.push(parseStatus)
  args.push(limit, offset)
  return (await db.prepare(`SELECT ${columns} FROM sms_messages WHERE workspace_id = ?${status} ORDER BY received_at DESC LIMIT ? OFFSET ?`).bind(...args).all<SmsMessageRow>()).results
}
