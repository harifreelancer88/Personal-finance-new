export type SmsTransactionType = 'expense' | 'income' | 'refund' | 'transfer'

export interface ParsedSms {
  status: 'parsed' | 'non_financial' | 'needs_review' | 'unparsed'
  transactionType: SmsTransactionType | null
  amountMinor: number | null
  description: string | null
  transactionDate: string
  accountLast4: string | null
  sourceAccountLast4: string | null
  destinationAccountLast4: string | null
  isCreditCardRepayment: boolean
  confidence: number
  notes: string
}

/** Extract a bank-issued UPI transaction reference, never an unlabelled number. */
export function extractBankReference(message: string): string | null {
  const match = message.match(/\bUPI\s*(?:Ref(?:erence)?(?:\s+No\.?)?\s*)?:\s*([0-9]+)\b/i)
  return match?.[1] ?? null
}

export function resolveDirectionalTransaction(sourceAccountIds: string[], destinationAccountIds: string[]): {
  transactionType: SmsTransactionType | null; fromAccountId: string | null; toAccountId: string | null
} {
  if (sourceAccountIds.length > 1 || destinationAccountIds.length > 1) return { transactionType: null, fromAccountId: null, toAccountId: null }
  const fromAccountId = sourceAccountIds[0] ?? null
  const toAccountId = destinationAccountIds[0] ?? null
  if (fromAccountId && toAccountId && fromAccountId !== toAccountId) return { transactionType: 'transfer', fromAccountId, toAccountId }
  if (fromAccountId && !toAccountId) return { transactionType: 'expense', fromAccountId, toAccountId: null }
  if (!fromAccountId && toAccountId) return { transactionType: 'income', fromAccountId: null, toAccountId }
  return { transactionType: null, fromAccountId: null, toAccountId: null }
}

const amountPattern = /(?:₹|\bINR\s*|\bRs\.?\s*)([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?![\d.])/i
const privateOrPromotionalPattern = /\b(?:OTP|one[ -]time password|verification code|login code|password reset|promo(?:tional)?|offer|discount|sale)\b/i
const transactionPattern = /\b(?:debited|credited|spent|payment|paid|received|withdrawn|refund(?:ed)?|reversed|reversal|purchase(?:d)?|transferred)\b/i
// These words describe a completed movement of money, rather than (for example)
// an OTP "for a purchase" or an advertisement containing a price.
const completedTransactionPattern = /\b(?:debited|credited|spent|paid|received|withdrawn|refunded|reversed|transferred)\b/i
const creditCardRepaymentPattern = /(?:payment(?:\s+of\s+(?:₹|INR|Rs\.?)?\s*[\d,.]+)?\s+(?:has\s+been\s+)?received\s+(?:on|towards)\s+(?:your\s+)?(?:[A-Z][A-Za-z]+\s+Bank\s+)?credit\s+card|credit\s+card\s+payment\s+(?:has\s+been\s+)?received|payment\s+credited\s+to\s+(?:your\s+)?card\s+account|card\s+payment\s+(?:has\s+been\s+)?received)/i

export function isFinancialSmsCandidate(message: string): boolean {
  const hasAmount = parseAmountMinor(message) !== null
  const hasTransaction = transactionPattern.test(message)
  if (!hasAmount || !hasTransaction) return false
  if (privateOrPromotionalPattern.test(message) && !completedTransactionPattern.test(message) && !creditCardRepaymentPattern.test(message)) return false
  return true
}

export function parseAmountMinor(message: string): number | null {
  const match = message.match(amountPattern)
  if (!match) return null
  const raw = match[1]
  const [whole, fraction = ''] = raw.split('.')
  if (!/^\d{1,3}(?:,\d{3})*$|^\d+$/.test(whole)) return null
  const rupees = whole.replaceAll(',', '')
  const amount = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

export function extractAccountLast4(message: string): string | null {
  const match = message.match(/(?:ending(?:\s+in)?|xx+|x{2,}|card(?:\s+(?:no\.?|ending|account))?|a\/c|acct(?:ount)?)\s*[:#-]?\s*(?:\d?x+|\**x*)?([0-9]{1,4})\b/i)
  return match?.[1] ?? null
}

function extractCreditCardLast4(message: string): string | null {
  const match = message.match(/credit\s+card(?:\s+(?:account|no\.?|ending))?\s*[:#-]?\s*(?:\d?x+|\**x*)?([0-9]{1,4})\b/i)
  return match?.[1] ?? null
}

/** Extract only suffixes which are grammatically attached to their transaction direction. */
export function extractDirectionalAccountSuffixes(message: string): { sourceAccountLast4: string | null; destinationAccountLast4: string | null } {
  const account = String.raw`(?:acct(?:ount)?|a\/c|card(?:\s+(?:no\.?|ending))?)\s*[:#-]?\s*\**x*([0-9]{1,4})`
  const source = message.match(new RegExp(`${account}\\s+(?:was\\s+)?debited\\b`, 'i'))
  const destination = message.match(new RegExp(`${account}\\s+(?:was\\s+)?credited\\b`, 'i'))
  return { sourceAccountLast4: source?.[1] ?? null, destinationAccountLast4: destination?.[1] ?? null }
}

function validDate(year: number, month: number, day: number): string | null {
  const value = new Date(Date.UTC(year, month - 1, day))
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function transactionDate(message: string, receivedAt: string): { date: string; explicit: boolean } {
  const iso = message.match(/\b(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)\b/)
  if (iso) { const date = validDate(+iso[1], +iso[2], +iso[3]); if (date) return { date, explicit: true } }
  const indian = message.match(/\b([0-3]?\d)[/-]([01]?\d)[/-](20\d{2})\b/)
  if (indian) { const date = validDate(+indian[3], +indian[2], +indian[1]); if (date) return { date, explicit: true } }
  const monthNames: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 }
  const named = message.match(/\b([0-3]?\d)[-\s](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-\s](\d{2}|20\d{2})\b/i)
  if (named) {
    const rawYear = +named[3]
    const year = named[3].length === 2 ? 2000 + rawYear : rawYear
    const date = validDate(year, monthNames[named[2].toUpperCase()], +named[1])
    if (date) return { date, explicit: true }
  }
  return { date: receivedAt.slice(0, 10), explicit: false }
}

function description(message: string, sender?: string | null): { value: string; merchant: boolean } {
  const match = message.match(/\b(?:UPI\s+to|at|to)\s+([A-Z0-9][A-Z0-9 .&'_-]{1,40}?)(?=\s+(?:on|using|via|ref|txn|transaction|avl|available|balance|for)\b|[,.]|$)/i)
  if (match && /[a-z]/i.test(match[1])) return { value: match[1].trim().replace(/\s+/g, ' '), merchant: true }
  if (/\bUPI\b/i.test(message)) return { value: 'UPI payment', merchant: false }
  const cleanSender = sender?.trim().replace(/[^a-z0-9 ]/gi, ' ')
  return { value: cleanSender ? `${cleanSender.replace(/\s+/g, ' ')} transaction` : 'SMS transaction', merchant: false }
}

export function parseSms(message: string, receivedAt: string, sender?: string | null): ParsedSms {
  const date = transactionDate(message, receivedAt)
  const directional = extractDirectionalAccountSuffixes(message)
  const isCreditCardRepayment = creditCardRepaymentPattern.test(message)
  const accountLast4 = (isCreditCardRepayment ? extractCreditCardLast4(message) : null) ?? directional.sourceAccountLast4 ?? directional.destinationAccountLast4 ?? extractAccountLast4(message)
  const amountMinor = parseAmountMinor(message)
  if (!isFinancialSmsCandidate(message)) return { status: 'non_financial', transactionType: null, amountMinor, description: null, transactionDate: date.date, accountLast4, ...directional, isCreditCardRepayment: false, confidence: 0.98, notes: 'No completed financial transaction was detected.' }
  const refund = /\b(?:refund(?:ed)?|reversed|reversal|credited back)\b/i.test(message)
  const expense = /\b(?:spent|debited|purchase(?:d)?|paid|withdrawn)\b/i.test(message)
  const income = /\b(?:credited|received|deposited|salary credited)\b/i.test(message)
  const directionalPair = !refund && expense && income && !!directional.sourceAccountLast4 && !!directional.destinationAccountLast4
  const matches = [refund, expense, income].filter(Boolean).length
  const type: SmsTransactionType | null = isCreditCardRepayment ? 'transfer' : refund ? 'refund' : directionalPair ? 'transfer' : matches === 1 && expense ? 'expense' : matches === 1 && income ? 'income' : null
  const desc = isCreditCardRepayment ? { value: 'Credit card payment', merchant: true } : directionalPair ? { value: 'UPI transfer', merchant: true } : description(message, sender)
  const notes: string[] = []
  if (type) notes.push(`${type} keyword recognized`); else if (directionalPair) notes.push('Linked debit and credit account indicators recognized'); else notes.push(matches > 1 ? 'Conflicting transaction indicators' : 'No supported transaction indicator')
  if (amountMinor) notes.push('INR amount parsed'); else notes.push('No valid positive INR amount')
  notes.push(date.explicit ? 'transaction date parsed from message' : 'received date used')
  if (accountLast4) notes.push('account suffix recognized')
  const ready = !!amountMinor && (!!type || directionalPair)
  const confidence = ready ? (desc.merchant ? 0.95 : 0.88) : amountMinor || type ? 0.45 : 0.1
  return { status: type && amountMinor ? 'parsed' : amountMinor || type ? 'needs_review' : 'unparsed', transactionType: type, amountMinor, description: ready ? desc.value : null, transactionDate: date.date, accountLast4, ...directional, isCreditCardRepayment, confidence, notes: notes.join('; ') + '.' }
}
