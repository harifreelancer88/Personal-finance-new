import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handleApiRequest } from '../.workflow-test-dist/api.mjs'
function setup() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of [
    '0001_initial_schema.sql',
    '0002_allow_short_last4.sql',
    '0003_sms_ingestion.sql',
    '0004_sms_bank_reference.sql',
    '0005_income_accounting_date.sql',
    '0006_category_rules.sql',
    '0007_payroll.sql',
    '0008_ai_categories.sql',
    '0009_ai_audit_details.sql',
    '0010_nps_statements.sql',
  ])
    sqlite.exec(readFileSync('migrations/' + file, 'utf8'))
  sqlite.exec(readFileSync('migrations/0011_investment_ledger.sql', 'utf8'))
  sqlite.exec(readFileSync('migrations/0012_finance_workflows.sql', 'utf8'))
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
    RECOVERY_TOKEN: 'owner-test-token',
  }
  async function api(path, method = 'GET', data, workspace = 'one') {
    const response = await handleApiRequest(
      new Request('https://test.local/api' + path, {
        method,
        ...(data === undefined
          ? {}
          : {
              body: JSON.stringify(data),
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer owner-test-token',
              },
            }),
      }),
      { ...env, DEFAULT_WORKSPACE_ID: workspace },
    )
    return { status: response.status, ...(await response.json()) }
  }
  return { api, sqlite, db }
}
async function fixture() {
  const s = setup()
  s.sqlite.exec(
    "INSERT INTO accounts(id,workspace_id,name,institution,account_type,opening_balance_minor) VALUES ('bank','one','Bank','Bank','bank',10000000),('foreign','two','Other','Bank','bank',500);INSERT INTO categories(id,workspace_id,name,kind) VALUES ('food','one','Food','expense'),('home','one','Home','expense'),('other','two','Other','expense');",
  )
  return s
}
const tx = (s, amount = 30000, date = '2026-10-01', type = 'expense') =>
  s.api('/transactions', 'POST', {
    transactionType: type,
    description: 'Shop',
    amountMinor: amount,
    fromAccountId: 'bank',
    transactionDate: date,
    categoryId: 'food',
  })
const bill = (s, extra = {}) =>
  s.api('/bills', 'POST', {
    name: 'Monthly bill',
    amountMinor: 30000,
    accountId: 'bank',
    categoryId: 'food',
    firstDueDate: '2026-01-31',
    frequency: 'monthly',
    maxOccurrences: 3,
    ...extra,
  })
test('bills link one real payment, prevent reuse, retries do not advance twice; month ends restore anchor', async () => {
  const s = await fixture(),
    p = (await bill(s)).data.id,
    t = (await tx(s)).data.id
  let list = (await s.api('/bills')).data,
    period = list.periods[0]
  const before = s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n
  assert.equal(
    (
      await s.api('/bills/' + p + '/pay', 'POST', {
        periodId: period.id,
        transactionId: t,
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await s.api('/bills/' + p + '/pay', 'POST', {
        periodId: period.id,
        transactionId: t,
      })
    ).status,
    200,
  )
  list = (await s.api('/bills')).data
  assert.equal(list.periods.length, 2)
  assert.equal(list.periods[1].due_date, '2026-02-28')
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    before,
  )
  assert.equal(
    (
      await s.api('/bills/' + p + '/pay', 'POST', {
        periodId: list.periods[1].id,
        transactionId: t,
      })
    ).status,
    409,
  )
  assert.equal(
    (
      await s.api('/bills/' + p + '/skip', 'POST', {
        periodId: list.periods[1].id,
      })
    ).status,
    200,
  )
  list = (await s.api('/bills')).data
  assert.equal(list.periods[2].due_date, '2026-03-31')
  assert.equal(list.plans[0].paid_count, 1)
  assert.equal(list.plans[0].skipped_count, 1)
  assert.equal(
    (await s.api('/transactions/' + t, 'PATCH', { amountMinor: 999 })).status,
    409,
  )
})
test('splits preserve cash and total spend; category reports and pivot allocate exact paise', async () => {
  const s = await fixture(),
    t = (await tx(s)).data.id
  const before = (await s.api('/accounts')).data[0].currentBalanceMinor
  assert.equal(
    (
      await s.api('/transactions/' + t + '/splits', 'PUT', {
        splits: [{ categoryId: 'home', amountMinor: 10001 }],
      })
    ).status,
    200,
  )
  assert.equal((await s.api('/accounts')).data[0].currentBalanceMinor, before)
  const report = (await s.api('/reports/category-breakdown?period=all')).data
  assert.equal(report.find((r) => r.categoryId === 'food').amountMinor, 19999)
  assert.equal(report.find((r) => r.categoryId === 'home').amountMinor, 10001)
  const pivot = (await s.api('/analytics/pivot?from=2026-10-01&to=2026-10-01'))
    .data
  assert.equal(pivot.totalMinor, 30000)
  assert.equal(
    (
      await s.api('/transactions/' + t + '/splits', 'PUT', {
        splits: [{ categoryId: 'other', amountMinor: 100 }],
      })
    ).status,
    400,
  )
  assert.equal(
    (await s.api('/transactions/' + t, 'PATCH', { amountMinor: 5000 })).status,
    409,
  )
})
const csv =
  'Date,Description,Debit,Credit\n01/10/2026,Shop,300.00,\n02/10/2026,Salary,,1000.00'
const upload = (s, extra = {}) =>
  s.api('/imports', 'POST', {
    csv,
    fileName: 'statement.csv',
    accountId: 'bank',
    dateFormat: 'DMY',
    mapping: { date: 0, description: 1, debit: 2, credit: 3 },
    ...extra,
  })
test('statement preview catches SMS/manual overlaps, atomic commit is retry-safe and undo preserves existing rows', async () => {
  const s = await fixture(),
    existing = (await tx(s)).data.id,
    preview = (await upload(s)).data
  assert.equal(preview.rows[0].candidates[0].id, existing)
  assert.equal(
    (
      await s.api('/imports/' + preview.id + '/commit', 'POST', {
        selectedRows: [1, 2],
      })
    ).status,
    409,
  )
  const c = await s.api('/imports/' + preview.id + '/commit', 'POST', {
    selectedRows: [2],
  })
  assert.equal(c.data.imported, 1)
  assert.equal(
    (
      await s.api('/imports/' + preview.id + '/commit', 'POST', {
        selectedRows: [2],
      })
    ).data.alreadyCommitted,
    true,
  )
  assert.equal(
    (await s.api('/imports/' + preview.id + '/undo', 'POST', {})).status,
    200,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    1,
  )
  assert.ok(
    s.sqlite.prepare('SELECT id FROM transactions WHERE id=?').get(existing),
  )
})
test('historical backfill explicitly preserves balance; undo reverses only its opening-balance effect', async () => {
  const s = await fixture(),
    p = (await upload(s, { preserveBalance: true })).data,
    before = (await s.api('/accounts')).data.find(
      (a) => a.id === 'bank',
    ).currentBalanceMinor
  assert.equal(
    (
      await s.api('/imports/' + p.id + '/commit', 'POST', {
        selectedRows: [1, 2],
      })
    ).data.balanceChangeMinor,
    0,
  )
  assert.equal(
    (await s.api('/accounts')).data.find((a) => a.id === 'bank')
      .currentBalanceMinor,
    before,
  )
  await s.api('/imports/' + p.id + '/undo', 'POST', {})
  assert.equal(
    (await s.api('/accounts')).data.find((a) => a.id === 'bank')
      .currentBalanceMinor,
    before,
  )
})
test('recovery is validated, stale previews rejected, and a complete round trip preserves split/payment history', async () => {
  const s = await fixture(),
    t = (await tx(s)).data.id
  await s.api('/transactions/' + t + '/splits', 'PUT', {
    splits: [{ categoryId: 'home', amountMinor: 12345 }],
  })
  const backup = (await s.api('/recovery/export', 'POST', {})).data
  assert.equal(backup.payload.tables.transaction_splits.length, 1)
  const preview = await s.api('/recovery/preview', 'POST', { backup })
  assert.equal(preview.status, 200)
  await tx(s, 100)
  assert.equal(
    (
      await s.api('/recovery/restore', 'POST', {
        previewId: preview.data.id,
        confirmation: 'RESTORE MY DATA',
        recoveryDownloaded: true,
      })
    ).status,
    409,
  )
  const next = (await s.api('/recovery/preview', 'POST', { backup })).data
  const restored = await s.api('/recovery/restore', 'POST', {
    previewId: next.id,
    confirmation: 'RESTORE MY DATA',
    recoveryDownloaded: true,
  })
  assert.equal(restored.status, 200, JSON.stringify(restored))
  assert.equal(
    s.sqlite
      .prepare("SELECT count(*) n FROM transactions WHERE workspace_id='one'")
      .get().n,
    1,
  )
  assert.equal(
    s.sqlite.prepare('SELECT amount_minor FROM transaction_splits').get()
      .amount_minor,
    12345,
  )
  assert.equal(
    s.sqlite
      .prepare("SELECT opening_balance_minor FROM accounts WHERE id='foreign'")
      .get().opening_balance_minor,
    500,
  )
  const bad = structuredClone(backup)
  bad.payload.tables.accounts[0].name = 'edited'
  assert.equal(
    (await s.api('/recovery/preview', 'POST', { backup: bad })).status,
    400,
  )
})
test('investment bills fund the holding once and preserve net worth; wrong amounts need confirmation', async () => {
  const s = await fixture()
  s.sqlite.exec(
    "INSERT INTO investments(id,workspace_id,investment_type,name,institution,invested_minor,current_value_minor,basis_kind,valuation_date) VALUES ('grt','one','other','GRT','GRT',27000000,27000000,'actual_cost','2026-09-30')",
  )
  const p = (
      await bill(s, {
        transactionType: 'investment',
        investmentId: 'grt',
        firstDueDate: '2026-10-01',
        maxOccurrences: null,
      })
    ).data.id,
    period = (await s.api('/bills')).data.periods[0],
    t = (await tx(s, 30001, '2026-10-01', 'investment')).data.id,
    before = (await s.api('/net-worth')).data
  assert.equal(
    (
      await s.api('/bills/' + p + '/pay', 'POST', {
        periodId: period.id,
        transactionId: t,
      })
    ).status,
    400,
  )
  assert.equal(
    (
      await s.api('/bills/' + p + '/pay', 'POST', {
        periodId: period.id,
        transactionId: t,
        acceptAmountDifference: true,
      })
    ).status,
    200,
  )
  const after = (await s.api('/net-worth')).data
  assert.equal(after.investmentsMinor, before.investmentsMinor + 30001)
  assert.equal(after.awaitingIncludedMinor, 30001)
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM investment_payments').get().n,
    1,
  )
  assert.equal(
    (
      await s.api('/bills/' + p + '/pay', 'POST', {
        periodId: period.id,
        transactionId: t,
      })
    ).status,
    200,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM investment_payments').get().n,
    1,
  )
})
test('bill request identity is stable; foreign accounts and transactions cannot settle a bill', async () => {
  const s = await fixture(),
    requestId = 'stable-request-123456789',
    p = await bill(s, { requestId })
  assert.equal((await bill(s, { requestId })).data.id, p.data.id)
  assert.equal((await bill(s, { requestId, name: 'different' })).status, 409)
  assert.equal((await bill(s, { accountId: 'foreign' })).status, 400)
  assert.equal(
    (
      await s.api('/bills/' + p.data.id + '/pay', 'POST', {
        periodId: (await s.api('/bills')).data.periods[0].id,
        transactionId: 'foreign',
      })
    ).status,
    400,
  )
})
test('category refunds follow the allocated category and reports drill down without double counting', async () => {
  const s = await fixture(),
    t = (await tx(s, 30003)).data.id
  await s.api('/transactions/' + t + '/splits', 'PUT', {
    splits: [{ categoryId: 'home', amountMinor: 10001 }],
  })
  const refund = await s.api('/transactions', 'POST', {
    transactionType: 'refund',
    description: 'Home refund',
    amountMinor: 999,
    categoryId: 'home',
    toAccountId: 'bank',
    transactionDate: '2026-10-02',
    originalTransactionId: t,
  })
  assert.equal(refund.status, 201)
  assert.equal(
    (await s.api('/transactions/' + t + '/splits', 'PUT', { splits: [] }))
      .status,
    409,
  )
  const p = (await s.api('/analytics/pivot?from=2026-10-01&to=2026-10-02')).data
  assert.equal(p.totalMinor, 29004)
  assert.equal(p.rows.find((r) => r.key === 'home').totalMinor, 9002)
  assert.equal(p.rows.find((r) => r.key === 'food').totalMinor, 20002)
  const report = (await s.api('/reports/sankey?period=all')).data
  assert.equal(
    report.destinations.find((r) => r.label === 'Home').amountMinor,
    9002,
  )
  assert.equal(
    (await s.api('/reports/summary?period=all')).data.totalExpenseMinor,
    p.totalMinor,
  )
  const m = (
    await s.api(
      '/analytics/pivot?from=2026-10-01&to=2026-10-02&dimension=merchant',
    )
  ).data
  assert.equal(m.rows.length, 1)
  assert.equal(m.totalMinor, p.totalMinor)
  assert.equal(m.rows[0].entries.length, 2)
})
test('import rechecks a new payment arriving after preview and refuses undo after edits', async () => {
  const s = await fixture(),
    p = (await upload(s)).data
  await tx(s)
  assert.equal(
    (await s.api('/imports/' + p.id + '/commit', 'POST', { selectedRows: [1] }))
      .status,
    409,
  )
  assert.equal(
    (await s.api('/imports/' + p.id)).data.rows[0].candidates.length,
    1,
  )
  assert.equal(
    (
      await s.api('/imports/' + p.id + '/commit', 'POST', {
        selectedRows: [1],
        acceptDuplicateRows: [1],
      })
    ).status,
    200,
  )
  const imported = s.sqlite
    .prepare('SELECT transaction_id id FROM import_rows')
    .get().id
  await s.api('/transactions/' + imported, 'PATCH', {
    description: 'Corrected by user',
  })
  assert.equal(
    (await s.api('/imports/' + p.id + '/undo', 'POST', {})).status,
    409,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    2,
  )
})
test('CSV rejects invalid calendar dates and ambiguous amounts, preserves two distinct same-value purchases', async () => {
  const s = await fixture(),
    p = (
      await upload(s, {
        csv: 'Date,Description,Debit,Credit\n31/02/2026,Bad,10.00,\n01/10/2026,One,200.00,\n01/10/2026,Two,200.00,',
      })
    ).data
  assert.ok(p.rows[0].error)
  assert.equal(
    (
      await s.api('/imports/' + p.id + '/commit', 'POST', {
        selectedRows: [1, 2],
      })
    ).status,
    400,
  )
  assert.equal(
    (
      await s.api('/imports/' + p.id + '/commit', 'POST', {
        selectedRows: [2, 3],
      })
    ).data.imported,
    2,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    2,
  )
})
test('restore round trip preserves payroll evidence, NPS history, protected valuations, bills and imports', async () => {
  const s = await fixture()
  s.sqlite.exec(
    `INSERT INTO investments(id,workspace_id,investment_type,name,institution,invested_minor,current_value_minor,basis_kind,valuation_date) VALUES ('epf','one','epf','EPF','EPFO',1000,1000,'recorded','2026-10-01'),('nps','one','nps','NPS','NPS',2000,2500,'actual_cost','2026-10-01');INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,to_account_id,transaction_date,status) VALUES ('salary','one','income','Salary',30000,'bank','2026-10-01','confirmed');INSERT INTO payroll_records(id,workspace_id,transaction_id,payroll_month,employer,gross_minor,net_minor,employee_pf_minor) VALUES ('payroll','one','salary','2026-09','Example',31000,30000,1000);INSERT INTO investment_activity(id,investment_id,activity_type,activity_date,amount_minor,description) VALUES ('activity','epf','contribution','2026-10-01',1000,'Passbook');UPDATE payroll_contributions SET investment_id='epf',activity_id='activity',credited_date='2026-10-01',statement_reference='verified passbook' WHERE payroll_id='payroll';INSERT INTO investment_valuations(id,investment_id,valuation_date,invested_minor,value_minor,basis_kind,source) VALUES ('val','epf','2026-10-01',1000,1000,'recorded','Passbook');INSERT INTO nps_statements(id,investment_id,workspace_id,account_hash,content_hash,statement_date,data_json) VALUES ('statement','nps','one','account-hash','content-hash','2026-10-01','{}');`,
  )
  const imp = (
    await upload(s, {
      csv: 'Date,Description,Debit,Credit\n02/10/2026,Shop,300.01,',
    })
  ).data
  await s.api('/imports/' + imp.id + '/commit', 'POST', { selectedRows: [1] })
  const b = (await bill(s, { firstDueDate: '2026-10-01' })).data.id,
    period = (await s.api('/bills')).data.periods.find((p) => p.plan_id === b)
  const t = s.sqlite
    .prepare('SELECT transaction_id id FROM import_rows')
    .get().id
  await s.api('/bills/' + b + '/pay', 'POST', {
    periodId: period.id,
    transactionId: t,
    acceptAmountDifference: true,
  })
  const backup = (await s.api('/recovery/export', 'POST', {})).data
  const preview = (await s.api('/recovery/preview', 'POST', { backup })).data
  const r = await s.api('/recovery/restore', 'POST', {
    previewId: preview.id,
    confirmation: 'RESTORE MY DATA',
    recoveryDownloaded: true,
  })
  assert.equal(r.status, 200, JSON.stringify(r))
  assert.equal(
    s.sqlite
      .prepare('SELECT statement_reference FROM payroll_contributions')
      .get().statement_reference,
    'verified passbook',
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM investment_valuations').get().n,
    1,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM nps_statements').get().n,
    1,
  )
  assert.equal(
    s.sqlite
      .prepare("SELECT count(*) n FROM bill_periods WHERE status='paid'")
      .get().n,
    1,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM recovery_context').get().n,
    0,
  )
})
test('failed restore rolls back deletion and never disables valuation protection', async () => {
  const s = await fixture()
  await tx(s)
  const backup = (await s.api('/recovery/export', 'POST', {})).data,
    preview = (await s.api('/recovery/preview', 'POST', { backup })).data
  s.sqlite.exec(
    "CREATE TRIGGER fail_restore BEFORE INSERT ON accounts WHEN EXISTS(SELECT 1 FROM recovery_context) BEGIN SELECT RAISE(ABORT,'injected failure');END;",
  )
  assert.equal(
    (
      await s.api('/recovery/restore', 'POST', {
        previewId: preview.id,
        confirmation: 'RESTORE MY DATA',
        recoveryDownloaded: true,
      })
    ).status,
    500,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    1,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM recovery_context').get().n,
    0,
  )
})
test('backup and restore require owner authorization and reject another workspace', async () => {
  const s = await fixture()
  const response = await handleApiRequest(
    new Request('https://test.local/api/recovery/export', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    }),
    { DB: {}, DEFAULT_WORKSPACE_ID: 'one', RECOVERY_TOKEN: 'real-token' },
  )
  assert.equal(response.status, 403)
  const backup = (await s.api('/recovery/export', 'POST', {})).data
  assert.equal(
    (await s.api('/recovery/preview', 'POST', { backup }, 'two')).status,
    400,
  )
  assert.equal(
    (
      await s.api('/bills', 'POST', {
        name: 'X',
        amountMinor: 1,
        accountId: 'bank',
        firstDueDate: '2026-99-99',
      })
    ).status,
    400,
  )
})
test('an SMS-equivalent transaction inserted between duplicate check and commit aborts the whole import', async () => {
  const s = await fixture(),
    p = (await upload(s)).data,
    original = s.db.batch
  s.db.batch = async (statements) => {
    s.db.batch = original
    s.sqlite
      .prepare(
        "INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,from_account_id,transaction_date,status,source) VALUES ('arrived','one','expense','New SMS',30000,'bank','2026-10-01','confirmed','sms')",
      )
      .run()
    return original(statements)
  }
  assert.equal(
    (
      await s.api('/imports/' + p.id + '/commit', 'POST', {
        selectedRows: [1, 2],
      })
    ).status,
    409,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM import_rows').get().n,
    0,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    1,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM import_commit_guards').get().n,
    0,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM workflow_claims').get().n,
    0,
  )
})

test('backup registry tracks every restorable column and excludes only operational tables', async () => {
  const { BACKUP_TABLES } =
    await import('../.workflow-test-dist/backup-registry.mjs')
  const s = setup()
  const excluded = new Set([
    'workspaces',
    'd1_migrations',
    'recovery_context',
    'recovery_payloads',
    'restore_previews',
    'workflow_claims',
    'import_commit_guards',
  ])
  const tables = s.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((r) => r.name)
  assert.deepEqual(
    tables.filter((t) => !excluded.has(t)).sort(),
    BACKUP_TABLES.map((t) => t.name).sort(),
  )
  for (const table of BACKUP_TABLES) {
    assert.deepEqual(
      s.sqlite
        .prepare('PRAGMA table_info(' + table.name + ')')
        .all()
        .map((c) => ({
          name: c.name,
          type: c.type,
          required: Boolean(c.notnull),
          pk: Boolean(c.pk),
        })),
      table.columns,
    )
  }
})
test('CSV parser preserves quoted delimiters/newlines, exact INR paise and the 500-row boundary', async () => {
  const { parseCsv, parseMoney, parseStatementDate } =
    await import('../.workflow-test-dist/statement-parser.mjs')
  assert.deepEqual(
    parseCsv(
      '\uFEFFDate,"Description; name",Amount\r\n01/10/2026,"A, B\nC ""shop""",-10.25',
    ),
    [
      ['Date', 'Description; name', 'Amount'],
      ['01/10/2026', 'A, B\nC "shop"', '-10.25'],
    ],
  )
  assert.equal(parseMoney('₹1,25,000.50'), 12500050)
  assert.equal(parseMoney('(1,234.01)'), -123401)
  assert.equal(parseMoney('1,23.00'), null)
  assert.equal(parseMoney('1.001'), null)
  assert.equal(parseStatementDate('29/02/2025', 'DMY'), null)
  assert.equal(parseStatementDate('02/10/2026', 'MDY'), '2026-02-10')
  assert.throws(() => parseCsv('a,b\n"value"junk,2'))
  assert.equal(parseCsv('a,b\n' + '1,2\n'.repeat(500)).length, 501)
  assert.throws(() => parseCsv('a,b\n' + '1,2\n'.repeat(501)))
})
test('undo rejects a last-moment edit atomically and preserves its opening adjustment', async () => {
  const s = await fixture(),
    p = (await upload(s, { preserveBalance: true })).data
  await s.api('/imports/' + p.id + '/commit', 'POST', { selectedRows: [1, 2] })
  const original = s.db.batch,
    opening = s.sqlite
      .prepare("SELECT opening_balance_minor n FROM accounts WHERE id='bank'")
      .get().n
  s.db.batch = async (statements) => {
    s.db.batch = original
    s.sqlite.exec(
      "UPDATE transactions SET category_revision=category_revision+1 WHERE source='import'",
    )
    return original(statements)
  }
  assert.equal(
    (await s.api('/imports/' + p.id + '/undo', 'POST', {})).status,
    409,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM import_rows').get().n,
    2,
  )
  assert.equal(
    s.sqlite
      .prepare("SELECT opening_balance_minor n FROM accounts WHERE id='bank'")
      .get().n,
    opening,
  )
})
test('large proportional refunds keep exact paise without floating-point multiplication', async () => {
  const { refundAllocations } =
    await import('../.workflow-test-dist/category-allocations.mjs')
  const a = 4503599627370495,
    b = 4503599627370494,
    amount = 9007199254740988
  const result = refundAllocations(
    amount,
    [
      { categoryId: 'a', categoryName: 'A', amountMinor: a },
      { categoryId: 'b', categoryName: 'B', amountMinor: b },
    ],
    null,
  )
  assert.equal(
    result[0].amountMinor,
    -Number((BigInt(amount) * BigInt(a)) / BigInt(a + b)),
  )
  assert.equal(
    result.reduce((n, r) => n + r.amountMinor, 0),
    -amount,
  )
})
