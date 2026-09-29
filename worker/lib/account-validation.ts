import type { AccountRow } from '../types'
import type { AccountWrite } from '../repositories/accounts'
import { ApiError } from './transaction-validation'

const accountTypes = ['bank', 'credit_card', 'cash', 'wallet'] as const
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !datePattern.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

function nullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a string or null.`)
  return value.trim() || null
}

function optionalDay(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 31) throw new ApiError(400, 'INVALID_DAY', `${field} must be an integer between 1 and 31.`)
  return value as number
}

export function validateAccount(value: Record<string, unknown>, current?: AccountRow): AccountWrite {
  const read = (key: string, fallback: unknown) => key in value ? value[key] : fallback
  const name = read('name', current?.name)
  if (typeof name !== 'string' || !name.trim()) throw new ApiError(400, 'INVALID_ACCOUNT_NAME', 'name is required.')
  const accountType = read('accountType', current?.account_type)
  if (!accountTypes.includes(accountType as typeof accountTypes[number])) throw new ApiError(400, 'INVALID_ACCOUNT_TYPE', 'accountType is invalid.')
  const openingBalanceMinor = read('openingBalanceMinor', current?.opening_balance_minor ?? 0)
  if (!Number.isSafeInteger(openingBalanceMinor)) throw new ApiError(400, 'INVALID_OPENING_BALANCE', 'openingBalanceMinor must be an integer number of paise.')
  const dateValue = read('openingBalanceDate', current?.opening_balance_date)
  const openingBalanceDate = dateValue === undefined || dateValue === null || dateValue === '' ? null : dateValue
  if (openingBalanceDate !== null && !validDate(openingBalanceDate)) throw new ApiError(400, 'INVALID_DATE', 'openingBalanceDate must be a valid YYYY-MM-DD date.')
  const last4 = nullableString(read('last4', current?.last4), 'last4')
  if (last4 !== null && (!/^\d{1,4}$/.test(last4))) throw new ApiError(400, 'INVALID_LAST4', 'last4 must contain no more than 4 digits.')
  const creditValue = read('creditLimitMinor', current?.credit_limit_minor)
  const creditLimitMinor = creditValue === undefined || creditValue === null || creditValue === '' ? null : creditValue
  if (creditLimitMinor !== null && (!Number.isSafeInteger(creditLimitMinor) || (creditLimitMinor as number) < 0)) throw new ApiError(400, 'INVALID_CREDIT_LIMIT', 'creditLimitMinor must be a non-negative integer number of paise.')
  const billingDay = optionalDay(read('billingDay', current?.billing_day), 'billingDay')
  const dueDay = optionalDay(read('dueDay', current?.due_day), 'dueDay')
  if (accountType !== 'credit_card' && (creditLimitMinor !== null || billingDay !== null || dueDay !== null)) throw new ApiError(400, 'INVALID_CREDIT_CARD_FIELDS', 'Credit limit, billing day and due day are only valid for credit cards.')
  const active = read('isActive', current ? current.is_active === 1 : true)
  if (typeof active !== 'boolean') throw new ApiError(400, 'INVALID_ACTIVE_STATUS', 'isActive must be a boolean.')
  return { name: name.trim(), institution: nullableString(read('institution', current?.institution), 'institution') ?? '', accountType: accountType as AccountWrite['accountType'], last4, openingBalanceMinor: openingBalanceMinor as number, openingBalanceDate: openingBalanceDate as string | null, creditLimitMinor: creditLimitMinor as number | null, billingDay, dueDay, notes: nullableString(read('notes', current?.notes), 'notes'), isActive: active }
}
