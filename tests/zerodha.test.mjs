import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync,readdirSync } from 'node:fs'
import { zerodhaRoute } from '../.kite-test-dist/zerodha.mjs'
import { normalizeHoldings,tokenExpiry,cipherToken } from '../.kite-test-dist/kite.mjs'
import { BACKUP_TABLES } from '../.kite-test-dist/backup-registry.mjs'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { ZerodhaSync } from '../.kite-test-dist/ZerodhaSync.mjs'
const encryption=btoa('x'.repeat(32))
const fixture={isin:'INE000A01010',tradingsymbol:'EXAMPLE',quantity:10,average_price:100.15,last_price:125.75}
function setup(){
 const sqlite=new DatabaseSync(':memory:')
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('migrations/'+file,'utf8'))
 sqlite.exec("INSERT INTO workspaces(id,name) VALUES('test','Test');")
 const DB={prepare(sql){let args=[];return {bind(...v){args=v;return this},async first(){return sqlite.prepare(sql).get(...args)??null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}}}},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result}catch(e){sqlite.exec('ROLLBACK');throw e}}}
 const env={DB,DEFAULT_WORKSPACE_ID:'test',RECOVERY_TOKEN:'synthetic-owner',KITE_API_KEY:'example-key',KITE_API_SECRET:'example-secret',KITE_CLIENT_ID:'EXAMPLE',KITE_TOKEN_ENCRYPTION_KEY:encryption}
 const call=async(action,body,headers={})=>zerodhaRoute(new Request('https://example.test/api/zerodha/'+action,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer synthetic-owner',Origin:'https://example.test',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,action)
 const seedPreview=(id='review')=>sqlite.prepare('INSERT INTO kite_previews(id,workspace_id,client_id,fetched_at,expires_at,data_json) VALUES(?,?,?,?,?,?)').run(id,'test','EXAMPLE',new Date().toISOString(),Date.now()+600000,JSON.stringify(normalizeHoldings([fixture])))
 return {sqlite,env,call,seedPreview}
}
test('normalizes exact quantities and paise; invalid prices preserve existing valuations',()=>{
 const [r]=normalizeHoldings([fixture]);assert.equal(r.cost,100150);assert.equal(r.value,125750)
 assert.equal(normalizeHoldings([{...fixture,last_price:0}])[0].value,null)
 for(const field of ['t1_quantity','used_quantity','collateral_quantity','short_quantity'])assert.ok(normalizeHoldings([{...fixture,[field]:1}])[0].warning)
 assert.throws(()=>normalizeHoldings([fixture,fixture]));assert.throws(()=>normalizeHoldings([{...fixture,quantity:-1}]))
})
test('tokens expire next 6am IST and encryption rejects tampering',async()=>{
 assert.equal(new Date(tokenExpiry(Date.parse('2026-10-27T05:00:00Z'))).toISOString(),'2026-10-28T00:30:00.000Z')
 const c=await cipherToken('synthetic-session',encryption);assert.equal(await cipherToken(c,encryption,true),'synthetic-session');assert.ok(!c.includes('synthetic-session'))
 await assert.rejects(cipherToken(c,btoa('y'.repeat(32)),true))
})
test('owner key and same-origin checks protect every action',async()=>{
 const s=setup();await assert.rejects(s.call('status',undefined,{Authorization:'Bearer wrong'}));await assert.rejects(s.call('connect',{}, {Origin:'https://other.test'}))
 assert.equal((await (await s.call('status')).json()).data.connected,false)
 await assert.rejects(s.call('preview',{}))
})
test('connect sets short-lived HttpOnly cookie and callback rejects unbound login',async()=>{
 const s=setup();const r=await s.call('connect',{});assert.match(r.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Lax/)
 const response=await s.call('callback');assert.match(await response.text(),/could not be verified/)
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM kite_sessions').get().n,0)
})
test('first sync adds one holding and append-only snapshot, replay creates no payments',async()=>{
 const s=setup();s.seedPreview();const body={previewId:'review',choices:[{isin:fixture.isin,investmentId:null}]}
 await s.call('apply',body);await s.call('apply',body)
 const h=s.sqlite.prepare('SELECT * FROM investments').get();assert.equal(h.current_value_minor,125750);assert.equal(h.quantity,10)
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM investment_valuations').get().n,1)
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,0)
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM investment_payments').get().n,0)
})
test('subsequent sync updates same mapping; stale version and duplicate new mapping roll back',async()=>{
 const s=setup();s.seedPreview('first');await s.call('apply',{previewId:'first',choices:[{isin:fixture.isin,investmentId:null}]})
 const h=s.sqlite.prepare('SELECT * FROM investments').get();s.seedPreview('second')
 await assert.rejects(s.call('apply',{previewId:'second',choices:[{isin:fixture.isin,investmentId:h.id,version:0}]}))
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM investment_valuations').get().n,1)
 await assert.rejects(s.call('apply',{previewId:'second',choices:[{isin:fixture.isin,investmentId:null}]}))
 await s.call('apply',{previewId:'second',choices:[{isin:fixture.isin,investmentId:h.id,version:h.ledger_version}]})
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM investments').get().n,1)
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM investment_valuations').get().n,2)
 assert.equal(s.sqlite.prepare('SELECT notes FROM investments').get().notes.split('[kite:').length,2)
})
test('expired, missing, cross-workspace and duplicate security selections cannot apply',async()=>{
 const s=setup();s.seedPreview()
 await assert.rejects(s.call('apply',{previewId:'missing',choices:[]}))
 await assert.rejects(s.call('apply',{previewId:'review',choices:[{isin:fixture.isin},{isin:fixture.isin}]}))
 s.sqlite.exec("UPDATE kite_previews SET expires_at=0")
 await assert.rejects(s.call('apply',{previewId:'review',choices:[{isin:fixture.isin}]}))
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM investments').get().n,0)
})
test('operational token tables are excluded from backup; all restorable columns unchanged',()=>{
 const s=setup(),excluded=new Set(['workspaces','recovery_context','recovery_payloads','restore_previews','workflow_claims','import_commit_guards','statement_commit_context','kite_sessions','kite_auth','kite_previews'])
 const tables=s.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name)
 assert.deepEqual(tables.filter(t=>!excluded.has(t)).sort(),BACKUP_TABLES.map(t=>t.name).sort())
})
test('Zerodha panel renders locked and does not expose credentials',()=>{
 const html=renderToStaticMarkup(createElement(ZerodhaSync,{onSaved(){}}));assert.match(html,/Unlock Zerodha/);assert.match(html,/type="password"/);assert.ok(!html.includes('example-secret'))
})
test('bound login exchanges token once, encrypted session fetches preview, then disconnect clears it',async()=>{
 const s=setup(),original=globalThis.fetch,paths=[]
 globalThis.fetch=async(url,init)=>{paths.push(new URL(url).pathname);if(String(url).endsWith('/session/token'))return Response.json({status:'success',data:{user_id:'EXAMPLE',access_token:'synthetic-session'}});assert.match(init.headers.Authorization,/synthetic-session/);return Response.json({status:'success',data:[fixture]})}
 try {
  const start=await s.call('connect',{}),cookie=start.headers.get('Set-Cookie').split(';')[0]
  const callback=()=>zerodhaRoute(new Request('https://example.test/api/zerodha/callback?status=success&request_token=synthetic-code',{headers:{Cookie:cookie}}),s.env,'callback')
  assert.match(await (await callback()).text(),/connected/)
  assert.ok(!s.sqlite.prepare('SELECT token_cipher FROM kite_sessions').get().token_cipher.includes('synthetic-session'))
  assert.match(await (await callback()).text(),/cancelled or expired/)
  const p=(await (await s.call('preview',{})).json()).data
  assert.equal(p.holdings[0].name,'EXAMPLE');assert.equal(p.holdings[0].matchedId,null)
  assert.deepEqual(paths,['/session/token','/portfolio/holdings'])
  await s.call('disconnect',{});assert.equal(s.sqlite.prepare('SELECT count(*) n FROM kite_sessions').get().n,0)
 }finally{globalThis.fetch=original}
})
test('outstanding investment payments block a valuation atomically',async()=>{
 const s=setup();s.seedPreview('first');await s.call('apply',{previewId:'first',choices:[{isin:fixture.isin}]})
 const h=s.sqlite.prepare('SELECT * FROM investments').get()
 s.sqlite.exec("INSERT INTO accounts(id,workspace_id,name,institution,account_type) VALUES('bank','test','Example Bank','Example','bank'); INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,from_account_id,transaction_date,status,source) VALUES('cash','test','investment','Example funding',100,'bank','2026-01-01','confirmed','manual')")
 s.sqlite.prepare("INSERT INTO investment_payments(id,investment_id,transaction_id,amount_minor,payment_date) VALUES('payment',?,'cash',100,'2026-01-01')").run(h.id)
 s.seedPreview('second');await assert.rejects(s.call('apply',{previewId:'second',choices:[{isin:fixture.isin,investmentId:h.id,version:h.ledger_version}]}))
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM investment_valuations').get().n,1)
 assert.equal(s.sqlite.prepare("SELECT applied FROM kite_previews WHERE id='second'").get().applied,0)
})
test('a foreign workspace target and an unavailable-price holding are rejected',async()=>{
 const s=setup();s.seedPreview()
 s.sqlite.exec("INSERT INTO workspaces(id,name) VALUES('other','Other'); INSERT INTO investments(id,workspace_id,investment_type,name,institution) VALUES('foreign','other','equity','Example','Example')")
 await assert.rejects(s.call('apply',{previewId:'review',choices:[{isin:fixture.isin,investmentId:'foreign',version:0}]}))
 s.sqlite.prepare('UPDATE kite_previews SET data_json=?').run(JSON.stringify(normalizeHoldings([{...fixture,last_price:0}])))
 await assert.rejects(s.call('apply',{previewId:'review',choices:[{isin:fixture.isin}]}))
 assert.equal(s.sqlite.prepare("SELECT count(*) n FROM investments WHERE workspace_id='test'").get().n,0)
})
test('atomic mapping guard blocks a second new holding even after earlier application checks',async()=>{
 const s=setup();s.seedPreview('first');s.seedPreview('second')
 await s.call('apply',{previewId:'first',choices:[{isin:fixture.isin}]})
 const row=normalizeHoldings([fixture])[0]
 const choices=[{...row,investmentId:null,targetId:'duplicate',marker:'[kite:EXAMPLE:'+fixture.isin+']'}]
 assert.throws(()=>s.sqlite.prepare("UPDATE kite_previews SET choices_json=?,applied=1 WHERE id='second'").run(JSON.stringify(choices)),/mapping changed/)
 assert.equal(s.sqlite.prepare('SELECT count(*) n FROM investments').get().n,1)
})
