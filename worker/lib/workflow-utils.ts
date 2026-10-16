import { ApiError, parseJsonObject } from './transaction-validation'
export function invalid(message: string, status = 400): never {
  throw new ApiError(status, 'WORKFLOW_ERROR', message)
}
export const todayIST = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
export function dateOnly(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))
    invalid('Enter a valid date (YYYY-MM-DD).')
  const d = new Date(v + 'T12:00:00Z')
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== v)
    invalid('Enter a valid calendar date.')
  return v
}
export function textValue(v: unknown, label: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max)
    invalid(`${label} is required (maximum ${max} characters).`)
  return v.trim()
}
export function minor(v: unknown): number {
  if (!Number.isSafeInteger(v) || (v as number) <= 0)
    invalid('Amount must be positive, in integer paise.')
  return v as number
}
export async function jsonBody(request: Request, max = 2_000_000) {
  const text = await request.text()
  if (new TextEncoder().encode(text).length > max)
    invalid('This request is too large.', 413)
  try {
    return parseJsonObject(JSON.parse(text))
  } catch (e) {
    if (e instanceof ApiError) throw e
    invalid('Invalid JSON.')
  }
}
export async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
export function dueAt(
  first: string,
  sequence: number,
  frequency: string,
  anchor: number,
) {
  const months = frequency === 'annual' ? 12 : frequency === 'quarterly' ? 3 : 1
  const d = new Date(first + 'T12:00:00Z')
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + (sequence - 1) * months)
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate()
  d.setUTCDate(Math.min(anchor, last))
  return d.toISOString().slice(0, 10)
}
