import type { AccountDto } from '../api/accounts'
import type { CashFlowPoint } from '../api/dashboard'
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
