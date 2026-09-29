import type { TransactionRow } from '../types'
import type { TransactionWrite } from '../repositories/transactions'

const types = ['expense', 'income', 'transfer', 'investment', 'refund'] as const
const statuses = ['pending', 'confirmed', 'ignored'] as const
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !datePattern.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

function nullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a string or null.`)
  return value
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_JSON', 'The request body must be a JSON object.')
  if ('workspaceId' in value) throw new ApiError(400, 'VALIDATION_ERROR', 'workspaceId cannot be supplied by clients.')
  return value as Record<string, unknown>
}

export function validateTransaction(value: Record<string, unknown>, current?: TransactionRow): TransactionWrite {
  const read = (key: string, fallback: unknown) => key in value ? value[key] : fallback
  const transactionType = read('transactionType', current?.transaction_type)
  if (!types.includes(transactionType as typeof types[number])) throw new ApiError(400, 'INVALID_TRANSACTION_TYPE', 'transactionType is invalid.')
  const descriptionValue = read('description', current?.description)
  if (typeof descriptionValue !== 'string' || !descriptionValue.trim()) throw new ApiError(400, 'INVALID_DESCRIPTION', 'description is required.')
  const amountMinor = read('amountMinor', current?.amount_minor)
  if (!Number.isInteger(amountMinor) || (amountMinor as number) <= 0) throw new ApiError(400, 'INVALID_AMOUNT', 'amountMinor must be a positive integer number of paise.')
  const transactionDate = read('transactionDate', current?.transaction_date)
  if (!isDate(transactionDate)) throw new ApiError(400, 'INVALID_DATE', 'transactionDate must be a valid YYYY-MM-DD date.')
  const status = read('status', current?.status ?? 'confirmed')
  if (!statuses.includes(status as typeof statuses[number])) throw new ApiError(400, 'INVALID_STATUS', 'status is invalid.')
  const categoryId = nullableString(read('categoryId', current?.category_id), 'categoryId')
  const fromAccountId = nullableString(read('fromAccountId', current?.from_account_id), 'fromAccountId')
  const toAccountId = nullableString(read('toAccountId', current?.to_account_id), 'toAccountId')
  const originalTransactionId = nullableString(read('originalTransactionId', current?.original_transaction_id), 'originalTransactionId')
  const notesValue = read('notes', current?.notes)
  const notes = nullableString(notesValue, 'notes')?.trim() || null
  if ((transactionType === 'expense' || transactionType === 'investment') && (!fromAccountId || toAccountId)) throw new ApiError(400, 'INVALID_ACCOUNT_DIRECTION', `${transactionType} requires fromAccountId and no toAccountId.`)
  if ((transactionType === 'income' || transactionType === 'refund') && (!toAccountId || fromAccountId)) throw new ApiError(400, 'INVALID_ACCOUNT_DIRECTION', `${transactionType} requires toAccountId and no fromAccountId.`)
  if (transactionType === 'transfer' && (!fromAccountId || !toAccountId)) throw new ApiError(400, 'INVALID_ACCOUNT_DIRECTION', 'transfer requires both fromAccountId and toAccountId.')
  if (fromAccountId && fromAccountId === toAccountId) throw new ApiError(409, 'SAME_TRANSFER_ACCOUNT', 'Transfer accounts must be different.')
  return { transactionType: transactionType as TransactionWrite['transactionType'], description: descriptionValue.trim(), amountMinor: amountMinor as number, categoryId, fromAccountId, toAccountId, transactionDate, notes, originalTransactionId, status: status as TransactionWrite['status'] }
}

export async function validateReferences(db: D1Database, workspaceId: string, value: TransactionWrite, ownId?: string): Promise<void> {
  for (const [field, id] of [['fromAccountId', value.fromAccountId], ['toAccountId', value.toAccountId]] as const) {
    if (id && !(await db.prepare('SELECT id FROM accounts WHERE id = ? AND workspace_id = ?').bind(id, workspaceId).first())) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', `${field} does not reference an account in this workspace.`)
  }
  if (value.categoryId && !(await db.prepare('SELECT id FROM categories WHERE id = ? AND workspace_id = ?').bind(value.categoryId, workspaceId).first())) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'categoryId does not reference a category in this workspace.')
  if (value.originalTransactionId) {
    if (value.originalTransactionId === ownId) throw new ApiError(409, 'INVALID_ORIGINAL_TRANSACTION', 'A refund cannot reference itself.')
    if (!(await db.prepare('SELECT id FROM transactions WHERE id = ? AND workspace_id = ?').bind(value.originalTransactionId, workspaceId).first())) throw new ApiError(404, 'ORIGINAL_TRANSACTION_NOT_FOUND', 'originalTransactionId does not reference a transaction in this workspace.')
    if (value.transactionType !== 'refund') throw new ApiError(400, 'INVALID_ORIGINAL_TRANSACTION', 'originalTransactionId is only valid for refunds.')
  }
}
