import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { ingestSms } from '../.sms-ingestion-test-dist/ingestion.mjs'

function setup() {
  const db = new DatabaseSync(':memory:')
  for (const file of ['0001_initial_schema.sql','0002_allow_short_last4.sql']) db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
  db.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'))
  for (const file of ['0003_sms_ingestion.sql','0004_sms_bank_reference.sql','0005_income_accounting_date.sql','0006_category_rules.sql']) db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
  db.exec(`INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES
    ('source','development-workspace','Source','ICICI','bank','981'),
    ('destination','development-workspace','Destination','ICICI','bank','973'),
    ('card','development-workspace','Card','ICICI','credit_card','0005');`)
  const adapter = {prepare(sql) {let args=[];return {bind(...values){args=values;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const info=db.prepare(sql).run(...args);return {meta:{changes:Number(info.changes)}}}}}}
  const env={DB:adapter,DEFAULT_WORKSPACE_ID:'development-workspace',SMS_INGEST_TOKEN:'local-test-only'}
  const send=async(message,externalId,receivedAt='2026-10-12T15:00:00Z')=>{
    const response=await ingestSms(new Request('https://test.invalid/api/ingest/sms',{method:'POST',headers:{Authorization:'Bearer local-test-only','Content-Type':'application/json'},body:JSON.stringify({message,externalId,receivedAt,sender:'ICICI'})}),env)
    assert.ok(response.ok);return (await response.json()).data
  }
  return {db,send}
}
const debit='ICICI Bank Acct XX981 debited for Rs 30.00 on 12-Oct-26; METRO TRANSIT credited. UPI:123456789012. Call 18002662 for dispute.'
const primary='ICICI Bank Acct XXX981 debited with INR 1.10 on 12-Oct-26. Acct XXX973 credited.UPI:987654321012.'
const secondary='Dear Customer, Acct XX973 is credited with Rs 1.10 on 12-Oct-26 from OTHER PERSON. UPI:987654321012-ICICI Bank.'

test('merchant expense is confirmed and repeated direct/Sheets delivery creates one transaction',async()=>{
  const {db,send}=setup()
  const first=await send(debit,'direct')
  const second=await send(debit,'sheets','2026-10-12T20:30:00')
  const retry=await send(debit,'sheets','2026-10-12T20:30:00')
  assert.equal(first.transactionId,second.transactionId);assert.equal(second.transactionId,retry.transactionId)
  const rows=db.prepare('SELECT * FROM transactions').all();assert.equal(rows.length,1)
  assert.equal(rows[0].status,'confirmed');assert.equal(rows[0].transaction_type,'expense');assert.equal(rows[0].from_account_id,'source');assert.equal(rows[0].amount_minor,3000)
  assert.equal(db.prepare('SELECT count(*) AS n FROM sms_messages').get().n,2)
})
test('credit arriving first is reconciled from automatic income into one confirmed transfer',async()=>{
  const {db,send}=setup()
  const first=await send(secondary,'credit');const next=await send(primary,'debit')
  assert.equal(first.transactionId,next.transactionId)
  const rows=db.prepare('SELECT * FROM transactions').all();assert.equal(rows.length,1)
  assert.equal(rows[0].transaction_type,'transfer');assert.equal(rows[0].status,'confirmed')
  assert.equal(rows[0].from_account_id,'source');assert.equal(rows[0].to_account_id,'destination')
})
test('transfer first followed by credit remains one confirmed transfer',async()=>{
  const {db,send}=setup();await send(primary,'debit');await send(secondary,'credit')
  const rows=db.prepare('SELECT * FROM transactions').all();assert.equal(rows.length,1);assert.equal(rows[0].transaction_type,'transfer');assert.equal(rows[0].status,'confirmed')
})
test('human-reviewed income is not automatically rewritten by a later transfer alert',async()=>{
  const {db,send}=setup();await send(secondary,'credit')
  db.exec("UPDATE transactions SET notes=NULL")
  const next=await send(primary,'debit');assert.equal(next.parseStatus,'pairing_conflict')
  assert.equal(db.prepare('SELECT transaction_type FROM transactions').get().transaction_type,'income')
  assert.equal(db.prepare('SELECT count(*) AS n FROM transactions').get().n,1)
})
test('ambiguous account and incomplete card repayment remain pending',async()=>{
  const {db,send}=setup();db.exec("INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES('duplicate','development-workspace','Duplicate','ICICI','bank','981')")
  await send(debit,'debit')
  const expense=db.prepare("SELECT * FROM transactions WHERE transaction_type='expense'").get();assert.equal(expense.status,'pending');assert.equal(expense.from_account_id,null)
  await send('Payment of INR 50 has been received on your ICICI Bank Credit Card Account 4xxx0005 on 12-Oct-26.','card')
  const repayment=db.prepare("SELECT * FROM transactions WHERE transaction_type='transfer'").get();assert.equal(repayment.status,'pending');assert.equal(repayment.to_account_id,'card');assert.equal(repayment.from_account_id,null)
})
test('replaying previously unparsed SMS recovers the transaction without duplicating raw rows',async()=>{
  const {db,send}=setup();const ambiguous=debit.replace('XX981','XX999')
  const first=await send(ambiguous,'replay')
  db.exec("DELETE FROM transactions; UPDATE sms_messages SET transaction_id=NULL,parse_status='needs_review'")
  // Simulate a legacy parser record whose text was already correctly stored.
  db.prepare('UPDATE sms_messages SET raw_text=?').run(debit)
  const recovered=await send(debit,'replay')
  assert.ok(recovered.transactionId);assert.equal(first.smsMessageId,recovered.smsMessageId)
  assert.equal(db.prepare('SELECT count(*) AS n FROM sms_messages').get().n,1)
  assert.equal(db.prepare('SELECT status FROM transactions').get().status,'confirmed')
})
test('external-ID collision cannot replace stored SMS content',async()=>{
  const {db,send}=setup();const first=await send('Rs 30 debited and credited; investigate','collision')
  const second=await send(debit,'collision')
  assert.equal(second.smsMessageId,first.smsMessageId);assert.equal(second.transactionId,null)
  assert.equal(db.prepare('SELECT count(*) AS n FROM transactions').get().n,0)
})
test('same-account transfer stays unresolved without violating database constraints',async()=>{
  const {db,send}=setup();const response=await send(primary.replace('XXX973','XXX981'),'same')
  assert.equal(response.parseStatus,'needs_review');assert.equal(db.prepare('SELECT count(*) AS n FROM transactions').get().n,0)
})
test('controlled recovery is linked to SMS without creating a second expense',async()=>{
  const {db,send}=setup()
  db.prepare(`INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,from_account_id,transaction_date,source,status,notes)
    VALUES('recovered','development-workspace','expense','METRO TRANSIT',3000,'source','2026-10-12','manual','confirmed',?)`)
    .run('Recovered SMS: bankref:123456789012:2026-10-12:3000')
  const result=await send(debit,'sheets')
  assert.equal(result.transactionId,'recovered')
  assert.equal(db.prepare('SELECT count(*) AS n FROM transactions').get().n,1)
  assert.equal(db.prepare('SELECT source FROM transactions').get().source,'sms')
})
