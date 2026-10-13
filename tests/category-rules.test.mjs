import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync,readdirSync} from 'node:fs'
import {handleApiRequest} from '../.category-rules-test-dist/api.mjs'
import {matchCategory,merchantKeyword} from '../.category-rules-test-dist/matcher.mjs'
const rule=(keyword,category_id,extra={})=>({id:keyword,keyword,category_id,transaction_type:'expense',is_active:1,source:'manual',category_kind:'expense',...extra})
test('safe merchant keywords exclude generic descriptions and long reference numbers',()=>{
 assert.equal(merchantKeyword('UPI payment'),null);assert.equal(merchantKeyword('UPI payment · Corner Store'),'CORNER STORE')
 assert.equal(merchantKeyword('Payment'),null);assert.equal(merchantKeyword('ACH 123456789'),null)
})
test('matcher normalises case/punctuation, respects word boundaries and never uses regex keywords',()=>{
 assert.equal(matchCategory([rule('CORNER STORE','food')],'expense','Paid to corner-store'),'food')
 assert.equal(matchCategory([rule('STORE','food')],'expense','STOREHOUSE'),null)
 assert.equal(matchCategory([rule('FOO BAR','food')],'expense','FOO .* BAR'), 'food')
 assert.equal(matchCategory([rule('CORNER STORE','food')],'expense','Unknown merchant'),null)
})
test('longest matching phrase wins but equally specific conflicting matches are uncategorised',()=>{
 assert.equal(matchCategory([rule('EXAMPLE','shopping'),rule('EXAMPLE RECHARGE','utilities')],'expense','Example recharge'),'utilities')
 assert.equal(matchCategory([rule('RED SHOP','one'),rule('BIG SHOP','two')],'expense','RED SHOP BIG SHOP'),null)
})
test('inactive rules, wrong category kinds and transfers cannot match',()=>{
 assert.equal(matchCategory([rule('SHOP','food',{is_active:0})],'expense','SHOP'),null)
 assert.equal(matchCategory([rule('SHOP','food')],'income','SHOP'),null)
 assert.equal(matchCategory([rule('SHOP','food')],'transfer','SHOP'),null)
 assert.equal(matchCategory([rule('SHOP','food',{category_kind:'income'})],'expense','SHOP'),null)
})
function setup(){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'))
 sql.exec(`INSERT INTO workspaces(id,name) VALUES('home','Home'),('other','Other'); INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES('bank','home','Bank','ICICI','bank','981'); INSERT INTO categories(id,workspace_id,name,kind) VALUES('food','home','Food','expense'),('shopping','home','Shopping','expense'),('salary','home','Salary','income'),('foreign','other','Foreign','expense');`)
 const db={prepare(text){let args=[];const s=sql.prepare(text);return{bind(...v){args=v;return this},async first(){return s.get(...args)??null},async all(){return{results:s.all(...args)}},async run(){return{meta:{changes:Number(s.run(...args).changes)}}}}},async batch(stmts){sql.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}}
 const env={DB:db,DEFAULT_WORKSPACE_ID:'home',SMS_INGEST_TOKEN:'test-token'}
 const api=async(path,method='GET',body,workspace='home')=>{const r=await handleApiRequest(new Request('https://test.invalid/api'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer test-token'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{...env,DEFAULT_WORKSPACE_ID:workspace});return{status:r.status,...await r.json()}}
 const transaction=(description,categoryId)=>api('/transactions','POST',{transactionType:'expense',description,categoryId,amountMinor:100,transactionDate:'2026-10-13',fromAccountId:'bank',toAccountId:null})
 return{sql,api,transaction}
}
test('learned history assigns new records and never changes existing categories',async()=>{
 const {sql,api,transaction}=setup();try{
 await transaction('UPI payment · Corner Store','food');await transaction('Unknown merchant',null)
 const learned=await api('/category-rules/learn','POST');assert.equal(learned.status,200);assert.equal(learned.data.length,1)
 const next=await transaction('Payment to CORNER STORE',null);assert.equal(next.data.categoryId,'food')
 assert.equal((await transaction('Another unknown',null)).data.categoryId,null)
 assert.equal(sql.prepare("SELECT category_id FROM transactions WHERE description='Unknown merchant'").get().category_id,null)
 }finally{sql.close()}
})
test('manual corrections teach future transactions, preserve explicit categories and survive history refresh',async()=>{
 const {sql,api,transaction}=setup();try{
 const old=await transaction('Corner Store','food');await api('/category-rules/learn','POST')
 await api('/transactions/'+old.data.id,'PATCH',{categoryId:'shopping'})
 assert.equal((await transaction('CORNER STORE',null)).data.categoryId,'shopping')
 assert.equal((await transaction('CORNER STORE','food')).data.categoryId,'food')
 await api('/category-rules/learn','POST')
 assert.equal((await transaction('CORNER STORE',null)).data.categoryId,'shopping')
 await api('/transactions/'+old.data.id,'PATCH',{categoryId:null})
 assert.equal((await transaction('CORNER STORE',null)).data.categoryId,null)
 }finally{sql.close()}
})
test('conflicting history is paused and keyword/type edits are workspace scoped',async()=>{
 const {sql,api,transaction}=setup();try{
 await transaction('Corner Store','food');await transaction('CORNER STORE','shopping')
 const learned=await api('/category-rules/learn','POST'),r=learned.data[0];assert.equal(r.is_active,0);assert.equal(r.category_id,null)
 assert.equal((await transaction('CORNER STORE',null)).data.categoryId,null)
 assert.equal((await api('/category-rules/'+r.id,'PATCH',{categoryId:'shopping',isActive:true},'other')).status,404)
 assert.equal((await api('/category-rules/'+r.id,'PATCH',{categoryId:'foreign',isActive:true})).status,400)
 assert.equal((await api('/category-rules/'+r.id,'PATCH',{categoryId:'shopping',isActive:true})).status,200)
 assert.equal((await transaction('CORNER STORE',null)).data.categoryId,'shopping')
 assert.equal((await api('/category-rules','POST',{keyword:'Payment',transactionType:'expense',categoryId:'food'})).status,400)
 }finally{sql.close()}
})
test('SMS uses active keyword rules and unknown merchants stay uncategorised',async()=>{
 const {sql,api}=setup();try{
 await api('/category-rules','POST',{keyword:'Corner Store',transactionType:'expense',categoryId:'food'})
 const send=(merchant,ref)=>api('/ingest/sms','POST',{message:`ICICI Bank Acct XX981 debited for Rs 30.00 on 13-Oct-26; ${merchant} credited. UPI:${ref}.`,externalId:ref,receivedAt:'2026-10-13T07:00:00Z',sender:'ICICI'})
 const known=await send('CORNER STORE','123456789012');assert.equal(known.status,201)
 assert.equal(sql.prepare('SELECT category_id FROM transactions WHERE id=?').get(known.data.transactionId).category_id,'food')
 const unknown=await send('UNKNOWN MERCHANT','123456789013');assert.equal(unknown.status,201)
 assert.equal(sql.prepare('SELECT category_id FROM transactions WHERE id=?').get(unknown.data.transactionId).category_id,null)
 }finally{sql.close()}
})
