import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountOverview, displayAccountBalance } from '../.account-overview-test-dist/lib/account-overview.js'
const account = (id, type, balance, status = 'Active') => ({id, type, balance, status, name:id, institution:'Example bank', maskedIdentifier:'•••• 1234', color:'blue'})
test('bank, wallet and card dues produce the recorded net balance', () => {
  const result = accountOverview([account('bank','Bank Account',46100),account('wallet','Wallet / Prepaid',2500),account('card','Credit Card',-6000)])
  assert.equal(result.netMinor,4260000)
  assert.equal(result.cashBankMinor,4860000)
  assert.equal(result.cardDuesMinor,600000)
})
test('overdrafts and card credits remain part of the net balance; inactive balances are excluded', () => {
  const result = accountOverview([account('bank','Bank Account',-125.50),account('credit','Credit Card',70.25),account('dues','Credit Card',-10.10),account('inactive','Bank Account',9999,'Inactive')])
  assert.equal(result.netMinor,-6535)
  assert.equal(result.positiveMinor,7025)
  assert.equal(result.owedMinor,13560)
  assert.equal(result.cardDuesMinor,1010)
  assert.equal(result.active.length,3)
})
test('summing decimal balances preserves paise', () => {
  const result = accountOverview([account('one','Cash',0.10),account('two','Wallet / Prepaid',0.20)])
  assert.equal(result.netMinor,30)
})
test('empty and zero balances return finite zero totals', () => {
  for (const rows of [[],[account('zero','Bank Account',0)]]) {
    const result = accountOverview(rows)
    for(const key of ['positiveMinor','owedMinor','netMinor','cashBankMinor','cardDuesMinor'])assert.equal(result[key],0)
  }
})
test('card overpayments are displayed as credit balances, while negative bank balances keep their sign', () => {
  assert.deepEqual(displayAccountBalance(account('card','Credit Card',70.25)),{minor:7025,label:'Credit balance'})
  assert.deepEqual(displayAccountBalance(account('card','Credit Card',-10.10)),{minor:1010,label:'Amount owed'})
  assert.deepEqual(displayAccountBalance(account('bank','Bank Account',-125.50)),{minor:-12550,label:'Recorded balance'})
})
