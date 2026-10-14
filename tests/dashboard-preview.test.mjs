import test from 'node:test'
import assert from 'node:assert/strict'
import { monthlyAllocation, previewBalances, previewMonths, priorityAccounts } from '../.dashboard-preview-test-dist/lib/dashboard-preview.js'
const account = (id, type, balance, isActive = true) => ({ id, name: id, accountType: type, currentBalanceMinor: balance, isActive })
test('current household balances separate bank, cash and debt without offsetting card credits', () => {
  assert.deepEqual(previewBalances([account('bank', 'bank', 10000), account('cash', 'cash', 3000), account('wallet', 'wallet', -1000), account('card', 'credit_card', -5000), account('credit', 'credit_card', 2000), account('inactive', 'bank', 99999, false)]), { bank: 10000, cash: 2000, owed: 5000 })
})
test('investments deducted once, deficits stay signed, zero income has no percentage', () => {
  assert.deepEqual(monthlyAllocation(10000, 4000, 2500), { remaining: 3500, investedPercent: 25 })
  assert.deepEqual(monthlyAllocation(0, 4000, 2500), { remaining: -6500, investedPercent: null })
})
test('pinned accounts first, zero accounts last, inactive excluded, source array unchanged', () => {
  const accounts = [account('zero', 'bank', 0), account('large', 'bank', 10000), account('pin', 'bank', 100), account('debt', 'credit_card', -500), account('inactive', 'bank', 50000, false)]
  assert.deepEqual(priorityAccounts(accounts, ['pin']).map(a => a.id), ['pin', 'large', 'debt', 'zero'])
  assert.equal(accounts[0].id, 'zero')
})
test('trend ends at selected month, crosses years and excludes future activity', () => {
  const result = previewMonths([{ month: '2025-12', incomeMinor: 500, expenseMinor: 100 }, { month: '2026-02', incomeMinor: 999, expenseMinor: 1 }], '2026-01', 3)
  assert.deepEqual(result, [{ month: '2025-11', incomeMinor: 0, expenseMinor: 0 }, { month: '2025-12', incomeMinor: 500, expenseMinor: 100 }, { month: '2026-01', incomeMinor: 0, expenseMinor: 0 }])
})
