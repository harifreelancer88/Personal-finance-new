import assert from 'node:assert/strict'
import test from 'node:test'
import { isSmsAuthorized, smsDedupeKey } from '../.sms-test-dist/sms-security.js'

test('accepts bearer authentication', async()=>assert.equal(await isSmsAuthorized(new Request('https://example.test',{headers:{Authorization:'Bearer correct'}}),'correct'),true))
test('accepts X-SMS-Token authentication', async()=>assert.equal(await isSmsAuthorized(new Request('https://example.test',{headers:{'X-SMS-Token':'correct'}}),'correct'),true))
test('rejects missing authentication', async()=>assert.equal(await isSmsAuthorized(new Request('https://example.test'),'correct'),false))
test('rejects incorrect authentication', async()=>assert.equal(await isSmsAuthorized(new Request('https://example.test',{headers:{Authorization:'Bearer wrong'}}),'correct'),false))
test('external IDs produce stable scoped identity inputs',async()=>{ const one=await smsDedupeKey('phone-1','A','2026-01-01','first'); const retry=await smsDedupeKey('phone-1','B','2026-02-02','changed'); assert.equal(one,retry); assert.match(one,/^external:[a-f0-9]{64}$/) })
test('canonical content produces stable hash identity',async()=>{ const args=[null,'HDFCBK','2026-09-29T16:30:00+05:30','INR 650 spent']; assert.equal(await smsDedupeKey(...args),await smsDedupeKey(...args)); assert.notEqual(await smsDedupeKey(...args),await smsDedupeKey(null,'HDFCBK','2026-09-29T16:30:01+05:30','INR 650 spent')) })
