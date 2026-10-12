import type { SmsTransactionType } from './sms-parser'

export const SMS_AUTO_CONFIRM_NOTE = '[sms:auto-confirmed]'

export function canAutoConfirmSms(type: SmsTransactionType | null, source: string | null, destination: string | null): boolean {
  if (type === 'expense') return !!source && !destination
  if (type === 'income' || type === 'refund') return !source && !!destination
  if (type === 'transfer') return !!source && !!destination && source !== destination
  return false
}

export function mayReconcileSms(status: string, notes: string | null): boolean {
  return status === 'pending' || (status === 'confirmed' && notes === SMS_AUTO_CONFIRM_NOTE)
}
