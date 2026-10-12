const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
let reply, sent;
const context=vm.createContext({Date,Number,JSON,console,Utilities:{
  DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
  computeDigest:(algorithm,value)=>[...crypto.createHash('sha256').update(value).digest()],
  parseDate:(value,zone)=>{assert.equal(zone,'Asia/Calcutta');return new Date(value.replace(' ','T')+'+05:30');}
},UrlFetchApp:{fetch:(url,options)=>{sent={url,options};if(reply instanceof Error)throw reply;return {getResponseCode:()=>reply.status,getContentText:()=>reply.body};}}});
vm.runInContext(readFileSync(__dirname+'/D1Sync.gs','utf8'),context);
const at=context.d1ReceivedAt_('2026-10-12 18:10:00','Asia/Calcutta');
assert.equal(at,'2026-10-12T12:40:00.000Z');
assert.equal(context.d1ReceivedAt_('2026-10-12T18:10:00+05:30','Asia/Calcutta'),at);
assert.throws(()=>context.d1ReceivedAt_('', 'Asia/Calcutta'));
assert.throws(()=>context.d1ReceivedAt_('12/10/2026', 'Asia/Calcutta'));
const id=context.d1ExternalId_('BANK','Rs 10 debited',at);
assert.equal(id,context.d1ExternalId_('BANK','Rs 10 debited',at));
assert.notEqual(id,context.d1ExternalId_('BANK','Rs 11 debited',at));
assert.match(id,/^sheets:[a-f0-9]{64}$/);
const payload={externalId:id,message:'Rs 10 debited',receivedAt:at};
reply={status:201,body:JSON.stringify({success:true,data:{smsMessageId:'sms-1',transactionId:'tx-1'}})};
assert.equal(context.d1PostSms_('secret',payload).ok,true);
assert.equal(sent.options.headers.Authorization,'Bearer secret');
assert.equal(sent.options.followRedirects,false);
assert.equal(JSON.parse(sent.options.payload).receivedAt,at);
reply={status:200,body:JSON.stringify({success:true,data:{ignored:true}})};
assert.equal(context.d1PostSms_('secret',payload).data.ignored,true);
reply={status:200,body:JSON.stringify({success:true,data:{smsMessageId:'sms-1',duplicate:true}})};
assert.equal(context.d1PostSms_('secret',payload).ok,true);
for(const status of [401,403,429,500]){
  reply={status,body:JSON.stringify({success:false,error:'secret'})};
  const result=context.d1PostSms_('secret',payload);
  assert.equal(result.ok,false);assert.equal(result.authError,status===401||status===403);
  assert.ok(!result.note.includes('secret'));
}
reply={status:200,body:'<html>Sign in</html>'};assert.equal(context.d1PostSms_('secret',payload).ok,false);
reply={status:200,body:'{"success":true,"data":{}}'};assert.equal(context.d1PostSms_('secret',payload).ok,false);
reply=new Error('sensitive exception');assert.equal(context.d1PostSms_('secret',payload).note,'Network request failed; retry scheduled');
console.log('D1 sync checks passed: dates, identity, delivery acknowledgement, auth failure, retries, and secret redaction.');
