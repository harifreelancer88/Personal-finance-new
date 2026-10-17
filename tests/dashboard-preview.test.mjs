import test from 'node:test'
import assert from 'node:assert/strict'
import { monthlyAllocation, previewBalances, previewMonths, priorityAccounts, previewValuations, valuationFreshness, previewInvestmentGroups, todayInIndia } from '../.dashboard-preview-test-dist/lib/dashboard-preview.js'
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

test('valuation dates distinguish invalid, missing, future and explicitly older-than-90-day values', () => {
  const asOf = '2026-10-17'
  for (const date of [null, undefined, '', '2026-02-30', '2026-10-18', 'not-a-date']) assert.equal(valuationFreshness(date, asOf), 'undated')
  assert.equal(valuationFreshness('2026-07-19', asOf), 'dated')
  assert.equal(valuationFreshness('2026-07-18', asOf), 'older')
  assert.deepEqual(previewValuations([{ valuationDate: null }, { valuationDate: '2026-06-30' }, { valuationDate: '2026-09-30' }], asOf), { undated: 1, older: 1, oldest: '2026-06-30', latest: '2026-09-30' })
  assert.deepEqual(previewValuations([], asOf), { undated: 0, older: 0, oldest: null, latest: null })
})

test('investment groups use the API current value exactly once, retaining paise and zero holdings', () => {
  const holdings = [{ type: 'Gold', currentValue: 100.21 }, { type: 'Gold', currentValue: 0.02 }, { type: 'NPS', currentValue: 0 }]
  assert.deepEqual(previewInvestmentGroups(holdings), [{ type: 'Gold', count: 2, valueMinor: 10023 }, { type: 'NPS', count: 1, valueMinor: 0 }])
  assert.equal(holdings[0].currentValue, 100.21)
})

test('preview day uses India midnight independent of the browser timezone', () => {
  assert.equal(todayInIndia(new Date('2026-10-17T18:29:59Z')), '2026-10-17')
  assert.equal(todayInIndia(new Date('2026-10-17T18:30:00Z')), '2026-10-18')
})
