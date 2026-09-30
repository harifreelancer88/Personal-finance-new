import assert from 'node:assert/strict'
import test from 'node:test'
import { extractAccountLast4, extractBankReference, extractDirectionalAccountSuffixes, isFinancialSmsCandidate, parseAmountMinor, parseSms, resolveDirectionalTransaction } from '../.sms-test-dist/sms-parser.js'
import { mappedCategoryName } from '../.sms-test-dist/sms-category.js'

for (const [text, expected] of [['₹650',65000],['₹650.25',65025],['Rs 650',65000],['Rs.650',65000],['INR1,250.50',125050],['INR 1,250.50',125050]]) test(`parses ${text}`,()=>assert.equal(parseAmountMinor(text),expected))
test('rejects zero and malformed amount',()=>{ assert.equal(parseAmountMinor('INR 0'),null); assert.equal(parseAmountMinor('INR 12,50.00'),null) })
test('detects expense',()=>assert.equal(parseSms('INR 650 spent at AMAZON','2026-09-29T16:30:00+05:30').transactionType,'expense'))
test('detects income',()=>assert.equal(parseSms('INR 650 salary credited','2026-09-29T16:30:00+05:30').transactionType,'income'))
test('refund wins over credited wording',()=>assert.equal(parseSms('INR 650 credited back as refund','2026-09-29T16:30:00+05:30').transactionType,'refund'))
test('OTP is non-financial',()=>assert.equal(parseSms('OTP 123456 for purchase INR 650','2026-09-29T16:30:00+05:30').status,'non_financial'))
test('OTP-only and promotional messages fail pre-ingest screening',()=>{
  assert.equal(isFinancialSmsCandidate('Your login OTP is 123456. Do not share it.'),false)
  assert.equal(isFinancialSmsCandidate('Special offer: get 20% off your next purchase of INR 2,000'),false)
})
test('completed bank transaction with dispute and BLOCK advice passes screening',()=>assert.equal(isFinancialSmsCandidate('INR 650 debited from A/c XX2847. Call for dispute or SMS BLOCK 2847.'),true))
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
  assert.equal(parsed.description,'UPI transfer')
  assert.equal(parsed.notes.includes('Conflicting'),false)
  assert.deepEqual(extractDirectionalAccountSuffixes(icici),{sourceAccountLast4:'981',destinationAccountLast4:'973'})
})
const productionPrimary = 'ICICI Bank Acct XXX981 debited with INR 3.00 on 30-Sep-26. Acct XXX973 credited.UPI:663943782683.Call 18002662 for dispute or SMS BLOCK 981 to 9215676766.'
const productionSecondary = 'Dear Customer, Acct XX973 is credited with Rs 3.00 on 30-Sep-26 from HARI BHASKARAN . UPI:663943782683-ICICI Bank.'
test('extracts the same labelled bank reference from both production messages',()=>{
  assert.equal(extractBankReference(productionPrimary),'663943782683')
  assert.equal(extractBankReference(productionSecondary),'663943782683')
})
test('parses the production combined message as an incomplete-capable transfer',()=>{
  const parsed = parseSms(productionPrimary,'2026-09-30T12:00:00Z','ICICI Bank')
  assert.equal(parsed.transactionType,'transfer')
  assert.equal(parsed.status,'parsed')
  assert.equal(parsed.amountMinor,300)
  assert.equal(parsed.description,'UPI transfer')
  assert.equal(parsed.sourceAccountLast4,'981')
  assert.equal(parsed.destinationAccountLast4,'973')
})
test('supports only explicitly labelled UPI reference forms',()=>{
  for (const text of ['UPI:663943782683','UPI Ref:663943782683','UPI Ref No: 663943782683','UPI reference:663943782683']) assert.equal(extractBankReference(text),'663943782683')
  assert.equal(extractBankReference('Call 18002662, account 981, INR 3.00 on 30-Sep-26'),null)
})
test('does not treat UPI, phone, or BLOCK numbers as account suffixes',()=>{
  assert.deepEqual(extractDirectionalAccountSuffixes('UPI:663820638117 Call 18002662 or SMS BLOCK 981 to 9215676766'),{sourceAccountLast4:null,destinationAccountLast4:null})
})
for (const [date, expected] of [['29-Sep-26','2026-09-29'],['29-Sep-2026','2026-09-29'],['29 SEP 26','2026-09-29'],['29 SEP 2026','2026-09-29']]) {
  test(`parses named Indian date ${date}`,()=>assert.equal(parseSms(`INR 1 paid on ${date}`,'2025-01-01T00:00:00Z').transactionDate,expected))
}
const repayment = 'Dear Customer, Payment of INR 2,757.65 has been received on your ICICI Bank Credit Card Account 4xxx0005 on 30-SEP-26.'
test('classifies credit-card repayment as a dated transfer, not income',()=>{
  const parsed = parseSms(repayment,'2026-09-30T12:00:00Z','ICICI')
  assert.equal(parsed.transactionType,'transfer')
  assert.equal(parsed.isCreditCardRepayment,true)
  assert.equal(parsed.accountLast4,'0005')
  assert.equal(parsed.description,'Credit card payment')
  assert.equal(parsed.transactionDate,'2026-09-30')
  assert.notEqual(parsed.transactionType,'income')
})
test('resolves a directional payment with only its source owned as expense',()=>assert.deepEqual(resolveDirectionalTransaction(['source'],[]),{transactionType:'expense',fromAccountId:'source',toAccountId:null}))
test('resolves two different owned directional accounts as one transfer',()=>assert.deepEqual(resolveDirectionalTransaction(['source'],['destination']),{transactionType:'transfer',fromAccountId:'source',toAccountId:'destination'}))
test('resolves a directional payment with only its destination owned as income',()=>assert.deepEqual(resolveDirectionalTransaction([],['destination']),{transactionType:'income',fromAccountId:null,toAccountId:'destination'}))
test('leaves a directional payment unresolved when neither account is owned',()=>assert.deepEqual(resolveDirectionalTransaction([],[]),{transactionType:null,fromAccountId:null,toAccountId:null}))
test('does not guess when either account suffix has ambiguous matches',()=>{
  assert.equal(resolveDirectionalTransaction(['one','two'],[]).transactionType,null)
  assert.equal(resolveDirectionalTransaction(['one'],['two','three']).transactionType,null)
})
test('maps deterministic categories only',()=>{ assert.equal(mappedCategoryName('paid at SWIGGY'),'Food & Dining'); assert.equal(mappedCategoryName('AMAZON purchase'),'Shopping'); assert.equal(mappedCategoryName('INDIAN OIL'),'Transport'); assert.equal(mappedCategoryName('electricity bill'),'Utilities'); assert.equal(mappedCategoryName('UBER'),null) })
