import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync,readdirSync } from 'node:fs'
import { handleApiRequest } from '../.nps-test-dist/api.mjs'
import { parseNpsCsv } from '../.nps-test-dist/parser.mjs'
function fixture({account='111111111111',day='14',value='150.00'}={}){
 return `NPS Transaction Statement for Tier I Account\nPRAN,'${account}\nStatement Generation Date :October ${day} 2026 09:07 AM\nValue of your Holdings,,,,,,Return on Investment(XIRR), 5.91%\n(A),,(B),(C),(D),(E)\nRs ${value},1,Rs 100.00,Rs 0.00,Rs 50.00,Rs 1.50\nParticulars,Scheme wise Value,Total Units,NAV as on 13-Oct-2026\nTEST PENSION FUND SCHEME E - TIER I POP,100.00,10.0000,10.0000\nTEST PENSION FUND SCHEME C - TIER I POP,20.00,2.0000,10.0000\nTEST PENSION FUND SCHEME G - TIER I POP,30.00,3.0000,10.0000\nDate,Particulars,Uploaded By,Employee,Employer,Total\n11-Sep-2026,For August 2026,Uploader,0.00,30.00,30.00\nTransaction Details\n`+[['E','9.0500','10.0000'],['C','1.0500','2.0000'],['G','2.0500','3.0000']].map(([code,opening,closing])=>`TEST PENSION FUND SCHEME ${code} - TIER I POP\n01-Apr-2026,Opening balance,,,${opening}\n11-Sep-2026,By Contribution for August2026,10.00,10.0000,1.0000\n06-Oct-2026,Billing for Q2 2026-2027,(0.50),10.0000,(0.0500)\n${day}-Oct-2026,Closing Balance,,,${closing}`).join('\n')
}
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON')
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'))
 sql.exec(`INSERT INTO workspaces(id,name) VALUES('home','Home'),('other','Other');INSERT INTO accounts(id,workspace_id,name,institution,account_type) VALUES('salary','home','Salary','Clearing','cash');INSERT INTO investments(id,workspace_id,investment_type,name,institution,invested_minor,current_value_minor,notes) VALUES('nps','home','nps','NPS Contributions (Test)','Old',3000,3000,'Original note');`)
 const db={prepare(text){const stmt=sql.prepare(text);const wrap=values=>({bind(...v){return wrap(v)},async first(){return stmt.get(...values)??null},async all(){return {results:stmt.all(...values)}},async run(){return {meta:{changes:Number(stmt.run(...values).changes)}}}});return wrap([])},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const stmt of statements)result.push(await stmt.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}}
 const env={DB:db,DEFAULT_WORKSPACE_ID:'home'}
 const api=async(path='',method='GET',body,workspace='home')=>{const response=await handleApiRequest(new Request('https://test.invalid/api/investments/nps/nps'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}),{...env,DEFAULT_WORKSPACE_ID:workspace});return {status:response.status,...await response.json()}}
 const add=(id='salary-sep',month='2026-09')=>sql.prepare(`INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,from_account_id,transaction_date,status,notes) VALUES(?,'home','investment','NPS salary',3000,'salary','2026-10-01','confirmed',?)`).run(id,`[investment-holding:nps] [salary-ledger:${month}:nps]`)
 const preview=async(text=fixture())=>(await api('/preview','POST',{csvText:text})).data
 const save=async(text=fixture(),matches=[])=>{const p=await preview(text);return api('/import','POST',{csvText:text,expectedUpdatedAt:p.expectedUpdatedAt,expectedInvestedMinor:p.expectedInvestedMinor,expectedValueMinor:p.expectedValueMinor,matches})}
 return {sql,api,add,preview,save}
}
test('parser reconciles scheme units, valuation, contributions and fees at four decimal precision',()=>{
 const s=parseNpsCsv(fixture()).statement;assert.equal(s.valueMinor,15000);assert.equal(s.contributedMinor,10000);assert.equal(s.feesMinor,150);assert.equal(s.xirrPercent,5.91);assert.equal(s.schemes[0].units4,100000);assert.equal(s.movements[1].units4,500);assert.equal(s.credits[0].salaryMonth,'2026-08')
})
test('invalid totals, units, malformed dates, unsupported withdrawals and missing holdings are rejected',()=>{
 for(const text of [fixture({value:'151.00'}),fixture().replace('10.0000,10.0000','11.0000,10.0000'),fixture().replace('11-Sep-2026','31-Sep-2026'),fixture().replace('Rs 0.00','Rs 10.00'),fixture().replace('TEST PENSION FUND SCHEME G - TIER I POP,30.00','UNKNOWN,30.00')])assert.throws(()=>parseNpsCsv(text))
})
test('preview has no financial effects; import replaces valuation and leaves September awaiting credit',async()=>{
 const s=setup();try{s.add();const before=s.sql.prepare('SELECT * FROM transactions').all();const p=await s.preview();assert.equal(p.pending[0].salaryMonth,'2026-09');assert.equal(s.sql.prepare('SELECT current_value_minor FROM investments').get().current_value_minor,3000);assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM nps_statements').get().n,0)
 assert.equal((await s.save()).status,200);const holding=s.sql.prepare('SELECT * FROM investments').get();assert.equal(holding.current_value_minor,15000);assert.equal(holding.invested_minor,10000);assert.equal(holding.name,'NPS Tier I (Test)');assert.deepEqual(s.sql.prepare('SELECT * FROM transactions').all(),before)
 const detail=await s.api();assert.equal(detail.data.pending.length,1);assert.equal(detail.data.statement.schemes.length,3);assert.ok(!JSON.stringify(detail).includes('111111111111'))
 }finally{s.sql.close()}
})
test('same statement is idempotent and cannot change investment totals twice',async()=>{
 const s=setup();try{await s.save();assert.equal((await s.api('/import','POST',{csvText:fixture()})).data.alreadyImported,true);assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM nps_statements').get().n,1);assert.equal(s.sql.prepare('SELECT current_value_minor FROM investments').get().current_value_minor,15000)}finally{s.sql.close()}
})
test('matching requires exact salary month and amount, and never changes the original cash-flow transaction',async()=>{
 const s=setup();try{s.add();assert.equal((await s.save(fixture(),[{transactionId:'salary-sep',creditDate:'2026-09-11',salaryMonth:'2026-08'}])).status,400);s.add('salary-aug','2026-08');const before=s.sql.prepare('SELECT * FROM transactions').all();assert.equal((await s.save(fixture(),[{transactionId:'salary-aug',creditDate:'2026-09-11',salaryMonth:'2026-08'}])).status,200);assert.equal((await s.api()).data.pending.length,1);assert.equal((await s.api()).data.matches[0].transactionId,'salary-aug');assert.deepEqual(s.sql.prepare('SELECT * FROM transactions').all(),before)}finally{s.sql.close()}
})
test('workspace isolation, stale snapshots and changed holdings block imports',async()=>{
 const s=setup();try{assert.equal((await s.api('', 'GET',undefined,'other')).status,404);const p=await s.preview();s.sql.prepare('UPDATE investments SET current_value_minor=4000').run();assert.equal((await s.api('/import','POST',{csvText:fixture(),expectedUpdatedAt:p.expectedUpdatedAt,expectedInvestedMinor:p.expectedInvestedMinor,expectedValueMinor:p.expectedValueMinor,matches:[]})).status,409);await s.save();assert.equal((await s.api('/preview','POST',{csvText:fixture({day:'13'})})).status,409);assert.equal((await s.api('/preview','POST',{csvText:fixture({account:'222222222222',day:'15'})})).status,409)}finally{s.sql.close()}
})
test('verified NPS values cannot be overwritten by generic edits or deleted',async()=>{
 const s=setup();try{await s.save();
 for(const [method,data] of [['PATCH',{currentValueMinor:1}],['PATCH',{investmentType:'epf'}],['DELETE',undefined]]){
 const response=await handleApiRequest(new Request('https://test.invalid/api/investments/nps',{method,...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})}),{DB:{prepare(text){const stmt=s.sql.prepare(text);const wrap=values=>({bind(...v){return wrap(v)},async first(){return stmt.get(...values)??null}});return wrap([])}},DEFAULT_WORKSPACE_ID:'home'});assert.equal(response.status,409)
 }
 }finally{s.sql.close()}
})
