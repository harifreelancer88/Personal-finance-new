import type { Account } from '../types/finance'

export const accountMinor = (account: Account) => Math.round(account.balance * 100)
export function accountOverview(accounts: Account[]) {
  const active = accounts.filter(account => account.status !== 'Inactive')
  const positiveMinor = active.reduce((sum, account) => sum + Math.max(0, accountMinor(account)), 0)
  const owedMinor = active.reduce((sum, account) => sum + Math.max(0, -accountMinor(account)), 0)
  const cashBankMinor = active.filter(account => account.type !== 'Credit Card').reduce((sum, account) => sum + accountMinor(account), 0)
  const cardDuesMinor = active.filter(account => account.type === 'Credit Card').reduce((sum, account) => sum + Math.max(0, -accountMinor(account)), 0)
  return { active, positiveMinor, owedMinor, netMinor: positiveMinor - owedMinor, cashBankMinor, cardDuesMinor }
}
export function displayAccountBalance(account: Account) {
  if (account.type === 'Credit Card' && account.balance <= 0) return { minor: -accountMinor(account), label: 'Amount owed' }
  return { minor: accountMinor(account), label: account.type === 'Credit Card' ? 'Credit balance' : 'Recorded balance' }
}
