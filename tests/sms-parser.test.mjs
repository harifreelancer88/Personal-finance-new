import assert from 'node:assert/strict'
import test from 'node:test'
import { extractAccountLast4, extractDirectionalAccountSuffixes, parseAmountMinor, parseSms, resolveDirectionalTransaction } from '../.sms-test-dist/sms-parser.js'
import { mappedCategoryName } from '../.sms-test-dist/sms-category.js'

for (const [text, expected] of [['₹650',65000],['₹650.25',65025],['Rs 650',65000],['Rs.650',65000],['INR1,250.50',125050],['INR 1,250.50',125050]]) test(`parses ${text}`,()=>assert.equal(parseAmountMinor(text),expected))
test('rejects zero and malformed amount',()=>{ assert.equal(parseAmountMinor('INR 0'),null); assert.equal(parseAmountMinor('INR 12,50.00'),null) })
test('detects expense',()=>assert.equal(parseSms('INR 650 spent at AMAZON','2026-09-29T16:30:00+05:30').transactionType,'expense'))
test('detects income',()=>assert.equal(parseSms('INR 650 salary credited','2026-09-29T16:30:00+05:30').transactionType,'income'))
test('refund wins over credited wording',()=>assert.equal(parseSms('INR 650 credited back as refund','2026-09-29T16:30:00+05:30').transactionType,'refund'))
test('OTP is non-financial',()=>assert.equal(parseSms('OTP 123456 for purchase INR 650','2026-09-29T16:30:00+05:30').status,'non_financial'))
test('extracts supported account suffixes',()=>{ for(const text of ['ending 2847','xx2847','XXXX2847','card 2847','a/c *2847']) assert.equal(extractAccountLast4(text),'2847') })
test('uses received calendar date as fallback',()=>assert.equal(parseSms('INR 650 paid to UBER','2026-09-29T23:30:00+05:30').transactionDate,'2026-09-29'))
test('parses explicit Indian date',()=>assert.equal(parseSms('INR 650 paid to UBER on 28/09/2026','2026-09-29T23:30:00+05:30').transactionDate,'2026-09-28'))
const icici = 'ICICI Bank Acct XXX981 debited with INR 1.00 on 29-Sep-26. Acct XXX973 credited.UPI:663820638117.Call 18002662 for dispute or SMS BLOCK 981 to 9215676766.'
test('extracts directional account suffixes without unrelated numbers',()=>{
  const parsed = parseSms(icici,'2026-09-30T00:00:00Z','ICICI Bank')
  assert.equal(parsed.sourceAccountLast4,'981')
  assert.equal(parsed.destinationAccountLast4,'973')
  assert.equal(parsed.accountLast4,'981')
  assert.equal(parsed.transactionDate,'2026-09-29')
  assert.equal(parsed.description,'UPI payment')
  assert.equal(parsed.notes.includes('Conflicting'),false)
  assert.deepEqual(extractDirectionalAccountSuffixes(icici),{sourceAccountLast4:'981',destinationAccountLast4:'973'})
})
test('does not treat UPI, phone, or BLOCK numbers as account suffixes',()=>{
  assert.deepEqual(extractDirectionalAccountSuffixes('UPI:663820638117 Call 18002662 or SMS BLOCK 981 to 9215676766'),{sourceAccountLast4:null,destinationAccountLast4:null})
})
for (const [date, expected] of [['29-Sep-26','2026-09-29'],['29-Sep-2026','2026-09-29'],['29 SEP 26','2026-09-29'],['29 SEP 2026','2026-09-29']]) {
  test(`parses named Indian date ${date}`,()=>assert.equal(parseSms(`INR 1 paid on ${date}`,'2025-01-01T00:00:00Z').transactionDate,expected))
}
test('resolves a directional payment with only its source owned as expense',()=>assert.deepEqual(resolveDirectionalTransaction(['source'],[]),{transactionType:'expense',fromAccountId:'source',toAccountId:null}))
test('resolves two different owned directional accounts as one transfer',()=>assert.deepEqual(resolveDirectionalTransaction(['source'],['destination']),{transactionType:'transfer',fromAccountId:'source',toAccountId:'destination'}))
test('resolves a directional payment with only its destination owned as income',()=>assert.deepEqual(resolveDirectionalTransaction([],['destination']),{transactionType:'income',fromAccountId:null,toAccountId:'destination'}))
test('leaves a directional payment unresolved when neither account is owned',()=>assert.deepEqual(resolveDirectionalTransaction([],[]),{transactionType:null,fromAccountId:null,toAccountId:null}))
test('does not guess when either account suffix has ambiguous matches',()=>{
  assert.equal(resolveDirectionalTransaction(['one','two'],[]).transactionType,null)
  assert.equal(resolveDirectionalTransaction(['one'],['two','three']).transactionType,null)
})
test('maps deterministic categories only',()=>{ assert.equal(mappedCategoryName('paid at SWIGGY'),'Food & Dining'); assert.equal(mappedCategoryName('AMAZON purchase'),'Shopping'); assert.equal(mappedCategoryName('INDIAN OIL'),'Transport'); assert.equal(mappedCategoryName('electricity bill'),'Utilities'); assert.equal(mappedCategoryName('UBER'),null) })
