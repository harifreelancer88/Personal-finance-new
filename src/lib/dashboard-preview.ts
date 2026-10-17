import type { AccountDto } from '../api/accounts'
import type { CashFlowPoint } from '../api/dashboard'
import type { Investment } from '../types/finance'
import { shiftMonth } from './transaction-month.js'

export function previewBalances(accounts: AccountDto[]) {
  const active = accounts.filter(account => account.isActive)
  return {
    bank: active.filter(a => a.accountType === 'bank').reduce((sum, a) => sum + a.currentBalanceMinor, 0),
    cash: active.filter(a => a.accountType === 'cash' || a.accountType === 'wallet').reduce((sum, a) => sum + a.currentBalanceMinor, 0),
    owed: active.filter(a => a.accountType === 'credit_card').reduce((sum, a) => sum + Math.max(0, -a.currentBalanceMinor), 0),
  }
}

export function priorityAccounts(accounts: AccountDto[], pins: string[]) {
  return accounts.filter(a => a.isActive).sort((a, b) =>
    Number(pins.includes(b.id)) - Number(pins.includes(a.id)) ||
    Math.abs(b.currentBalanceMinor) - Math.abs(a.currentBalanceMinor) || a.name.localeCompare(b.name))
}

export function previewMonths(points: CashFlowPoint[], month: string, count: 3 | 6): CashFlowPoint[] {
  const byMonth = new Map(points.map(point => [point.month, point]))
  return Array.from({ length: count }, (_, i) => {
    const key = shiftMonth(month, i - count + 1)
    return byMonth.get(key) ?? { month: key, incomeMinor: 0, expenseMinor: 0 }
  })
}

export function monthlyAllocation(income: number, spending: number, invested: number) {
  return { remaining: income - spending - invested, investedPercent: income > 0 ? invested / income * 100 : null }
}

// Use /api/net-worth as the authoritative calculation, including investment
// payment reconciliation and card credits. The preview never recomputes it.
export interface RecordedWorth {
  cashMinor: number
  cardCreditMinor: number
  cardDebtMinor: number
  investmentsMinor: number
  netWorthMinor: number
  awaitingIncludedMinor: number
  unverifiedHoldings: number
  awaitingPayrollExcludedMinor: number
  asOf: string
}

export const todayInIndia = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)

export function valuationFreshness(date: string | null | undefined, asOf: string): 'undated' | 'older' | 'dated' {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > asOf) return 'undated'
  // An explicit age label, not a claim that a market quote is current.
  return (Date.parse(asOf) - Date.parse(date)) / 86_400_000 > 90 ? 'older' : 'dated'
}

export function previewValuations(holdings: Investment[], asOf: string) {
  const dated = holdings.map(h => h.valuationDate).filter((date): date is string => valuationFreshness(date, asOf) !== 'undated').sort()
  return {
    undated: holdings.filter(h => valuationFreshness(h.valuationDate, asOf) === 'undated').length,
    older: holdings.filter(h => valuationFreshness(h.valuationDate, asOf) === 'older').length,
    oldest: dated[0] ?? null,
    latest: dated.at(-1) ?? null,
  }
}

export function previewInvestmentGroups(holdings: Investment[]) {
  const groups = new Map<string, { type: string; count: number; valueMinor: number }>()
  for (const holding of holdings) {
    const group = groups.get(holding.type) ?? { type: holding.type, count: 0, valueMinor: 0 }
    group.count++
    group.valueMinor += Math.round(holding.currentValue * 100)
    groups.set(holding.type, group)
  }
  return [...groups.values()].sort((a, b) => b.valueMinor - a.valueMinor || a.type.localeCompare(b.type))
}
