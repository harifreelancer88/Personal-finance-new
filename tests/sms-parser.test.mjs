import assert from 'node:assert/strict'
import test from 'node:test'
import { extractAccountLast4, parseAmountMinor, parseSms } from '../.sms-test-dist/sms-parser.js'
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
test('maps deterministic categories only',()=>{ assert.equal(mappedCategoryName('paid at SWIGGY'),'Food & Dining'); assert.equal(mappedCategoryName('AMAZON purchase'),'Shopping'); assert.equal(mappedCategoryName('INDIAN OIL'),'Transport'); assert.equal(mappedCategoryName('electricity bill'),'Utilities'); assert.equal(mappedCategoryName('UBER'),null) })
