export type SmsTransactionType = 'expense' | 'income' | 'refund'

export interface ParsedSms {
  status: 'parsed' | 'non_financial' | 'needs_review' | 'unparsed'
  transactionType: SmsTransactionType | null
  amountMinor: number | null
  description: string | null
  transactionDate: string
  accountLast4: string | null
  confidence: number
  notes: string
}

const amountPattern = /(?:₹|\bINR\s*|\bRs\.?\s*)([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?![\d.])/i
const nonFinancialPattern = /\b(?:OTP|one[ -]time password|verification code|login|password|KYC|promotional|offer)\b/i

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
  const match = message.match(/(?:ending(?:\s+in)?|xx+|x{2,}|card(?:\s+(?:no\.?|ending))?|a\/c)\s*[:#-]?\s*\**x*([0-9]{1,4})\b/i)
  return match?.[1] ?? null
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
  return { date: receivedAt.slice(0, 10), explicit: false }
}

function description(message: string, sender?: string | null): { value: string; merchant: boolean } {
  const match = message.match(/\b(?:UPI\s+to|at|to)\s+([A-Z0-9][A-Z0-9 .&'_-]{1,40}?)(?=\s+(?:on|using|via|ref|txn|transaction|avl|available|balance|for)\b|[,.]|$)/i)
  if (match) return { value: match[1].trim().replace(/\s+/g, ' '), merchant: true }
  const cleanSender = sender?.trim().replace(/[^a-z0-9 ]/gi, ' ')
  return { value: cleanSender ? `${cleanSender.replace(/\s+/g, ' ')} transaction` : 'SMS transaction', merchant: false }
}

export function parseSms(message: string, receivedAt: string, sender?: string | null): ParsedSms {
  const date = transactionDate(message, receivedAt)
  if (nonFinancialPattern.test(message)) return { status: 'non_financial', transactionType: null, amountMinor: null, description: null, transactionDate: date.date, accountLast4: extractAccountLast4(message), confidence: 0.98, notes: 'Security, service, or promotional message detected.' }
  const amountMinor = parseAmountMinor(message)
  const refund = /\b(?:refund(?:ed)?|reversed|reversal|credited back)\b/i.test(message)
  const expense = /\b(?:spent|debited|purchase(?:d)?|paid|withdrawn)\b/i.test(message)
  const income = /\b(?:credited|received|deposited|salary credited)\b/i.test(message)
  const matches = [refund, expense, income].filter(Boolean).length
  const type: SmsTransactionType | null = refund ? 'refund' : matches === 1 && expense ? 'expense' : matches === 1 && income ? 'income' : null
  const desc = description(message, sender)
  const notes: string[] = []
  if (type) notes.push(`${type} keyword recognized`); else notes.push(matches > 1 ? 'Conflicting transaction indicators' : 'No supported transaction indicator')
  if (amountMinor) notes.push('INR amount parsed'); else notes.push('No valid positive INR amount')
  notes.push(date.explicit ? 'transaction date parsed from message' : 'received date used')
  if (extractAccountLast4(message)) notes.push('account suffix recognized')
  const confidence = type && amountMinor ? (desc.merchant ? 0.95 : 0.88) : amountMinor || type ? 0.45 : 0.1
  return { status: type && amountMinor ? 'parsed' : amountMinor || type ? 'needs_review' : 'unparsed', transactionType: type, amountMinor, description: type && amountMinor ? desc.value : null, transactionDate: date.date, accountLast4: extractAccountLast4(message), confidence, notes: notes.join('; ') + '.' }
}
