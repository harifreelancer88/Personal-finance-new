import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync,readdirSync} from 'node:fs'
import {enqueueAi,processAiJob,enqueueUnmatched,markManualCategory} from '../.ai-category-test-dist/jobs.mjs'
import {cleanNarration,validateAiDecision} from '../.ai-category-test-dist/model.mjs'
import {handleApiRequest} from '../.ai-category-test-dist/api.mjs'
import worker from '../.ai-category-test-dist/worker.mjs'
function setup(extra={}){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON')
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'))
 sql.exec(`INSERT INTO workspaces(id,name) VALUES('home','Home'),('other','Other');
 INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES('bank','home','Bank','ICICI','bank','981'),('wallet','home','Wallet','Wallet','wallet',NULL);
 INSERT INTO categories(id,workspace_id,name,kind) VALUES('food','home','Food & Dining','expense'),('shopping','home','Shopping','expense'),('salary','home','Salary','income'),('foreign','other','Foreign','expense');`)
 const db={prepare(text){const statement=sql.prepare(text);const wrap=values=>({bind(...v){return wrap(v)},async first(){return statement.get(...values)??null},async all(){return{results:statement.all(...values)}},async run(){return{meta:{changes:Number(statement.run(...values).changes)}}}});return wrap([])},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const stmt of statements)results.push(await stmt.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}}
 const env={DB:db,DEFAULT_WORKSPACE_ID:'home',SMS_INGEST_TOKEN:'sms-secret',OPENAI_API_KEY:'test-only-secret',AI_CATEGORIZATION_ENABLED:'true',...extra}
 const add=(id='tx',description='Corner Store',type='expense')=>sql.prepare(`INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,from_account_id,to_account_id,transaction_date,status,source) VALUES(?,'home',?,?,12345,?,?,'2026-10-13','confirmed','manual')`).run(id,type,description,type==='income'?null:'bank',type==='income'?'bank':type==='transfer'?'wallet':null)
 const row=(id='tx')=>sql.prepare('SELECT * FROM transactions WHERE id=?').get(id)
 const job=(id='tx')=>sql.prepare('SELECT * FROM ai_category_jobs WHERE transaction_id=?').get(id)
 const api=async(path,method='GET',body)=>{const response=await handleApiRequest(new Request('https://test.invalid/api'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer sms-secret'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);return{status:response.status,...await response.json()}}
 const result=(overrides={})=>({categoryId:'food',keyword:'Corner Store',decision:'categorise',reason:'Explicit grocery merchant.',...overrides})
 const reply=decision=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision)}}],usage:{prompt_tokens:100,completion_tokens:30}}),{headers:{'Content-Type':'application/json'}})
 return{sql,db,env,add,row,job,api,result,reply}
}
test('clear AI category is applied once; paused candidate and audit are stored without changing financial fields',async()=>{
 const s=setup();try{s.add();const before=s.row();await enqueueAi(s.env,'tx');let calls=0
 await processAiJob(s.env,'tx',async()=>{calls++;return s.reply(s.result())});await processAiJob(s.env,'tx',async()=>{calls++;throw Error('unexpected')})
 const after=s.row();assert.equal(after.category_id,'food');assert.equal(after.category_origin,'ai');assert.equal(calls,1)
 for(const field of ['amount_minor','from_account_id','to_account_id','transaction_type','transaction_date','status','notes'])assert.equal(after[field],before[field])
 const rule=s.sql.prepare('SELECT * FROM category_rules').get();assert.equal(rule.source,'ai');assert.equal(rule.is_active,0);assert.equal(rule.keyword,'CORNER STORE')
 assert.equal(s.job().state,'applied');assert.equal(s.job().input_tokens,100);assert.equal(s.job().model,'gpt-4o-mini')
 await s.api('/category-rules/learn','POST');assert.equal(s.sql.prepare('SELECT is_active FROM category_rules').get().is_active,0)
 const details=await s.api('/transactions/tx');assert.equal(details.data.categoryOrigin,'ai')
 }finally{s.sql.close()}
})
test('model request is structured, restricted to allowed categories and strips identifiers',async()=>{
 const s=setup();try{s.add('tx','Corner Store 9876543210 ABCDE1234F abc@upi https://bank.test/ref/999');await enqueueAi(s.env,'tx')
 await processAiJob(s.env,'tx',async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');const body=JSON.parse(options.body);assert.equal(body.model,'gpt-4o-mini');assert.equal(body.response_format.json_schema.strict,true);assert.ok(!options.body.includes('9876543210'));assert.ok(!options.body.includes('ABCDE1234F'));assert.ok(!options.body.includes('abc@upi'));assert.ok(!options.body.includes('https://bank.test'));assert.ok(!options.body.includes('12345'));return s.reply(s.result())})
 assert.equal(s.job().state,'applied')
 }finally{s.sql.close()}
})
test('ambiguous output and broad or hallucinated keywords stay uncategorised',async()=>{
 const categories=[{id:'food',name:'Food',kind:'expense'}]
 for(const keyword of ['AMAZON','PAYMENT','NOT IN NARRATION','123456789','IDENTIFIER'])assert.equal(validateAiDecision({categoryId:'food',keyword,decision:'categorise',reason:'guess'},categories,'AMAZON PAYMENT IDENTIFIER').decision,'review')
 const s=setup();try{s.add();await enqueueAi(s.env,'tx');await processAiJob(s.env,'tx',async()=>s.reply(s.result({decision:'review',keyword:null,reason:'Ambiguous person payment.'})));assert.equal(s.row().category_id,null);assert.equal(s.job().state,'review');assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM category_rules').get().n,0)}finally{s.sql.close()}
})
test('foreign or wrong-kind categories are rejected even if AI emits valid JSON',async()=>{
 for(const categoryId of ['foreign','salary','invented']){const s=setup();try{s.add();await enqueueAi(s.env,'tx');await processAiJob(s.env,'tx',async()=>s.reply(s.result({categoryId})));assert.equal(s.row().category_id,null);assert.equal(s.job().state,'failed');assert.equal(s.job().error_code,'INVALID_AI_CATEGORY')}finally{s.sql.close()}}
})
test('a human correction while AI is in flight wins, including within the same timestamp second',async()=>{
 const s=setup();try{s.add();await enqueueAi(s.env,'tx');let release,started;const ready=new Promise(r=>started=r)
 const task=processAiJob(s.env,'tx',async()=>{started();return new Promise(r=>release=r)});await ready
 const corrected=await s.api('/transactions/tx','PATCH',{categoryId:'shopping'});assert.equal(corrected.status,200);assert.equal(corrected.data.categoryOrigin,'manual')
 release(s.reply(s.result()));await task;assert.equal(s.row().category_id,'shopping');assert.equal(s.job().state,'corrected');assert.equal(s.sql.prepare("SELECT COUNT(*) AS n FROM category_rules WHERE source='ai'").get().n,0)
 }finally{s.sql.close()}
})
test('correction converts the exact AI keyword to a manual rule for future descriptions',async()=>{
 const s=setup();try{s.add('tx','Paid to Corner Store');await enqueueAi(s.env,'tx');await processAiJob(s.env,'tx',async()=>s.reply(s.result()));await s.api('/transactions/tx','PATCH',{categoryId:'shopping'})
 const rule=s.sql.prepare("SELECT * FROM category_rules WHERE keyword='CORNER STORE'").get();assert.equal(rule.category_id,'shopping');assert.equal(rule.is_active,1);assert.equal(rule.source,'manual')
 const next=await s.api('/transactions','POST',{transactionType:'expense',description:'Corner Store',amountMinor:100,fromAccountId:'bank',toAccountId:null,transactionDate:'2026-10-13'});assert.equal(next.data.categoryId,'shopping')
 }finally{s.sql.close()}
})
test('clearing a category deliberately prevents automatic reassignment',async()=>{
 const s=setup();try{s.add();await s.api('/transactions/tx','PATCH',{categoryId:null});await enqueueAi(s.env,'tx');assert.equal(s.job(),undefined);assert.equal(await enqueueUnmatched(s.env),0)}finally{s.sql.close()}
})
test('active rules avoid a model call; paused/conflicting rules block AI',async()=>{
 for(const active of [0,1]){const s=setup();try{s.add();await enqueueAi(s.env,'tx');s.sql.prepare("INSERT INTO category_rules(id,workspace_id,keyword,transaction_type,category_id,is_active,source) VALUES('r','home','CORNER STORE','expense','shopping',?,'manual')").run(active)
 await processAiJob(s.env,'tx',async()=>{throw Error('should not call')});assert.equal(s.row().category_id,active?'shopping':null);assert.equal(s.job().state,active?'superseded':'review');assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM ai_category_usage').get().n,0)
 }finally{s.sql.close()}}
})
test('concurrent processing reserves quota atomically and duplicate jobs never double-call',async()=>{
 const s=setup({AI_DAILY_REQUEST_LIMIT:'1'});try{s.add();s.add('second','Second Store');await enqueueAi(s.env,'tx');await enqueueAi(s.env,'tx');await enqueueAi(s.env,'second');let calls=0
 const fetcher=async()=>{calls++;return s.reply(s.result())};await Promise.all([processAiJob(s.env,'tx',fetcher),processAiJob(s.env,'tx',fetcher),processAiJob(s.env,'second',fetcher)])
 assert.equal(calls,1);assert.equal(s.sql.prepare('SELECT requests FROM ai_category_usage').get().requests,1);assert.equal(s.job('second').state,'queued');assert.equal(s.job('second').attempts,0)
 }finally{s.sql.close()}
})
test('transient failures retry at most twice and never modify the transaction',async()=>{
 const s=setup();try{s.add();await enqueueAi(s.env,'tx');let calls=0;const bad=async()=>{calls++;return new Response('',{status:429})}
 await processAiJob(s.env,'tx',bad);assert.equal(s.job().state,'queued');s.sql.prepare("UPDATE ai_category_jobs SET next_attempt_at=CURRENT_TIMESTAMP").run();await processAiJob(s.env,'tx',bad);await processAiJob(s.env,'tx',bad)
 assert.equal(s.job().state,'failed');assert.equal(calls,2);assert.equal(s.row().category_id,null)
 }finally{s.sql.close()}
})
test('manual rules added or categories archived during the request prevent stale AI assignment',async()=>{
 for(const change of ['rule','category']){const s=setup();try{s.add();await enqueueAi(s.env,'tx');await processAiJob(s.env,'tx',async()=>{if(change==='rule')await s.api('/category-rules','POST',{keyword:'Corner Store',transactionType:'expense',categoryId:'shopping'});else s.sql.prepare("UPDATE categories SET is_active=0 WHERE id='food'").run();return s.reply(s.result())});assert.equal(s.row().category_id,null);assert.equal(s.job().state,'superseded');assert.equal(s.sql.prepare("SELECT COUNT(*) AS n FROM category_rules WHERE source='ai'").get().n,0)}finally{s.sql.close()}}
})
test('queue excludes transfers, investments, ignored, categorised and other-workspace records',async()=>{
 const s=setup();try{s.add();s.add('transfer','Transfer','transfer');s.add('invest','Invest','investment');s.add('ignored');s.sql.prepare("UPDATE transactions SET status='ignored' WHERE id='ignored'").run();s.add('known');s.sql.prepare("UPDATE transactions SET category_id='food' WHERE id='known'").run();assert.equal(await enqueueUnmatched(s.env),1);await processAiJob({...s.env,DEFAULT_WORKSPACE_ID:'other'},'tx',async()=>{throw Error('workspace leak')});assert.equal(s.job().state,'queued') }finally{s.sql.close()}
})
test('disabled assistant never queues jobs or reveals the API key',async()=>{
 const s=setup({AI_CATEGORIZATION_ENABLED:'false'});try{s.add();await enqueueAi(s.env,'tx');assert.equal(s.job(),undefined);const status=await s.api('/ai-categories');assert.equal(status.data.enabled,false);assert.ok(!JSON.stringify(status).includes('test-only-secret'));assert.equal((await s.api('/ai-categories','POST')).status,409)}finally{s.sql.close()}
})
test('SMS response and record survive a failed background AI request',async()=>{
 const s=setup();const original=globalThis.fetch;try{let release,started;const ready=new Promise(r=>started=r);globalThis.fetch=async()=>{started();return new Promise(r=>release=r)};const background=[]
 const response=await worker.fetch(new Request('https://test.invalid/api/ingest/sms',{method:'POST',headers:{Authorization:'Bearer sms-secret','Content-Type':'application/json'},body:JSON.stringify({message:'ICICI Bank Acct XX981 debited for Rs 30.00 on 13-Oct-26; CORNER STORE credited. UPI:123456789012.',externalId:'sms',receivedAt:'2026-10-13T07:00:00Z',sender:'ICICI'})}),s.env,{waitUntil:p=>background.push(p)})
 assert.equal(response.status,201);const payload=await response.json();assert.ok(s.row(payload.data.transactionId));await ready;release(new Response('',{status:503}));await Promise.all(background);assert.equal(s.row(payload.data.transactionId).amount_minor,3000);assert.equal(s.job(payload.data.transactionId).state,'queued')
 }finally{globalThis.fetch=original;s.sql.close()}
})
test('narration masking is bounded and removes payment identifiers',()=>{
 const clean=cleanNarration('123456789012 9876543210 XXXXX981 user@upi ABCDE1234F https://example.test/'+ 'a'.repeat(500))
 assert.ok(clean.length<=240);for(const secret of ['123456789012','9876543210','user@upi','ABCDE1234F','XXXXX981'])assert.ok(!clean.includes(secret))
})

test('batch human correction and amount edits invalidate an in-flight AI result',async()=>{
 for(const edit of ['batch','amount']){const s=setup();try{s.add();await enqueueAi(s.env,'tx');await processAiJob(s.env,'tx',async()=>{if(edit==='batch')assert.equal((await s.api('/transactions/categories','PATCH',{transactionIds:['tx'],categoryId:'shopping'})).status,200);else assert.equal((await s.api('/transactions/tx','PATCH',{amountMinor:555})).status,200);return s.reply(s.result())});assert.equal(s.row().category_id,edit==='batch'?'shopping':null);assert.equal(s.row().amount_minor,edit==='amount'?555:12345);assert.equal(s.job().state,edit==='batch'?'corrected':'superseded')}finally{s.sql.close()}}
})
test('terminal review jobs do not starve older unmatched transactions during backlog queueing',async()=>{
 const s=setup();try{for(let i=0;i<21;i++)s.add('old-'+i,'Merchant '+i);assert.equal(await enqueueUnmatched(s.env),20);s.sql.prepare("UPDATE ai_category_jobs SET state='review'").run();assert.equal(await enqueueUnmatched(s.env),1);assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM ai_category_jobs').get().n,21)}finally{s.sql.close()}
})
test('AI proposals that disagree on the same merchant require review instead of rewriting the learned candidate',async()=>{
 const s=setup();try{s.add();await enqueueAi(s.env,'tx');await processAiJob(s.env,'tx',async()=>s.reply(s.result()));s.add('second','Corner Store');await enqueueAi(s.env,'second');await processAiJob(s.env,'second',async()=>s.reply(s.result({categoryId:'shopping'})));assert.equal(s.row('second').category_id,null);assert.equal(s.job('second').state,'review');assert.equal(s.job('second').error_code,'AI_RULE_DISAGREEMENT');assert.equal(s.sql.prepare("SELECT category_id FROM category_rules WHERE keyword='CORNER STORE'").get().category_id,'food')}finally{s.sql.close()}
})
test('migration preserves existing manual and history rules, including paused conflicts',()=>{
 const sql=new DatabaseSync(':memory:');try{for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')&&!f.startsWith('0008')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'))
 sql.exec(`INSERT INTO workspaces(id,name) VALUES('w','Workspace');INSERT INTO categories(id,workspace_id,name,kind) VALUES('c','w','Category','expense');INSERT INTO category_rules(id,workspace_id,keyword,transaction_type,category_id,is_active,source) VALUES('manual','w','EXAMPLE MERCHANT','expense','c',1,'manual'),('history','w','CONFLICTED MERCHANT','expense',NULL,0,'history');`)
 const before=sql.prepare('SELECT * FROM category_rules ORDER BY id').all();sql.exec(readFileSync('migrations/0008_ai_categories.sql','utf8'));assert.deepEqual(sql.prepare('SELECT * FROM category_rules ORDER BY id').all(),before);assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{sql.close()}
})
