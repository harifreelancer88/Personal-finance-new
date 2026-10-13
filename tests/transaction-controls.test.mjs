import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handleApiRequest } from '../.transaction-controls-test-dist/api.mjs'
import {
  monthBounds,
  shiftMonth,
  monthLabel,
  validMonthKey,
} from '../.transaction-controls-test-dist/month.mjs'
function setup() {
  const db = new DatabaseSync(':memory:')
  for (const file of [
    '0001_initial_schema.sql',
    '0002_allow_short_last4.sql',
    '0003_sms_ingestion.sql',
    '0004_sms_bank_reference.sql','0005_income_accounting_date.sql','0006_category_rules.sql','0007_payroll.sql','0008_ai_categories.sql',
  ])
    db.exec(readFileSync('migrations/' + file, 'utf8'))
  db.exec(
    "INSERT INTO workspaces(id,name) VALUES('one','Home'),('two','Other'); INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES('bank','one','Bank','ICICI','bank','981'),('target','one','Target','ICICI','bank','973'),('foreign-bank','two','Foreign Bank','ICICI','bank','1234'); INSERT INTO categories(id,workspace_id,name,kind,is_active) VALUES('groceries','one','Groceries','expense',1),('archived','one','Archived','expense',0),('foreign','two','Foreign','expense',1)",
  )
  const adapter = {
    prepare(sql) {
      let args = []
      const stmt = db.prepare(sql)
      return {
        bind(...values) {
          args = values
          return this
        },
        async first() {
          return stmt.get(...args) ?? null
        },
        async all() {
          return { results: stmt.all(...args) }
        },
        async run() {
          return { meta: { changes: Number(stmt.run(...args).changes) } }
        },
      }
    },
    async batch(statements) {
      db.exec('BEGIN')
      try {
        const results = []
        for (const stmt of statements) results.push(await stmt.run())
        db.exec('COMMIT')
        return results
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
  const env = {
    DB: adapter,
    DEFAULT_WORKSPACE_ID: 'one',
    SMS_INGEST_TOKEN: 'test-token',
  }
  async function api(path, method = 'GET', body, workspace = 'one') {
    const response = await handleApiRequest(
      new Request('https://test.invalid/api' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { ...env, DEFAULT_WORKSPACE_ID: workspace },
    )
    return { status: response.status, ...(await response.json()) }
  }
  const add = (id, workspace = 'one') =>
    db
      .prepare(
        "INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,transaction_date,status,source,from_account_id,notes) VALUES (?,?,'expense','Shop',101,'2026-10-12','confirmed','manual',?,?)",
      )
      .run(
        id,
        workspace,
        workspace === 'one' ? 'bank' : 'foreign-bank',
        workspace === 'one' ? '[sms:auto-confirmed]' : null,
      )
  return { db, api, add }
}
const sms =
  'ICICI Bank Acct XX981 debited for Rs 30.00 on 12-Oct-26; METRO TRANSIT credited. UPI:123456789012. Call 18002662 for dispute.'
const send = (api, message = sms, externalId = 'direct') =>
  api('/ingest/sms', 'POST', {
    message,
    externalId,
    sender: 'ICICI',
    receivedAt: '2026-10-12T15:00:00Z',
  })
test('manual and SMS deletion scoped to workspace, preserves raw SMS and prevents replay under same or new delivery identity', async () => {
  const { api, db, add } = setup()
  add('manual')
  assert.equal(
    (await api('/transactions/manual', 'DELETE', undefined, 'two')).status,
    404,
  )
  assert.equal((await api('/transactions/manual', 'DELETE')).status, 200)
  const first = await send(api)
  const id = first.data.transactionId
  assert.ok(id)
  assert.equal((await api('/transactions/' + id, 'DELETE')).status, 200)
  assert.equal(db.prepare('SELECT count(*) AS n FROM transactions').get().n, 0)
  assert.equal(
    db.prepare('SELECT parse_status,transaction_id FROM sms_messages').get()
      .parse_status,
    'deleted',
  )
  assert.equal((await send(api)).data.parseStatus, 'deleted')
  assert.equal(
    (await send(api, sms, 'different-path')).data.parseStatus,
    'deleted',
  )
  assert.equal(db.prepare('SELECT count(*) AS n FROM transactions').get().n, 0)
})
test('counterpart bank alert cannot recreate a deleted transfer', async () => {
  const { api, db } = setup()
  const debit =
    'ICICI Bank Acct XXX981 debited with INR 1.10 on 12-Oct-26. Acct XXX973 credited.UPI:987654321012.'
  const credit =
    'Dear Customer, Acct XX973 is credited with Rs 1.10 on 12-Oct-26 from OTHER PERSON. UPI:987654321012-ICICI Bank.'
  const id = (await send(api, debit, 'debit')).data.transactionId
  await api('/transactions/' + id, 'DELETE')
  assert.equal((await send(api, credit, 'credit')).data.parseStatus, 'deleted')
  assert.equal(db.prepare('SELECT count(*) AS n FROM transactions').get().n, 0)
})
test('linked refunds must be removed before original expense deletion', async () => {
  const { api, db, add } = setup()
  add('original')
  db.exec(
    "INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,transaction_date,status,to_account_id,original_transaction_id) VALUES ('refund','one','refund','Refund',100,'2026-10-13','confirmed','bank','original')",
  )
  assert.equal((await api('/transactions/original', 'DELETE')).status, 409)
  assert.equal((await api('/transactions/refund', 'DELETE')).status, 200)
  assert.equal((await api('/transactions/original', 'DELETE')).status, 200)
})
test('batch category assignment updates 100 selections with low parameter count, clears auto ownership and retains money/status', async () => {
  const { api, db, add } = setup()
  const ids = Array.from({ length: 100 }, (_, i) => 'tx-' + i)
  ids.forEach((id) => add(id))
  const result = await api('/transactions/categories', 'PATCH', {
    transactionIds: ids,
    categoryId: 'groceries',
  })
  assert.equal(result.status, 200)
  assert.equal(result.data.updatedCount, 100)
  const rows = db.prepare('SELECT * FROM transactions').all()
  assert.ok(
    rows.every(
      (r) =>
        r.category_id === 'groceries' &&
        r.amount_minor === 101 &&
        r.status === 'confirmed' &&
        r.notes === null,
    ),
  )
  assert.equal(
    (
      await api('/transactions/categories', 'PATCH', {
        transactionIds: ids,
        categoryId: null,
      })
    ).status,
    200,
  )
  assert.ok(
    db
      .prepare('SELECT * FROM transactions')
      .all()
      .every((r) => r.category_id === null),
  )
})
test('batch invalid selection, foreign IDs and inactive categories change no rows', async () => {
  const { api, db, add } = setup()
  add('mine')
  add('other', 'two')
  for (const body of [
    { transactionIds: ['mine', 'other'], categoryId: 'groceries' },
    { transactionIds: ['mine', 'missing'], categoryId: 'groceries' },
    { transactionIds: ['mine'], categoryId: 'foreign' },
    { transactionIds: ['mine'], categoryId: 'archived' },
    { transactionIds: ['mine', 'mine'], categoryId: 'groceries' },
    { transactionIds: [], categoryId: 'groceries' },
    { transactionIds: ['mine'] },
  ]) {
    assert.ok(
      (await api('/transactions/categories', 'PATCH', body)).status >= 400,
    )
    assert.equal(
      db.prepare("SELECT category_id FROM transactions WHERE id='mine'").get()
        .category_id,
      null,
    )
  }
})
test('month periods handle February leap years and previous/next across year boundaries', () => {
  assert.deepEqual(monthBounds('2024-02'), {
    fromDate: '2024-02-01',
    toDate: '2024-02-29',
  })
  assert.equal(monthBounds('2026-02').toDate, '2026-02-28')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(monthLabel('2026-10'), "Oct '26")
  assert.equal(validMonthKey('2026-13'), false)
  assert.equal(validMonthKey('2026-00'), false)
})

test('income accounting date saves independently, survives status/category edits and clears on type change', async () => {
  const {api, db} = setup()
  const made = await api('/transactions','POST',{transactionType:'income',description:'Salary',amountMinor:100000,toAccountId:'bank',fromAccountId:null,transactionDate:'2026-09-29',accountingDate:'2026-10-01',categoryId:null,notes:null})
  assert.equal(made.status,201)
  const id=made.data.id
  assert.equal(made.data.transactionDate,'2026-09-29')
  assert.equal(made.data.accountingDate,'2026-10-01')
  assert.equal((await api('/transactions/'+id,'PATCH',{status:'pending'})).data.accountingDate,'2026-10-01')
  assert.equal((await api('/transactions/'+id,'PATCH',{status:'confirmed'})).data.accountingDate,'2026-10-01')
  const balance=()=>db.prepare("SELECT SUM(amount_minor) AS n FROM transactions WHERE to_account_id='bank' AND status='confirmed'").get().n
  assert.equal(balance(),100000)
  assert.equal((await api('/transactions/'+id,'PATCH',{accountingDate:null})).data.accountingDate,null)
  assert.equal(balance(),100000)
  await api('/transactions/'+id,'PATCH',{accountingDate:'2026-10-01'})
  const changed=await api('/transactions/'+id,'PATCH',{transactionType:'refund'})
  assert.equal(changed.status,200);assert.equal(changed.data.accountingDate,null)
})
test('accounting date rejects impossible dates and non-income overrides',async()=>{
  const {api}=setup()
  const body={transactionType:'income',description:'Salary',amountMinor:100000,toAccountId:'bank',transactionDate:'2026-09-29'}
  for(const date of ['2026-02-29','2026-13-01','2026-04-31','tomorrow',20261001]) assert.equal((await api('/transactions','POST',{...body,accountingDate:date})).status,400)
  assert.equal((await api('/transactions','POST',{...body,transactionType:'refund',accountingDate:'2026-10-01'})).status,400)
  const normal=await api('/transactions','POST',body)
  assert.equal(normal.data.accountingDate,null)
})

test('SMS retry preserves a user-set accounting date and original receipt date',async()=>{
  const {api,db}=setup()
  const message='ICICI Bank Acct XX981 credited for Rs 50000.00 on 29-Sep-26; Salary credited. UPI:123456789012.'
  const delivered=await send(api,message,'salary-sms')
  const id=delivered.data.transactionId
  assert.ok(id)
  const changed=await api('/transactions/'+id,'PATCH',{accountingDate:'2026-10-01'})
  assert.equal(changed.status,200)
  await send(api,message,'salary-sms')
  const row=db.prepare('SELECT * FROM transactions WHERE id=?').get(id)
  assert.equal(row.transaction_date,'2026-09-29');assert.equal(row.accounting_date,'2026-10-01')
  assert.equal(db.prepare('SELECT count(*) AS n FROM transactions').get().n,1)
})
