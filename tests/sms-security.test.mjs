import assert from 'node:assert/strict'
import test from 'node:test'
import { isSmsAuthorized, smsDedupeKey, smsContentKey, canonicalSmsTime, smsContentGroup, smsReceiptIdentity } from '../.sms-test-dist/sms-security.js'

test('accepts bearer authentication', async()=>assert.equal(await isSmsAuthorized(new Request('https://example.test',{headers:{Authorization:'Bearer correct'}}),'correct'),true))
test('accepts X-SMS-Token authentication', async()=>assert.equal(await isSmsAuthorized(new Request('https://example.test',{headers:{'X-SMS-Token':'correct'}}),'correct'),true))
test('rejects missing authentication', async()=>assert.equal(await isSmsAuthorized(new Request('https://example.test'),'correct'),false))
test('rejects incorrect authentication', async()=>assert.equal(await isSmsAuthorized(new Request('https://example.test',{headers:{Authorization:'Bearer wrong'}}),'correct'),false))
test('external IDs produce stable scoped identity inputs',async()=>{ const one=await smsDedupeKey('phone-1','A','2026-01-01','first'); const retry=await smsDedupeKey('phone-1','B','2026-02-02','changed'); assert.equal(one,retry); assert.match(one,/^external:[a-f0-9]{64}$/) })
test('canonical content produces stable hash identity',async()=>{ const args=[null,'HDFCBK','2026-09-29T16:30:00+05:30','INR 650 spent']; assert.equal(await smsDedupeKey(...args),await smsDedupeKey(...args)); assert.notEqual(await smsDedupeKey(...args),await smsDedupeKey(null,'HDFCBK','2026-09-29T16:30:01+05:30','INR 650 spent')) })
test('no-reference content key ignores delivery route and normalises equivalent receipt timestamps',async()=>{
  const local=await smsContentKey('SMS','2026-10-13T13:54:09','Synthetic payment')
  assert.equal(local,await smsContentKey('SMS','2026-10-13T08:24:09.000Z','Synthetic payment'))
  assert.equal(local,await smsContentKey('SMS','2026-10-13T13:54:09+05:30','Synthetic payment'))
  assert.equal(local,await smsContentKey('SMS','2026-10-13T13:54:09.123+0530','Synthetic payment'))
  assert.notEqual(local,await smsContentKey('SMS','2026-10-13T13:54:10','Synthetic payment'))
  assert.equal(canonicalSmsTime('2026-10-13T00:15:00'),'2026-10-12T18:45:00Z')
})
test('repeat evidence groups do not confuse source facts with receipt identity',async()=>{
  const group=await smsContentGroup('BANK','Synthetic debit','2026-10-01')
  assert.match(group,/^content:v3:[a-f0-9]{64}:$/)
  assert.notEqual(group,await smsContentGroup('OTHER','Synthetic debit','2026-10-01'))
  assert.notEqual(group,await smsContentGroup('BANK','Synthetic debit changed','2026-10-01'))
  assert.notEqual(group,await smsContentGroup('BANK','Synthetic debit','2026-10-02'))
  assert.equal(await smsReceiptIdentity(group,'2026-10-01T12:30:00'),await smsReceiptIdentity(group,'2026-10-01T07:00:00Z'))
  assert.notEqual(await smsReceiptIdentity(group,'2026-10-01T07:00:00Z'),await smsReceiptIdentity(group,'2026-10-01T07:00:01Z'))
})
