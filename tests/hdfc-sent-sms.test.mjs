import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { extractBankReference, isFinancialSmsCandidate, parseSms } from '../.hdfc-sms-test-dist/sms-parser.js'
import { ingestSms } from '../.hdfc-sms-test-dist/ingestion.mjs'

// All payment details below are synthetic regression fixtures.
function setup() {
  const db = new DatabaseSync(':memory:')
  for (const file of ['0001_initial_schema.sql','0002_allow_short_last4.sql']) db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
  db.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'))
  for (const file of ['0003_sms_ingestion.sql','0004_sms_bank_reference.sql','0005_income_accounting_date.sql','0006_category_rules.sql','0007_payroll.sql','0008_ai_categories.sql']) db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
  const adapter = {prepare(sql) {let args=[];return {bind(...values){args=values;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const info=db.prepare(sql).run(...args);return {meta:{changes:Number(info.changes)}}}}}}
  const env={DB:adapter,DEFAULT_WORKSPACE_ID:'development-workspace',SMS_INGEST_TOKEN:'local-test-only'}
  const send=async(message,externalId,receivedAt,sender)=>{
    const response=await ingestSms(new Request('https://test.invalid/api/ingest/sms',{method:'POST',headers:{Authorization:'Bearer local-test-only','Content-Type':'application/json'},body:JSON.stringify({message,externalId,receivedAt,sender})}),env)
    assert.ok(response.ok);return (await response.json()).data
  }
  return {db,send}
}

const sentHdfc = (amount = '725.50', merchant = 'EXAMPLE MARKET') => `Sent Rs.${amount}\nFrom HDFC Bank A/C *2847\nTo ${merchant}\nOn 12/10/26\nRef 123456789012\nNot You?\nCall 18000000000/SMS BLOCK UPI to 9000000000`
for (const [amount, minor, merchant] of [['725.50',72550,'EXAMPLE MARKET'],['80.00',8000,'LOCAL VEGETABLE AND'],['640.00',64000,'Example Electricity Sup']]) {
  test(`HDFC Sent alert preserves merchant and exact amount ${amount}`, () => {
    const parsed = parseSms(sentHdfc(amount,merchant),'2026-10-13T08:00:00Z','HDFC')
    assert.equal(isFinancialSmsCandidate(sentHdfc(amount,merchant)),true)
    assert.equal(parsed.status,'parsed')
    assert.equal(parsed.transactionType,'expense')
    assert.equal(parsed.amountMinor,minor)
    assert.equal(parsed.description,merchant)
    assert.equal(parsed.accountLast4,'2847')
    assert.equal(parsed.sourceAccountLast4,'2847')
    assert.equal(parsed.destinationAccountLast4,null)
    assert.equal(parsed.transactionDate,'2026-10-12')
    assert.equal(extractBankReference(sentHdfc(amount,merchant)),'123456789012')
  })
}
test('HDFC Sent supports CRLF and four-digit years',()=>{
  const parsed=parseSms(sentHdfc().replace('12/10/26','12/10/2026').replaceAll('\n','\r\n'),'2026-10-13T08:00:00Z')
  assert.equal(parsed.status,'parsed');assert.equal(parsed.transactionDate,'2026-10-12')
})
test('generic sent wording, failed requests and OTPs are not completed HDFC alerts',()=>{
  for(const text of ['Sent Rs.725.50 to a friend','OTP sent for Rs.725.50 payment','Sent Rs.725.50 request failed',sentHdfc().replace('Sent Rs.','Please send Rs.'),sentHdfc().replace('Ref 123456789012','Ref missing')]) {
    assert.equal(isFinancialSmsCandidate(text),false,text)
  }
})
test('short numeric dates validate the calendar and preserve leap days',()=>{
  assert.equal(parseSms('Rs.10 paid on 29/02/24','2026-10-13T00:00:00Z').transactionDate,'2024-02-29')
  assert.equal(parseSms('Rs.10 paid on 31/02/26','2026-10-13T00:00:00Z').transactionDate,'2026-10-13')
})

const hdfcSent='Sent Rs.725.50\nFrom HDFC Bank A/C *2847\nTo EXAMPLE MARKET\nOn 12/10/26\nRef 123456789012\nNot You?\nCall 18000000000/SMS BLOCK UPI to 9000000000'
test('HDFC Sent alert maps its source, uses payment date and reference, and safely retries',async()=>{
  const {db,send}=setup()
  db.exec("INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES ('hdfc','development-workspace','Bank','HDFC','bank','2847')")
  const first=await send(hdfcSent,'direct','2026-10-13T08:00:00Z','HDFC')
  const retry=await send(hdfcSent,'retry','2026-10-13T08:01:00Z','HDFC')
  assert.equal(first.transactionId,retry.transactionId)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n,1)
  const row=db.prepare('SELECT * FROM transactions').get()
  assert.equal(row.status,'confirmed');assert.equal(row.transaction_type,'expense')
  assert.equal(row.from_account_id,'hdfc');assert.equal(row.amount_minor,72550)
  assert.equal(row.description,'EXAMPLE MARKET');assert.equal(row.transaction_date,'2026-10-12')
  assert.equal(db.prepare('SELECT bank_reference FROM sms_messages LIMIT 1').get().bank_reference,'123456789012')
})
test('unmapped or ambiguous HDFC source stays pending rather than guessing an account',async()=>{
  for(const ambiguous of [false,true]) {
    const {db,send}=setup()
    if(ambiguous) db.exec("INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES ('h1','development-workspace','One','HDFC','bank','2847'),('h2','development-workspace','Two','HDFC','bank','2847')")
    await send(hdfcSent,'direct','2026-10-13T08:00:00Z','HDFC')
    const row=db.prepare('SELECT * FROM transactions').get()
    assert.equal(row.status,'pending');assert.equal(row.from_account_id,null)
  }
})
