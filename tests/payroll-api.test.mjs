import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handleApiRequest } from '../.payroll-test-dist/api.mjs'
function setup() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of [
    '0001_initial_schema.sql',
    '0002_allow_short_last4.sql',
    '0003_sms_ingestion.sql',
    '0004_sms_bank_reference.sql','0005_income_accounting_date.sql','0006_category_rules.sql','0007_payroll.sql','0008_ai_categories.sql',
  ])
    sqlite.exec(readFileSync('migrations/' + file, 'utf8'))
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
const payslip = {
  payrollMonth:'2026-09', employer:'Synthetic employer', grossMinor:20461000,
  employeePfMinor:1011300,npsMinor:1179900,incomeTaxMinor:2250600,
  professionalTaxMinor:20000,staffSaleMinor:515000,otherMinor:0,
  notes:'September payslip',expectedRevision:0,
}
async function salarySetup() {
  const s=setup()
  s.sqlite.exec("INSERT INTO accounts(id,workspace_id,name,institution,account_type) VALUES ('bank','one','Salary bank','Example','bank'),('other-bank','two','Other','Example','bank')")
  for (const [id,workspace,bank] of [['salary','one','bank'],['salary2','one','bank'],['foreign','two','other-bank']])
    s.sqlite.prepare("INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,to_account_id,transaction_date,accounting_date,status) VALUES (?,?, 'income','Salary',15484200,?,'2026-09-29','2026-10-01','confirmed')").run(id,workspace,bank)
  return s
}
async function save(s,id='salary',input=payslip) {return s.api('/payroll/transactions/'+id,'PUT',input)}
async function record(s,id='salary') {return (await s.api('/payroll/transactions/'+id)).data}
async function credit(s,scheme='epf',id='salary') {return (await record(s,id)).contributions.find(c=>c.scheme===scheme&&c.contributor==='employee')}
async function holding(s,type='epf',workspace='one') {
  return (await s.api('/investments','POST',{investmentType:type,name:type,institution:'Synthetic institution',investedMinor:50000000,currentValueMinor:52000000},workspace)).data.id
}
test('salary reconciles exactly and creates only employee awaiting-credit allocations; bank, dashboard and portfolio are unchanged',async()=>{
  const s=await salarySetup(),h=await holding(s)
  const beforeAccounts=(await s.api('/accounts')).data, beforeSummary=(await s.api('/dashboard/summary')).data, beforeReports=(await s.api('/reports/summary?period=all')).data
  const result=await save(s)
  assert.equal(result.status,201);assert.equal(result.data.netMinor,15484200)
  assert.equal(result.data.payrollMonth,'2026-09');assert.equal(result.data.receivedDate,'2026-09-29');assert.equal(result.data.accountingDate,'2026-10-01')
  assert.deepEqual(result.data.contributions.map(c=>[c.scheme,c.amountMinor,c.creditedDate]),[['epf',1011300,null],['nps',1179900,null]])
  assert.deepEqual((await s.api('/accounts')).data,beforeAccounts)
  assert.deepEqual((await s.api('/dashboard/summary')).data,beforeSummary)
  assert.deepEqual((await s.api('/reports/summary?period=all')).data,beforeReports)
  assert.equal((await s.api('/investments/'+h)).data.currentValueMinor,52000000)
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM investment_activity').get().n,0)
  assert.equal((await s.api('/payroll')).data.length,1)
})
test('unknown, foreign workspace, invalid month, paise, missing fields and non-reconciling totals rejected',async()=>{
  const s=await salarySetup()
  assert.equal((await s.api('/payroll/transactions/foreign')).status,404)
  assert.equal((await save(s,'foreign')).status,404)
  assert.equal((await save(s,'missing')).status,404)
  for(const input of [{payrollMonth:'2026-13'},{payrollMonth:'2026-9'},{grossMinor:20461001},{employeePfMinor:1.2},{npsMinor:-1},{grossMinor:Number.MAX_SAFE_INTEGER+1},{employer:' '},{workspaceId:'two'},{expectedRevision:undefined},{professionalTaxMinor:undefined},{notes:4}])
    assert.equal((await save(s,'salary',{...payslip,...input})).status,400,JSON.stringify(input))
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM payroll_records').get().n,0)
  s.sqlite.exec("UPDATE transactions SET transaction_type='refund',accounting_date=NULL WHERE id='salary'")
  assert.equal((await save(s)).status,400)
})
test('repeat and stale saves cannot duplicate payrolls; paise precision and unmatched deduction updates preserved',async()=>{
  const s=await salarySetup();await save(s)
  assert.equal((await save(s)).status,409)
  assert.equal((await s.api('/payroll', 'GET',undefined,'two')).data.length,0)
  const p=await record(s)
  const result=await save(s,'salary',{...payslip,employeePfMinor:1011301,grossMinor:20461001,expectedRevision:p.revision})
  assert.equal(result.status,200);assert.equal((await credit(s)).amountMinor,1011301)
  assert.equal((await save(s,'salary',{...payslip,expectedRevision:p.revision})).status,409)
  assert.equal((await s.api('/payroll')).data.length,1)
})
test('statement-only confirmation and reset never increment investment value or create activity',async()=>{
  const s=await salarySetup();await save(s);const c=await credit(s), h=await holding(s)
  const match={investmentId:h,activityId:null,creditedDate:'2026-10-11',statementReference:'Synthetic Sep credit',expectedRevision:c.revision}
  assert.equal((await s.api('/payroll/contributions/'+c.id,'PATCH',match)).status,200)
  const next=await credit(s);assert.equal(next.creditedDate,'2026-10-11')
  assert.equal((await s.api('/investments/'+h)).data.currentValueMinor,52000000)
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM investment_activity').get().n,0)
  assert.equal((await s.api('/payroll/contributions/'+c.id,'PATCH',match)).status,409)
  assert.equal((await s.api('/payroll/contributions/'+c.id,'PATCH',{reset:true,expectedRevision:next.revision})).status,200)
  assert.equal((await credit(s)).creditedDate,null)
  assert.equal((await s.api('/investments/'+h)).data.currentValueMinor,52000000)
})
test('activity matching checks amount, type, date, workspace and scheme; evidence cannot be counted twice',async()=>{
  const s=await salarySetup();await save(s);await save(s,'salary2');const c=await credit(s), c2=await credit(s,'epf','salary2')
  const h=await holding(s),wrong=await holding(s,'nps'),foreign=await holding(s,'epf','two')
  const activity=(await s.api('/investments/'+h+'/activity','POST',{activityType:'contribution',activityDate:'2026-10-11',amountMinor:c.amountMinor,description:'Synthetic contribution'})).data.id
  const m={investmentId:h,activityId:activity,creditedDate:'2026-10-11',statementReference:'Synthetic activity reference',expectedRevision:c.revision}
  for(const patch of [{investmentId:wrong},{investmentId:foreign},{creditedDate:'2026-10-12'},{activityId:'missing'},{creditedDate:'2026-02-30'},{statementReference:' '}])
    assert.equal((await s.api('/payroll/contributions/'+c.id,'PATCH',{...m,...patch})).status,400)
  assert.equal((await s.api('/payroll/contributions/'+c.id,'PATCH',m, 'two')).status,404)
  assert.equal((await s.api('/payroll/contributions/'+c.id,'PATCH',m)).status,200)
  assert.equal((await s.api('/payroll/contributions/'+c2.id,'PATCH',{...m,expectedRevision:c2.revision,statementReference:'Different reference'})).status,409)
  assert.equal((await s.api('/payroll/contributions/'+c2.id,'PATCH',{...m,activityId:null,expectedRevision:c2.revision})).status,409)
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM investment_activity').get().n,1)
  await s.api('/payroll/transactions/salary2/employer','POST',{scheme:'epf',amountMinor:c.amountMinor,expectedRevision:(await record(s,'salary2')).revision})
  const employer=(await record(s,'salary2')).contributions.find(c=>c.contributor==='employer')
  assert.equal((await s.api('/payroll/contributions/'+employer.id,'PATCH',{...m,activityId:null,expectedRevision:employer.revision})).status,409)
})
test('employer PF and pension are explicit allocations; pension cannot match an investment or change portfolio',async()=>{
  const s=await salarySetup();await save(s);const h=await holding(s)
  for(const [scheme,amountMinor] of [['epf',886300],['eps',125000]]){
    const p=await record(s)
    const r=await s.api('/payroll/transactions/salary/employer','POST',{scheme,amountMinor,expectedRevision:p.revision})
    assert.equal(r.status,201)
  }
  const p=await record(s),c=p.contributions.find(c=>c.scheme==='eps')
  const m={investmentId:null,activityId:null,creditedDate:'2026-10-11',statementReference:'Synthetic pension Sep',expectedRevision:c.revision}
  assert.equal((await s.api('/payroll/contributions/'+c.id,'PATCH',{...m,investmentId:h})).status,400)
  assert.equal((await s.api('/payroll/contributions/'+c.id,'PATCH',m)).status,200)
  assert.equal((await s.api('/investments/'+h)).data.currentValueMinor,52000000)
  assert.equal((await s.api('/payroll/transactions/salary/employer','POST',{scheme:'epf',amountMinor:1,expectedRevision:(await record(s)).revision})).status,409)
})
test('confirmed deductions and payroll month are protected until match reset; description and accounting dates remain editable',async()=>{
  const s=await salarySetup();await save(s);const h=await holding(s),c=await credit(s)
  await s.api('/payroll/contributions/'+c.id,'PATCH',{investmentId:h,activityId:null,creditedDate:'2026-10-11',statementReference:'Synthetic Sep credit',expectedRevision:c.revision})
  const p=await record(s)
  assert.equal((await save(s,'salary',{...payslip,employeePfMinor:0,grossMinor:payslip.grossMinor-payslip.employeePfMinor,expectedRevision:p.revision})).status,409)
  assert.equal((await save(s,'salary',{...payslip,payrollMonth:'2026-10',expectedRevision:p.revision})).status,409)
  assert.equal((await s.api('/transactions/salary','PATCH',{amountMinor:1})).status,409)
  assert.equal((await s.api('/transactions/salary','PATCH',{transactionType:'refund'})).status,409)
  assert.equal((await s.api('/transactions/salary','DELETE')).status,409)
  assert.equal((await s.api('/payroll/transactions/salary','DELETE',{expectedRevision:p.revision})).status,409)
  assert.equal((await s.api('/transactions/salary','PATCH',{accountingDate:'2026-09-29',description:'Salary updated'})).status,200)
  assert.equal((await record(s)).accountingDate,'2026-09-29')
  assert.equal((await s.api('/investments/'+h,'PATCH',{investmentType:'nps'})).status,409)
  assert.equal((await s.api('/investments/'+h,'DELETE')).status,409)
})
test('breakdown removal clears only awaiting allocations; source bank receipt and investment history remain',async()=>{
  const s=await salarySetup();await save(s);const p=await record(s)
  assert.equal((await s.api('/payroll/transactions/salary','DELETE',{expectedRevision:p.revision-1})).status,409)
  assert.equal((await s.api('/payroll/transactions/salary','DELETE',{expectedRevision:p.revision})).status,200)
  assert.equal((await s.api('/transactions/salary')).data.amountMinor,15484200)
  assert.equal((await record(s)),null)
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM payroll_contributions').get().n,0)
})
test('unmatched employer amount can be corrected by removal; employee allocations require editing breakdown',async()=>{
  const s=await salarySetup();await save(s);let p=await record(s)
  await s.api('/payroll/transactions/salary/employer','POST',{scheme:'epf',amountMinor:100,expectedRevision:p.revision})
  p=await record(s);const employer=p.contributions.find(c=>c.contributor==='employer'),employee=p.contributions.find(c=>c.contributor==='employee')
  assert.equal((await s.api('/payroll/contributions/'+employee.id,'DELETE',{expectedRevision:employee.revision})).status,409)
  assert.equal((await s.api('/payroll/contributions/'+employer.id,'DELETE',{expectedRevision:employer.revision},'two')).status,404)
  assert.equal((await s.api('/payroll/contributions/'+employer.id,'DELETE',{expectedRevision:employer.revision})).status,200)
  assert.equal((await record(s)).contributions.length,2)
})
test('ignored receipt stays visible as history but cannot gain a new breakdown or confirmation',async()=>{
  const s=await salarySetup();await save(s);const c=await credit(s),h=await holding(s)
  await s.api('/transactions/salary','PATCH',{status:'ignored'})
  assert.equal((await s.api('/payroll')).data[0].transactionStatus,'ignored')
  assert.equal((await save(s,'salary',{...payslip,expectedRevision:(await record(s)).revision})).status,400)
  assert.equal((await s.api('/payroll/contributions/'+c.id,'PATCH',{investmentId:h,activityId:null,creditedDate:'2026-10-11',statementReference:'Synthetic Sep credit',expectedRevision:c.revision})).status,400)
})
test('database triggers enforce linked net value and prevent cross-workspace matches outside the HTTP validation',async()=>{
  const s=await salarySetup();await save(s);const c=await credit(s),foreign=await holding(s,'epf','two')
  assert.throws(()=>s.sqlite.exec("UPDATE transactions SET amount_minor=1 WHERE id='salary'"),/PAYROLL_TRANSACTION_MISMATCH/)
  assert.throws(()=>s.sqlite.prepare("UPDATE payroll_contributions SET investment_id=?,credited_date='2026-10-11',statement_reference='Synthetic' WHERE id=?").run(foreign,c.id),/PAYROLL_HOLDING_MISMATCH/)
})
test('pension statement evidence cannot be reused across payrolls within a workspace',async()=>{
  const s=await salarySetup();await save(s);await save(s,'salary2')
  for(const id of ['salary','salary2'])await s.api('/payroll/transactions/'+id+'/employer','POST',{scheme:'eps',amountMinor:125000,expectedRevision:(await record(s,id)).revision})
  const first=(await record(s)).contributions.find(c=>c.scheme==='eps'),second=(await record(s,'salary2')).contributions.find(c=>c.scheme==='eps')
  const m={investmentId:null,activityId:null,creditedDate:'2026-10-11',statementReference:'Synthetic Sep EPS',expectedRevision:first.revision}
  assert.equal((await s.api('/payroll/contributions/'+first.id,'PATCH',m)).status,200)
  assert.equal((await s.api('/payroll/contributions/'+second.id,'PATCH',{...m,expectedRevision:second.revision})).status,409)
  assert.equal((await record(s,'salary2')).contributions.find(c=>c.scheme==='eps').creditedDate,null)
})

test('payroll setup can resume after partial creation and can be rerun without losing data',async()=>{
  const s=await salarySetup();await save(s)
  const before=await record(s)
  s.sqlite.exec("DROP TRIGGER payroll_sync_insert")
  s.sqlite.exec(readFileSync('migrations/0007_payroll.sql','utf8'))
  assert.deepEqual(await record(s),before)
  assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'payroll_%'").get().n,8)
})
