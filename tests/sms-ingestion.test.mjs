import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { ingestSms } from '../.sms-ingestion-test-dist/ingestion.mjs'

function setup(beforeReadReturn = async () => {}) {
  const db = new DatabaseSync(':memory:')
  for (const file of ['0001_initial_schema.sql','0002_allow_short_last4.sql']) db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
  db.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'))
  for (const file of ['0003_sms_ingestion.sql','0004_sms_bank_reference.sql','0005_income_accounting_date.sql','0006_category_rules.sql','0007_payroll.sql','0008_ai_categories.sql']) db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
  db.exec(`INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES
    ('source','development-workspace','Source','ICICI','bank','981'),
    ('destination','development-workspace','Destination','ICICI','bank','973'),
    ('card','development-workspace','Card','ICICI','credit_card','0005');`)
  const adapter = {prepare(sql) {let args=[];return {bind(...values){args=values;return this},async first(){const row=db.prepare(sql).get(...args)??null;await beforeReadReturn(sql,args);return row},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const info=db.prepare(sql).run(...args);return {meta:{changes:Number(info.changes)}}}}}}
  const env={DB:adapter,DEFAULT_WORKSPACE_ID:'development-workspace',SMS_INGEST_TOKEN:'local-test-only'}
  const send=async(message,externalId,receivedAt='2026-10-12T15:00:00Z',sender='ICICI')=>{
    const response=await ingestSms(new Request('https://test.invalid/api/ingest/sms',{method:'POST',headers:{Authorization:'Bearer local-test-only','Content-Type':'application/json'},body:JSON.stringify({message,externalId,receivedAt,sender})}),env)
    assert.ok(response.ok);return (await response.json()).data
  }
  return {db,send,env}
}
const debit='ICICI Bank Acct XX981 debited for Rs 30.00 on 12-Oct-26; METRO TRANSIT credited. UPI:123456789012. Call 18002662 for dispute.'
const primary='ICICI Bank Acct XXX981 debited with INR 1.10 on 12-Oct-26. Acct XXX973 credited.UPI:987654321012.'
const secondary='Dear Customer, Acct XX973 is credited with Rs 1.10 on 12-Oct-26 from OTHER PERSON. UPI:987654321012-ICICI Bank.'
const noReference='Rs. 69.00 spent from Pluxee Meal Card wallet, card no.xx8888 on 13-10-2026 13:54:5 at SAMPLE SHOP . Avl bal Rs.900.00. Not you call 18002106919'
function addWallet(db) {db.exec("INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES ('meal','development-workspace','Meal wallet','Pluxee','wallet','8888')")}

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
test('no-reference SMS deduplicates across external-ID and content delivery in either order, UTC and naive IST, including simultaneous delivery',async()=>{
  for (const mode of ['content-first','external-first','simultaneous']) {
    const {db,send}=setup();addWallet(db)
    const content=()=>send(noReference,undefined,'2026-10-13T13:54:09','VD-Pluxee-S')
    const external=()=>send(noReference,'phone-copy','2026-10-13T08:24:09.000Z','VD-Pluxee-S')
    const results=mode==='simultaneous'?await Promise.all([content(),external()]):mode==='content-first'?[await content(),await external()]:[await external(),await content()]
    assert.equal(results[0].transactionId,results[1].transactionId,mode)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n,1)
    assert.equal(db.prepare("SELECT amount_minor FROM transactions").get().amount_minor,6900)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sms_messages').get().n,2)
    const replay=await send(noReference,'new-delivery-id','2026-10-13T13:54:09+05:30','VD-Pluxee-S')
    assert.equal(replay.transactionId,results[0].transactionId)
  }
})
test('separate equal payments, changed SMS contents and different senders remain separate',async()=>{
  const {db,send}=setup();addWallet(db)
  await send(noReference,'one','2026-10-13T08:24:09Z','VD-Pluxee-S')
  await send(noReference,'two','2026-10-13T08:25:09Z','VD-Pluxee-S')
  await send(noReference.replace('900.00','831.00'),'three','2026-10-13T08:24:09Z','VD-Pluxee-S')
  await send(noReference,'four','2026-10-13T08:24:09Z','VM-Pluxee-S')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n,4)
})
test('pre-fix content and external identities are reused without changing a human category or ignored status',async()=>{
  for(const legacy of ['content:legacy-hash','external:legacy-hash']) {
    const {db,send}=setup();addWallet(db)
    const first=await send(noReference,'original','2026-10-13T13:54:09','VD-Pluxee-S')
    db.prepare("UPDATE transactions SET external_id=?,status='ignored',notes='Human decision',category_id='cat-groceries' WHERE id=?").run(legacy,first.transactionId)
    const next=await send(noReference,'other-route','2026-10-13T08:24:09Z','VD-Pluxee-S')
    assert.equal(next.transactionId,first.transactionId);assert.equal(next.duplicate,true)
    const row=db.prepare('SELECT * FROM transactions').get()
    assert.equal(row.status,'ignored');assert.equal(row.notes,'Human decision');assert.equal(row.category_id,'cat-groceries')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n,1)
  }
})
test('content match is workspace scoped even with identical sender, text and receipt instant',async()=>{
  const {db,send,env}=setup();addWallet(db)
  await send(noReference,'one','2026-10-13T08:24:09Z','VD-Pluxee-S')
  db.exec("INSERT INTO workspaces(id,name) VALUES ('other','Other'); INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES ('other-meal','other','Meal wallet','Pluxee','wallet','8888')")
  const response=await ingestSms(new Request('https://test.invalid/api/ingest/sms',{method:'POST',headers:{Authorization:'Bearer local-test-only','Content-Type':'application/json'},body:JSON.stringify({message:noReference,externalId:'one',receivedAt:'2026-10-13T08:24:09Z',sender:'VD-Pluxee-S'})}),{...env,DEFAULT_WORKSPACE_ID:'other'})
  assert.equal(response.status,201)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n,2)
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
test('linking a payslip protects automatic income from later transfer reconciliation',async()=>{
  const {db,send}=setup();const first=await send(secondary,'credit')
  db.prepare("INSERT INTO payroll_records(id,workspace_id,transaction_id,payroll_month,employer,gross_minor,net_minor) VALUES ('payroll','development-workspace',?,'2026-10','Synthetic',110,110)").run(first.transactionId)
  const next=await send(primary,'debit');assert.equal(next.parseStatus,'pairing_conflict')
  assert.equal(db.prepare('SELECT transaction_type FROM transactions').get().transaction_type,'income')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n,1)
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

function simultaneousTransactionLookups() {
  let arrived=0,release
  const barrier=new Promise(resolve=>{release=resolve})
  return async(sql)=>{
    if(!sql.includes("source = 'sms' AND external_id = ?")) return
    if(++arrived===2) release()
    await barrier
  }
}
const cardReference='ICICI Bank Credit Card XX0005 debited for INR 725.50 on 12-Oct-26 for UPI-123456789012-EXAMPLE. To dispute call 18001080.'
const bankWithoutReference='ICICI Bank Acc XX981 debited Rs. 725.50 on 12-Oct-26 InfoBIL*INFT*ABCD.Avl Bal Rs. 12,345.67.To dispute call 18002662.'

test('hyphenated card UPI reference survives changed delivery IDs/times and serializes simultaneous inserts',async()=>{
  for(const simultaneous of [false,true]) {
    const {db,send}=setup(simultaneous?simultaneousTransactionLookups():undefined)
    const one=()=>send(cardReference,'direct','2026-10-12T07:00:00Z','JD-ICICIT-S')
    const two=()=>send(cardReference,'forwarder','2026-10-12T07:00:07Z','JD-ICICIT-S')
    const results=simultaneous?await Promise.all([one(),two()]):[await one(),await two()]
    assert.equal(results[0].transactionId,results[1].transactionId)
    assert.ok(results.some(r=>r.duplicate))
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n,1)
    assert.equal(db.prepare("SELECT SUM(amount_minor) amount FROM transactions WHERE status='confirmed'").get().amount,72550)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sms_messages').get().n,2)
  }
})

test('reference-less identical evidence with different receipt times cannot auto-confirm two expenses, even in a forced race',async()=>{
  for(const simultaneous of [false,true]) {
    const {db,send}=setup(simultaneous?simultaneousTransactionLookups():undefined)
    const one=()=>send(bankWithoutReference,'direct','2026-10-12T07:00:00Z','VA-ICICIT-S')
    const two=()=>send(bankWithoutReference,'forwarder','2026-10-12T07:00:07Z','VA-ICICIT-S')
    const results=simultaneous?await Promise.all([one(),two()]):[await one(),await two()]
    assert.notEqual(results[0].transactionId,results[1].transactionId,'Ambiguous payments must not be silently merged')
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n,2)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM transactions WHERE status='confirmed'").get().n,1)
    assert.equal(db.prepare("SELECT SUM(amount_minor) amount FROM transactions WHERE status='confirmed'").get().amount,72550)
    assert.ok(results.some(r=>r.parseStatus==='needs_review'))
    assert.match(db.prepare("SELECT notes FROM transactions WHERE status='pending'").get().notes,/Possible repeated SMS/)
    const replay=await send(bankWithoutReference,'retry','2026-10-12T07:00:07Z','VA-ICICIT-S')
    assert.ok(replay.duplicate)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n,2)
  }
})

test('distinct references or changed balance evidence preserve legitimate same-date same-amount payments',async()=>{
  const {db,send}=setup()
  await send(cardReference,'card-one')
  await send(cardReference.replace('123456789012','222222222222'),'card-two')
  await send(bankWithoutReference,'bank-one')
  await send(bankWithoutReference.replace('12,345.67','11,620.17'),'bank-two')
  assert.equal(db.prepare("SELECT COUNT(*) n FROM transactions WHERE status='confirmed'").get().n,4)
})

test('a reference reused on a different explicit transaction date is a separate payment',async()=>{
  const {db,send}=setup()
  const first=await send(cardReference,'one','2026-10-12T07:00:00Z')
  const next=await send(cardReference.replace('12-Oct-26','13-Oct-26'),'two','2026-10-13T07:00:00Z')
  assert.notEqual(first.transactionId,next.transactionId)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM transactions WHERE status='confirmed'").get().n,2)
})

test('new reference formats adopt old evidence without rewriting human decisions or inserting a new payment',async()=>{
  const {db,send}=setup()
  const first=await send(cardReference,'legacy','2026-10-12T07:00:00Z','JD-ICICIT-S')
  db.prepare("UPDATE transactions SET external_id='content:legacy',transaction_type='investment',notes='Human classified',category_id='cat-groceries' WHERE id=?").run(first.transactionId)
  db.prepare('UPDATE sms_messages SET bank_reference=NULL WHERE transaction_id=?').run(first.transactionId)
  const replay=await send(cardReference,'new-route','2026-10-12T07:00:09Z','JD-ICICIT-S')
  assert.equal(replay.transactionId,first.transactionId)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n,1)
  const row=db.prepare('SELECT * FROM transactions').get()
  assert.equal(row.transaction_type,'investment');assert.equal(row.notes,'Human classified');assert.equal(row.category_id,'cat-groceries')
})

test('ambiguous legacy repeat is held without touching an earlier payment, and group protection stays workspace scoped',async()=>{
  const {db,send,env}=setup()
  const first=await send(bankWithoutReference,'legacy','2026-10-12T07:00:00Z','VA-ICICIT-S')
  db.prepare("UPDATE transactions SET external_id='content:legacy',notes='Human confirmed' WHERE id=?").run(first.transactionId)
  const next=await send(bankWithoutReference,'new-route','2026-10-12T07:00:09Z','VA-ICICIT-S')
  assert.equal(next.parseStatus,'needs_review')
  assert.equal(db.prepare('SELECT notes FROM transactions WHERE id=?').get(first.transactionId).notes,'Human confirmed')
  db.exec("INSERT INTO workspaces(id,name) VALUES ('other','Other'); INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES ('other-bank','other','Bank','ICICI','bank','981')")
  const response=await ingestSms(new Request('https://test.invalid/api/ingest/sms',{method:'POST',headers:{Authorization:'Bearer local-test-only','Content-Type':'application/json'},body:JSON.stringify({message:bankWithoutReference,sender:'VA-ICICIT-S',externalId:'other',receivedAt:'2026-10-12T07:00:09Z'})}),{...env,DEFAULT_WORKSPACE_ID:'other'})
  assert.ok(response.ok)
  assert.equal(db.prepare("SELECT status FROM transactions WHERE workspace_id='other'").get().status,'confirmed')
})
