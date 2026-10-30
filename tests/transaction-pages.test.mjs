import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { getTransactionPage, listTransactions } from '../.transaction-page-test-dist/repositories/transactions.js'
import { calculateDashboard } from '../.transaction-page-test-dist/lib/dashboard-calculations.js'

function fixture() {
  const sql = new DatabaseSync(':memory:')
  for (const file of ['0001_initial_schema.sql','0002_allow_short_last4.sql','0003_sms_ingestion.sql','0004_sms_bank_reference.sql','0005_income_accounting_date.sql','0006_category_rules.sql','0007_payroll.sql','0008_ai_categories.sql','0009_ai_audit_details.sql','0010_nps_statements.sql','0011_investment_ledger.sql','0012_finance_workflows.sql']) sql.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'))
  sql.exec(readFileSync(new URL('../bootstrap.sql',import.meta.url),'utf8'))
  sql.exec(`INSERT INTO workspaces(id,name) VALUES ('other','Other');
    INSERT INTO accounts(id,workspace_id,name,institution,account_type) VALUES ('bank','development-workspace','Family Bank','Bank','bank'),('wallet','development-workspace','Meal Wallet','Wallet','wallet'),('other-bank','other','Other Bank','Bank','bank');`)
  const insert = sql.prepare(`INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,category_id,from_account_id,to_account_id,transaction_date,status,source,original_transaction_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  const add = (id,type,amount,options={}) => insert.run(id,options.workspace??'development-workspace',type,options.description??id,amount,options.category??null,options.from??null,options.to??null,options.date??'2026-09-30',options.status??'confirmed',options.source??'manual',options.original??null)
  for(let i=0;i<130;i++) add(`expense-${String(i).padStart(3,'0')}`,'expense',101,{from:'bank',category:'cat-groceries',description:i===0?'100% groceries':`Grocery ${i}`})
  add('salary','income',100000,{to:'bank',category:'cat-salary'})
  add('refund-category','refund',250,{to:'bank',category:'cat-groceries'})
  add('refund-linked','refund',100,{to:'bank',original:'expense-000'})
  add('refund-unknown','refund',50000,{to:'bank'})
  add('invest','investment',30000,{from:'bank',category:'cat-investment'})
  add('transfer','transfer',10000,{from:'bank',to:'wallet'})
  add('pending','expense',900000,{status:'pending',source:'sms'})
  add('ignored','expense',900000,{status:'ignored',source:'sms'})
  add('other-record','income',999999,{workspace:'other',to:'other-bank'})
  const wrap = statement => ({ bind(...values) { return { all:async()=>({results:statement.all(...values)}), values, statement } }, all:async()=>({results:statement.all()}) })
  const db = { prepare:text=>wrap(sql.prepare(text)), batch:async statements=>statements.map(({statement,values})=>({results:statement.all(...values)})) }
  return {sql,db}
}
const defaults={limit:25,offset:0}
test('pagination and full-result totals agree with Dashboard past 100 records',async()=>{
  const {sql,db}=fixture()
  try {
    const first=await getTransactionPage(db,'development-workspace',defaults)
    assert.equal(first.total,138); assert.equal(first.items.length,25)
    assert.deepEqual(first.summary,{incomeMinor:100000,investedMinor:30000,expenseMinor:12780,netCashFlowMinor:87220,confirmedCount:136})
    const end=await getTransactionPage(db,'development-workspace',{...defaults,offset:125})
    assert.equal(end.items.length,13);assert.deepEqual(end.summary,first.summary)
    const pages=[];for(let offset=0;offset<first.total;offset+=25)pages.push(...(await getTransactionPage(db,'development-workspace',{...defaults,offset})).items)
    assert.equal(new Set(pages.map(t=>t.id)).size,138)
    const all=sql.prepare(`SELECT t.*, original.transaction_type AS original_transaction_type, c.kind AS category_kind FROM transactions t LEFT JOIN transactions original ON original.id=t.original_transaction_id LEFT JOIN categories c ON c.id=t.category_id WHERE t.workspace_id=?`).all('development-workspace')
    const dashboard=calculateDashboard([],all,new Date('2026-09-30T12:00:00Z'))
    assert.equal(first.summary.incomeMinor,dashboard.monthlyIncomeMinor);assert.equal(first.summary.expenseMinor,dashboard.monthlyExpenseMinor)
  }finally{sql.close()}
})
test('server filters search every page using exact account and category IDs',async()=>{
  const {sql,db}=fixture()
  try {
    const grocery=await getTransactionPage(db,'development-workspace',{...defaults,search:'Groceries',categoryId:'cat-groceries'})
    assert.equal(grocery.total,131);assert.equal(grocery.summary.expenseMinor,12880)
    const wallet=await getTransactionPage(db,'development-workspace',{...defaults,accountId:'wallet'})
    assert.equal(wallet.total,1);assert.equal(wallet.summary.expenseMinor,0)
    const names=await getTransactionPage(db,'development-workspace',{...defaults,search:'Family Bank'})
    assert.equal(names.total,136)
    const literal=await getTransactionPage(db,'development-workspace',{...defaults,search:'100%'})
    assert.equal(literal.total,1)
    const pending=await getTransactionPage(db,'development-workspace',{...defaults,source:'sms',status:'pending'})
    assert.equal(pending.total,1);assert.equal(pending.summary.expenseMinor,0)
    const none=await getTransactionPage(db,'development-workspace',{...defaults,fromDate:'2026-10-01'})
    assert.equal(none.total,0);assert.equal(none.summary.incomeMinor,0)
    const legacy=await listTransactions(db,'development-workspace',{limit:100,offset:0})
    assert.equal(legacy.length,100);assert.ok(!legacy.some(t=>t.workspace_id==='other'))
  }finally{sql.close()}
})
test('refund-only filter cannot produce negative spending or positive income',async()=>{
  const {sql,db}=fixture()
  try {
    const result=await getTransactionPage(db,'development-workspace',{...defaults,type:'refund'})
    assert.equal(result.total,3);assert.equal(result.summary.incomeMinor,0);assert.equal(result.summary.expenseMinor,0)
  }finally{sql.close()}
})

test('September salary recognised in October is filtered, ordered and totalled once by accounting date',async()=>{
 const {sql,db}=fixture()
 try {
  sql.prepare("UPDATE transactions SET transaction_date='2026-09-29',accounting_date='2026-10-01' WHERE id='salary'").run()
  const sep=await getTransactionPage(db,'development-workspace',{...defaults,fromDate:'2026-09-01',toDate:'2026-09-30'})
  const oct=await getTransactionPage(db,'development-workspace',{...defaults,fromDate:'2026-10-01',toDate:'2026-10-31'})
  assert.equal(sep.summary.incomeMinor,0);assert.equal(oct.summary.incomeMinor,100000)
  assert.equal(oct.total,1);assert.equal(oct.items[0].transaction_date,'2026-09-29')
  assert.equal(oct.items[0].accounting_date,'2026-10-01')
  sql.prepare("UPDATE transactions SET accounting_date=NULL WHERE id='salary'").run()
  assert.equal((await getTransactionPage(db,'development-workspace',{...defaults,fromDate:'2026-10-01',toDate:'2026-10-31'})).total,0)
 }finally{sql.close()}
})


test('monthly invested total excludes pending, ignored, other months and other workspaces',async()=>{
  const {sql,db}=fixture()
  try {
    const insert=sql.prepare(`INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,from_account_id,transaction_date,status,source) VALUES (?,?,'investment',?,?,? ,?,?,'manual')`)
    for(const [id,workspace,amount,account,date,status] of [
      ['epf','development-workspace',1011300,'bank','2026-10-01','confirmed'],
      ['nps','development-workspace',1179900,'bank','2026-10-01','confirmed'],
      ['pending-investment','development-workspace',50000,'bank','2026-10-02','pending'],
      ['ignored-investment','development-workspace',50000,'bank','2026-10-02','ignored'],
      ['other-investment','other',999999,'other-bank','2026-10-01','confirmed']
    ]) insert.run(id,workspace,id,amount,account,date,status)
    const bounds={fromDate:'2026-10-01',toDate:'2026-10-31'}
    const first=await getTransactionPage(db,'development-workspace',{...defaults,...bounds,limit:1})
    const next=await getTransactionPage(db,'development-workspace',{...defaults,...bounds,limit:1,offset:1})
    assert.equal(first.summary.investedMinor,2191200)
    assert.equal(next.summary.investedMinor,2191200)
    assert.equal(first.summary.incomeMinor,0)
    assert.equal(first.summary.expenseMinor,0)
    const september=await getTransactionPage(db,'development-workspace',{...defaults,fromDate:'2026-09-01',toDate:'2026-09-30'})
    assert.equal(september.summary.investedMinor,30000)
  }finally{sql.close()}
})

test('optional shadcn amount sorting covers the entire result and preserves aggregate totals',async()=>{
 const {sql,db}=fixture()
 try{
  const options={...defaults,status:'confirmed',sortBy:'amount',sortOrder:'asc'}
  const ascending=await getTransactionPage(db,'development-workspace',options)
  const descending=await getTransactionPage(db,'development-workspace',{...options,sortOrder:'desc'})
  assert.equal(ascending.items[0].id,'refund-linked')
  assert.equal(descending.items[0].id,'salary')
  assert.deepEqual(ascending.summary,descending.summary)
  const end=await getTransactionPage(db,'development-workspace',{...options,offset:125})
  const ordered=[...ascending.items,...end.items].map(t=>t.amount_minor)
  assert.ok(ordered.every((amount,i)=>i===0||amount>=ordered[i-1]))
  assert.equal(ascending.items.some(t=>t.workspace_id==='other'),false)
 }finally{sql.close()}
})
test('description and accounting-date sorting are stable across pages without changing default order',async()=>{
 const {sql,db}=fixture()
 try{
  sql.prepare("UPDATE transactions SET accounting_date='2026-10-01' WHERE id='salary'").run()
  const date=await getTransactionPage(db,'development-workspace',{...defaults,status:'confirmed',sortBy:'date',sortOrder:'desc'})
  assert.equal(date.items[0].id,'salary')
  const first=await getTransactionPage(db,'development-workspace',{...defaults,sortBy:'description',sortOrder:'asc'})
  const second=await getTransactionPage(db,'development-workspace',{...defaults,sortBy:'description',sortOrder:'asc',offset:25})
  assert.equal(new Set([...first.items,...second.items].map(t=>t.id)).size,50)
  const old=await getTransactionPage(db,'development-workspace',defaults)
  const invalid=await getTransactionPage(db,'development-workspace',{...defaults,sortBy:'not_a_column'})
  assert.deepEqual(old.items.map(t=>t.id),invalid.items.map(t=>t.id))
 }finally{sql.close()}
})
