import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handleApiRequest } from '../.investment-ledger-test-dist/api.mjs'
function setup() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of [
    '0001_initial_schema.sql',
    '0002_allow_short_last4.sql',
    '0003_sms_ingestion.sql',
    '0004_sms_bank_reference.sql','0005_income_accounting_date.sql','0006_category_rules.sql','0007_payroll.sql','0008_ai_categories.sql','0009_ai_audit_details.sql','0010_nps_statements.sql',
  ])
    sqlite.exec(readFileSync('migrations/' + file, 'utf8'))
  sqlite.exec(readFileSync('migrations/0011_investment_ledger.sql','utf8'))
  sqlite.exec(
    "INSERT INTO workspaces(id,name) VALUES ('one','Home'),('two','Other')",
  )
  const db = {
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const values = []
        for (const stmt of statements) values.push(await stmt.run())
        sqlite.exec('COMMIT')
        return values
      } catch (e) {
        sqlite.exec('ROLLBACK')
        throw e
      }
    },
    prepare(sql) {
      let values = []
      const stmt = sqlite.prepare(sql)
      return {
        bind(...v) {
          values = v
          return this
        },
        async first() {
          return stmt.get(...values) ?? null
        },
        async all() {
          return { results: stmt.all(...values) }
        },
        async run() {
          return { meta: { changes: Number(stmt.run(...values).changes) } }
        },
      }
    },
  }
  const env = {
    DB: db,
    DEFAULT_WORKSPACE_ID: 'one',
    SMS_INGEST_TOKEN: 'synthetic-secret-never-returned',
  }
  async function api(path, method = 'GET', data, workspace = 'one') {
    const response = await handleApiRequest(
      new Request('https://test.local/api' + path, {
        method,
        ...(data === undefined
          ? {}
          : {
              body: JSON.stringify(data),
              headers: { 'Content-Type': 'application/json' },
            }),
      }),
      { ...env, DEFAULT_WORKSPACE_ID: workspace },
    )
    return { status: response.status, ...(await response.json()) }
  }
  return { api, sqlite }
}
const valuation={investmentType:'other',name:'GRT',institution:'GRT',investedMinor:27000000,currentValueMinor:27000000,valuationDate:'2026-09-30',basisKind:'actual_cost'}
async function fixture(){const s=setup();s.sqlite.exec("INSERT INTO accounts(id,workspace_id,name,institution,account_type,opening_balance_minor) VALUES ('bank','one','Bank','Bank','bank',10000000),('foreign-bank','two','Other','Bank','bank',999),('card','one','Card','Bank','credit_card',-10000),('credit','one','Credit','Bank','credit_card',2500)");const h=(await s.api('/investments','POST',valuation)).data;return {...s,id:h.id,h}}
const fresh=async s=>(await s.api('/investments/'+s.id)).data
const ledger=async s=>(await s.api('/investments/'+s.id+'/payments')).data
const newPayment=(s,version=0,extra={})=>s.api('/investments/'+s.id+'/payments','POST',{requestId:'ledger-aaaaaaaaaa-123456789',accountId:'bank',paymentDate:'2026-10-01',amountMinor:3000000,description:'GRT October',includedInValue:false,expectedVersion:version,...extra})
test('new payment changes bank and investment together, preserves net worth, excludes spending, retry does not duplicate',async()=>{
 const s=await fixture(),before=(await s.api('/net-worth')).data
 assert.equal((await newPayment(s)).status,201)
 const after=(await s.api('/net-worth')).data
 assert.equal(after.cashMinor,before.cashMinor-3000000);assert.equal(after.investmentsMinor,before.investmentsMinor+3000000);assert.equal(after.netWorthMinor,before.netWorthMinor);assert.equal(after.awaitingIncludedMinor,3000000)
 assert.equal(after.cardCreditMinor,2500);assert.equal(after.cardDebtMinor,10000)
 assert.equal((await fresh(s)).investedMinor,30000000)
 assert.equal((await newPayment(s)).status,200)
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,1)
 const summary=(await s.api('/dashboard/summary')).data
 assert.equal(summary.monthlyExpenseMinor,0);assert.equal(summary.monthlyIncomeMinor,0)
})
test('confirmation and statement absorption do not add contributions twice; history persists',async()=>{
 const s=await fixture();await newPayment(s);let d=await ledger(s);const payment=d.payments[0]
 assert.equal((await s.api(`/investments/${s.id}/payments/${payment.id}`,'PATCH',{expectedVersion:d.ledgerVersion,creditDate:'2026-10-02',reference:'Receipt 001'})).status,200)
 assert.equal((await fresh(s)).currentValueMinor,30000000)
 d=await ledger(s)
 const payload={valuationDate:'2026-10-03',investedMinor:30000000,valueMinor:30001000,source:'Statement 03 October',coveredPaymentIds:[payment.id],expectedVersion:d.ledgerVersion}
 assert.equal((await s.api(`/investments/${s.id}/valuations`,'POST',payload)).status,201)
 const h=await fresh(s);assert.equal(h.currentValueMinor,30001000);assert.equal(h.additionalContributionMinor,0);assert.equal(h.pendingContributionMinor,0)
 assert.equal((await s.api(`/investments/${s.id}/valuations`,'POST',payload)).status,409)
 assert.equal((await s.api(`/investments/${s.id}/valuations`)).data.length,2)
 assert.throws(()=>s.sqlite.exec("DELETE FROM investment_valuations"),/append-only/)
})
test('existing historical payment can be matched without changing amounts or cash; cannot link to two holdings',async()=>{
 const s=await fixture();s.sqlite.exec("INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,from_account_id,transaction_date,status) VALUES ('old','one','investment','September GRT',3000000,'bank','2026-09-20','confirmed')")
 const before=(await s.api('/net-worth')).data
 const body={transactionId:'old',includedInValue:true,reference:'September receipt',expectedVersion:0}
 assert.equal((await s.api(`/investments/${s.id}/payments`,'POST',body)).status,201)
 assert.deepEqual((await s.api('/net-worth')).data,before)
 assert.equal((await s.api(`/investments/${s.id}/payments`,'POST',body)).status,200)
 const other=(await s.api('/investments','POST',{...valuation,name:'Other'})).data
 assert.equal((await s.api(`/investments/${other.id}/payments`,'POST',body)).status,400)
})
test('stale requests, foreign accounts, future dates and missing inclusion decisions leave no partial writes',async()=>{
 const s=await fixture()
 for(const extra of [{expectedVersion:99},{accountId:'foreign-bank'},{paymentDate:'2099-01-01'},{includedInValue:undefined},{amountMinor:1.2},{amountMinor:-1}]){
  const r=await newPayment(s,0,extra);assert.ok(r.status>=400,JSON.stringify(r));assert.equal(s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,0);assert.equal((await fresh(s)).currentValueMinor,27000000)
 }
 assert.equal((await s.api(`/investments/${s.id}/payments`,'GET',undefined,'two')).status,404)
 assert.equal((await s.api(`/investments/${s.id}/valuations`,'POST',{valuationDate:'2026-09-29',investedMinor:1,valueMinor:1,source:'Old',coveredPaymentIds:[],expectedVersion:0})).status,400)
})
test('protected linked cash records cannot change underneath reconciliation; unlink keeps original transaction',async()=>{
 const s=await fixture();await newPayment(s);const d=await ledger(s),p=d.payments[0]
 for(const sql of ["UPDATE transactions SET amount_minor=2","UPDATE transactions SET status='ignored'","DELETE FROM transactions"]){assert.throws(()=>s.sqlite.exec(sql))}
 assert.equal((await s.api(`/investments/${s.id}/payments/${p.id}`,'DELETE')).status,200)
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,1)
 assert.equal((await fresh(s)).currentValueMinor,27000000)
})
test('a statement can exclude an earlier awaiting payment and keep its value separate; unrelated edits cannot overwrite totals',async()=>{
 const s=await fixture();await newPayment(s);const d=await ledger(s)
 assert.equal((await s.api(`/investments/${s.id}/valuations`,'POST',{valuationDate:'2026-10-03',investedMinor:30000000,valueMinor:30000000,source:'Statement',coveredPaymentIds:[],expectedVersion:d.ledgerVersion})).status,201)
 assert.equal((await fresh(s)).currentValueMinor,33000000)
 assert.equal((await s.api(`/investments/${s.id}`,'PATCH',{currentValueMinor:33000000})).status,409)
 assert.equal((await s.api(`/investments/${s.id}`,'DELETE')).status,409)
 assert.equal((await s.api(`/investments/${s.id}`,'PATCH',{notes:'Receipt kept'})).status,200)
 assert.equal((await fresh(s)).currentValueMinor,33000000)
})
test('opening valuation and unknown basis round trip separately from actual cost; migration preserves amounts',async()=>{
 const s=await fixture();for(const basisKind of ['opening_valuation','unknown','actual_cost']){const r=await s.api(`/investments/${s.id}`,'PATCH',{basisKind});assert.equal(r.data.basisKind,basisKind);assert.equal(r.data.currentValueMinor,27000000)}
 assert.equal((await s.api(`/investments/${s.id}`,'PATCH',{basisKind:'made_up'})).status,400)
 assert.equal((await s.api(`/investments/${s.id}`,'PATCH',{valuationDate:'2099-01-01'})).status,400)
})
test('retirement holdings retain specialised reconciliation and net-worth does not invent historical values',async()=>{
 const s=await fixture();for(const investmentType of ['epf','nps']){const i=(await s.api('/investments','POST',{...valuation,investmentType})).data;const r=await s.api(`/investments/${i.id}/payments`,'POST',{requestId:'ledger-retirement123',accountId:'bank',paymentDate:'2026-10-01',amountMinor:100,description:'Retirement',includedInValue:false,expectedVersion:0});assert.ok(r.status>=400)}
 const worth=(await s.api('/net-worth')).data;assert.equal(worth.unverifiedHoldings,0)
})
test('migration preserves live balances, classifies explicit gold baseline and retains existing dated NPS evidence',()=>{
 const db=new DatabaseSync(':memory:')
 for(const file of ['0001_initial_schema.sql','0002_allow_short_last4.sql','0003_sms_ingestion.sql','0004_sms_bank_reference.sql','0005_income_accounting_date.sql','0006_category_rules.sql','0007_payroll.sql','0008_ai_categories.sql','0009_ai_audit_details.sql','0010_nps_statements.sql'])db.exec(readFileSync('migrations/'+file,'utf8'))
 db.exec("INSERT INTO workspaces(id,name) VALUES('one','Home'); INSERT INTO investments(id,workspace_id,investment_type,name,institution,invested_minor,current_value_minor,notes) VALUES('gold','one','gold','Physical','Physical',50000000,50000000,'OPENING VALUATION BASELINE'),('nps','one','nps','NPS','NPS',100000,120000,NULL)")
 db.prepare("INSERT INTO nps_statements(id,investment_id,workspace_id,account_hash,content_hash,statement_date,data_json) VALUES('statement','nps','one','hash','content','2026-09-04',?)").run(JSON.stringify({contributedMinor:100000,valueMinor:120000}))
 const before=db.prepare('SELECT id,invested_minor,current_value_minor FROM investments ORDER BY id').all()
 db.exec(readFileSync('migrations/0011_investment_ledger.sql','utf8'))
 assert.deepEqual(db.prepare('SELECT id,invested_minor,current_value_minor FROM investments ORDER BY id').all(),before)
 assert.equal(db.prepare("SELECT basis_kind FROM investments WHERE id='gold'").get().basis_kind,'opening_valuation')
 assert.equal(db.prepare("SELECT valuation_date FROM investments WHERE id='nps'").get().valuation_date,'2026-09-04')
 assert.equal(db.prepare('SELECT value_minor FROM investment_valuations').get().value_minor,120000)
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
})
