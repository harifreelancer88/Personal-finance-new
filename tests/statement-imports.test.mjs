import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { defaultStatementDecision } from '../.workflow-test-dist/statement-matching.mjs'
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
  sqlite.exec(readFileSync('migrations/0013_ai_statement_imports.sql', 'utf8'))
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
          if (/^\s*(SELECT|WITH)\b/i.test(sql)) return { results: stmt.all(...values) }
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
    OPENAI_API_KEY: 'synthetic-ai-key',
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
const extraction = (rows = [], summary = {}) => ({
  statementDate: null,
  openingBalance: null,
  closingBalance: null,
  principal: null,
  employeeBalance: null,
  employerBalance: null,
  pensionBalance: null,
  schemes: [],
  rows,
  warnings: [],
  ...summary,
})
const parsedRow = (n, amount = '300.00', extra = {}) => ({
  sourceRow: n,
  date: '2026-10-01',
  salaryMonth: null,
  description: 'Shop',
  kind: 'expense',
  direction: 'debit',
  amount,
  employee: null,
  employer: null,
  pension: null,
  categoryId: 'food',
  reference: '',
  reviewReason: null,
  ...extra,
})
const bankSource = {
  fileName: 'bank.csv',
  sheetName: 'Statement',
  rows: [
    { number: 1, cells: ['Date', 'Description', 'Debit', 'Credit'] },
    { number: 2, cells: ['01/10/2026', 'Shop', '300.00', ''] },
    { number: 3, cells: ['02/10/2026', 'Salary', '', '1000.00'] },
  ],
}
const mock = async (output, fn, extra = {}) => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(init.body)
    assert.equal(body.model, 'gpt-4o-mini')
    assert.equal(body.response_format.json_schema.strict, true)
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify(
                typeof output === 'function'
                  ? output(JSON.parse(body.messages[1].content))
                  : output,
              ),
            },
          },
        ],
        usage: { prompt_tokens: 150, completion_tokens: 100 },
        ...extra,
      }),
      { headers: { 'x-request-id': 'mock-request' } },
    )
  }
  try {
    return await fn(() => calls)
  } finally {
    globalThis.fetch = original
  }
}
async function uploadAI(
  s,
  type = 'bank',
  target = 'bank',
  source = bankSource,
) {
  const r = await s.api('/statement-imports', 'POST', {
    statementType: type,
    targetId: target,
    source,
  })
  assert.equal(r.status, 201, JSON.stringify(r))
  return r.data
}
async function parseAI(s, b, output) {
  return mock(output, async () => {
    const r = await s.api('/statement-imports/' + b.id + '/parse', 'POST', {})
    assert.equal(r.status, 200, JSON.stringify(r))
    return r.data
  })
}
const commitAI = (s, r, selections, extra = {}) =>
  s.api('/statement-imports/' + r.id + '/commit', 'POST', {
    expectedTarget: r.expectedTarget,
    selections,
    confirmTarget: true,
    confirmReview: true,
    ...extra,
  })

test('AI bank preview uses existing key, confirms a match, inserts only new cash and is retry safe', async () => {
  const s = await fixture()
  const t = (
    await s.api('/transactions', 'POST', {
      transactionType: 'expense',
      description: 'Shop SMS',
      amountMinor: 30000,
      fromAccountId: 'bank',
      transactionDate: '2026-10-01',
      categoryId: 'food',
    })
  ).data.id
  const b = await uploadAI(s),
    r = await parseAI(
      s,
      b,
      extraction([
        parsedRow(2),
        parsedRow(3, '1000.00', {
          date: '2026-10-02',
          kind: 'income',
          direction: 'credit',
          description: 'Salary',
          categoryId: null,
        }),
      ]),
    )
  assert.equal(r.status, 'review')
  assert.equal(r.rows[0].status, 'auto_matched')
  assert.equal(r.rows[1].status, 'new')
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    1,
  )
  const selections = [
      { sourceRow: 2, action: 'match', matchId: t },
      { sourceRow: 3, action: 'new' },
    ],
    done = await commitAI(s, r, selections)
  assert.equal(done.status, 200, JSON.stringify(done))
  assert.equal(done.data.result.added, 1)
  assert.equal(done.data.result.matched, 1)
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    2,
  )
  assert.equal((await commitAI(s, r, selections)).status, 200)
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    2,
  )
  assert.equal(
    (await s.api('/statement-imports/' + b.id + '/audit')).data[0].request_id,
    'mock-request',
  )
  const backup = (await s.api('/recovery/export', 'POST', {})).data
  assert.equal(backup.payload.tables.statement_import_items.length, 2)
  const preview = (await s.api('/recovery/preview', 'POST', { backup })).data
  assert.equal(
    (
      await s.api('/recovery/restore', 'POST', {
        previewId: preview.id,
        confirmation: 'RESTORE MY DATA',
        recoveryDownloaded: true,
      })
    ).status,
    200,
  )
})
test('AI parse rejects hallucinated provenance and never imports on truncated output', async () => {
  const s = await fixture(),
    b = await uploadAI(s)
  await mock(extraction([parsedRow(999)]), async () =>
    assert.equal(
      (await s.api('/statement-imports/' + b.id + '/parse', 'POST', {})).status,
      502,
    ),
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    0,
  )
  await mock(
    extraction([parsedRow(2)]),
    async () =>
      assert.equal(
        (await s.api('/statement-imports/' + b.id + '/parse', 'POST', {}))
          .status,
        502,
      ),
    { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM statement_ai_attempts').get().n,
    2,
  )
  assert.equal(
    (await s.api('/statement-imports/' + b.id + '/parse', 'POST', {})).status,
    409,
  )
})
test('AI chunk processing is resumable and source context never creates duplicate movements', async () => {
  const s = await fixture(),
    source = {
      fileName: 'long.xlsx',
      sheetName: 'Bank',
      rows: Array.from({ length: 83 }, (_, i) => ({
        number: i + 1,
        cells: ['2026-10-01', 'Purchase ' + i, '1.00'],
      })),
    },
    b = await uploadAI(s, 'bank', 'bank', source)
  await mock(
    (input) =>
      extraction(
        input.BLOCK.map((row) =>
          parsedRow(row.number, '1.00', {
            description: 'Purchase ' + row.number,
          }),
        ),
      ),
    async (calls) => {
      for (let n = 0; n < 3; n++) {
        const r = await s.api(
          '/statement-imports/' + b.id + '/parse',
          'POST',
          {},
        )
        assert.equal(r.status, 200)
        assert.equal(r.data.progress, n + 1)
        if (n === 2) assert.equal(r.data.rows.length, 83)
      }
      assert.equal(calls(), 3)
      await s.api('/statement-imports/' + b.id + '/parse', 'POST', {})
      assert.equal(calls(), 3)
    },
  )
})
test('AI statement commit detects SMS arriving after review and during preparation', async () => {
  const s = await fixture(),
    b = await uploadAI(s),
    r = await parseAI(s, b, extraction([parsedRow(2)]))
  await s.api('/transactions', 'POST', {
    transactionType: 'expense',
    description: 'Late SMS',
    amountMinor: 30000,
    fromAccountId: 'bank',
    transactionDate: '2026-10-01',
  })
  assert.equal(
    (await commitAI(s, r, [{ sourceRow: 2, action: 'new' }])).status,
    409,
  )
  const fresh = (await s.api('/statement-imports/' + b.id)).data,
    original = s.db.batch
  s.db.batch = async (items) => {
    s.db.batch = original
    s.sqlite.exec(
      "UPDATE accounts SET opening_balance_minor=opening_balance_minor+100 WHERE id='bank'",
    )
    return original(items)
  }
  assert.equal(
    (
      await commitAI(s, fresh, [
        { sourceRow: 2, action: 'new', acknowledgeDuplicate: true },
      ])
    ).status,
    409,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM statement_import_items').get().n,
    0,
  )
})
test('AI retirement EPF records components, matches salary once and excludes EPS from holding and cash', async () => {
  const s = await fixture()
  s.sqlite.exec(
    `INSERT INTO investments(id,workspace_id,investment_type,name,institution,invested_minor,current_value_minor,valuation_date,basis_kind) VALUES ('epf','one','epf','EPF','EPFO',80000,100000,'2026-09-30','recorded');INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,to_account_id,transaction_date,status) VALUES ('salary','one','income','Salary',100000,'bank','2026-10-01','confirmed');INSERT INTO payroll_records(id,workspace_id,transaction_id,payroll_month,employer,gross_minor,net_minor,employee_pf_minor) VALUES ('pay','one','salary','2026-09','Employer',110000,100000,10000);INSERT INTO payroll_contributions(id,payroll_id,scheme,contributor,amount_minor) VALUES ('employer','pay','epf','employer',5000),('pension','pay','eps','employer',8000);`,
  )
  const source = {
      fileName: 'epfo.xls',
      sheetName: 'Member',
      rows: [
        { number: 1, cells: ['opening', '1000.00'] },
        {
          number: 2,
          cells: [
            '01/10/2026',
            'Sep 2026',
            '100.00',
            '50.00',
            '80.00',
            '150.00',
          ],
        },
        { number: 3, cells: ['01/10/2026', 'Interest', '150.00'] },
        {
          number: 4,
          cells: [
            'Closing employee',
            '800.00',
            'Closing employer',
            '500.00',
            'Pension',
            '80.00',
            'Total EPF',
            '1300.00',
          ],
        },
      ],
    },
    b = await uploadAI(s, 'epf', 'epf', source)
  const r = await parseAI(
    s,
    b,
    extraction(
      [
        parsedRow(2, '150.00', {
          kind: 'contribution',
          direction: 'credit',
          categoryId: null,
          salaryMonth: '2026-09',
          employee: '100.00',
          employer: '50.00',
          pension: '80.00',
        }),
        parsedRow(3, '150.00', {
          kind: 'interest',
          direction: 'credit',
          categoryId: null,
        }),
      ],
      {
        statementDate: '2026-10-01',
        openingBalance: '1000.00',
        closingBalance: '1300.00',
        employeeBalance: '800.00',
        employerBalance: '500.00',
        pensionBalance: '80.00',
      },
    ),
  )
  assert.deepEqual(r.blockers, [])
  assert.equal(r.valuation.valueMinor, 130000)
  const ee = s.sqlite
      .prepare(
        "SELECT id FROM payroll_contributions WHERE contributor='employee'",
      )
      .get().id,
    before = (await s.api('/accounts')).data.find(
      (a) => a.id === 'bank',
    ).currentBalanceMinor
  const done = await commitAI(
    s,
    r,
    [
      {
        sourceRow: 2,
        action: 'match',
        payrollMatches: [
          { component: 'employee', id: ee },
          { component: 'employer', id: 'employer' },
          { component: 'pension', id: 'pension' },
        ],
      },
      { sourceRow: 3, action: 'new' },
    ],
    { updateValuation: true },
  )
  assert.equal(done.status, 200, JSON.stringify(done))
  assert.equal(
    s.sqlite
      .prepare("SELECT current_value_minor FROM investments WHERE id='epf'")
      .get().current_value_minor,
    130000,
  )
  assert.equal(
    (await s.api('/accounts')).data.find((a) => a.id === 'bank')
      .currentBalanceMinor,
    before,
  )
  assert.equal(
    s.sqlite
      .prepare(
        'SELECT count(*) n FROM payroll_contributions WHERE credited_date IS NOT NULL',
      )
      .get().n,
    3,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM investment_activity').get().n,
    3,
  )
  const backup = (await s.api('/recovery/export', 'POST', {})).data
  const preview = (await s.api('/recovery/preview', 'POST', { backup })).data
  assert.equal(
    (
      await s.api('/recovery/restore', 'POST', {
        previewId: preview.id,
        confirmation: 'RESTORE MY DATA',
        recoveryDownloaded: true,
      })
    ).status,
    200,
  )
  assert.equal(
    s.sqlite
      .prepare(
        "SELECT investment_id FROM payroll_contributions WHERE id='pension'",
      )
      .get().investment_id,
    null,
  )
})
test('AI NPS validates units/NAV and imports a dated snapshot without an extra cash deduction', async () => {
  const s = await fixture()
  s.sqlite.exec(
    "INSERT INTO investments(id,workspace_id,investment_type,name,institution,invested_minor,current_value_minor,valuation_date) VALUES ('nps','one','nps','NPS','CRA',80000,90000,'2026-09-30')",
  )
  const source = {
      fileName: 'nps.xlsx',
      sheetName: 'Tier I',
      rows: [
        {
          number: 1,
          cells: [
            '2026-10-01',
            'Lifetime contributions',
            '900.00',
            'Holding',
            '1000.00',
          ],
        },
        { number: 2, cells: ['Scheme E', '1000.00', '10.0000', '100.0000'] },
        {
          number: 3,
          cells: ['2026-10-01', 'For Sep 2026', '10.00', '20.00', '30.00'],
        },
      ],
    },
    b = await uploadAI(s, 'nps', 'nps', source)
  const r = await parseAI(
    s,
    b,
    extraction(
      [
        parsedRow(3, '30.00', {
          kind: 'contribution',
          direction: 'credit',
          salaryMonth: '2026-09',
          employee: '10.00',
          employer: '20.00',
          categoryId: null,
        }),
      ],
      {
        statementDate: '2026-10-01',
        principal: '900.00',
        closingBalance: '1000.00',
        schemes: [
          {
            sourceRow: 2,
            name: 'Scheme E',
            value: '1000.00',
            units: '10.0000',
            nav: '100.0000',
          },
        ],
      },
    ),
  )
  assert.deepEqual(r.blockers, [])
  const done = await commitAI(s, r, [{ sourceRow: 3, action: 'new' }], {
    updateValuation: true,
  })
  assert.equal(done.status, 200, JSON.stringify(done))
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    0,
  )
  assert.equal(
    s.sqlite
      .prepare("SELECT current_value_minor FROM investments WHERE id='nps'")
      .get().current_value_minor,
    100000,
  )
  const detail = (await s.api('/investments/nps/nps')).data
  assert.equal(detail.aiStatement.extraction.closingBalance, '1000.00')
  assert.equal(
    (await s.api('/investments/nps', 'PATCH', { currentValueMinor: 123 }))
      .status,
    409,
  )
})
test('AI refuses foreign destinations and guards unsupported amounts and unreconciled totals', async () => {
  const s = await fixture()
  assert.equal(
    (
      await s.api('/statement-imports', 'POST', {
        statementType: 'bank',
        targetId: 'foreign',
        source: bankSource,
      })
    ).status,
    400,
  )
  const b = await uploadAI(s),
    r = await parseAI(
      s,
      b,
      extraction([parsedRow(2, '999.00')], {
        openingBalance: '300.00',
        closingBalance: '1000.00',
      }),
    )
  assert.equal(r.rows[0].status, 'needs_review')
  assert.ok(r.blockers.length)
  assert.equal(
    (await commitAI(s, r, [{ sourceRow: 2, action: 'new' }])).status,
    400,
  )
})
test('schema-12 backups remain readable after the AI import upgrade', async () => {
  const s = await fixture(),
    backup = (await s.api('/recovery/export', 'POST', {})).data
  backup.payload.schemaVersion = 12
  for (const key of [
    'statement_imports',
    'statement_import_items',
    'statement_ai_attempts',
  ])
    delete backup.payload.tables[key]
  backup.checksum = Buffer.from(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(backup.payload)),
    ),
  ).toString('hex')
  const p = await s.api('/recovery/preview', 'POST', { backup })
  assert.equal(p.status, 200, JSON.stringify(p))
  assert.equal(
    (
      await s.api('/recovery/restore', 'POST', {
        previewId: p.data.id,
        confirmation: 'RESTORE MY DATA',
        recoveryDownloaded: true,
      })
    ).status,
    200,
  )
})

test('AI honours daily quota and configuration before any paid request', async () => {
  const s = await fixture(),
    b = await uploadAI(s)
  s.sqlite.exec(
    "INSERT INTO ai_category_usage(workspace_id,day,requests) VALUES ('one',date('now','+5 hours','+30 minutes'),20)",
  )
  await mock(extraction([]), async (calls) => {
    assert.equal(
      (await s.api('/statement-imports/' + b.id + '/parse', 'POST', {})).status,
      429,
    )
    assert.equal(calls(), 0)
  })
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM statement_ai_attempts').get().n,
    0,
  )
  const response = await handleApiRequest(
    new Request('https://test.local/api/statement-imports/status'),
    { DB: {}, DEFAULT_WORKSPACE_ID: 'one' },
  )
  assert.equal((await response.json()).data.configured, false)
})
test('AI bank backfill preserves balance and transfers match once across account statements', async () => {
  const s = await fixture()
  s.sqlite.exec(
    "INSERT INTO accounts(id,workspace_id,name,institution,account_type,opening_balance_minor) VALUES ('second','one','Second bank','Bank','bank',0)",
  )
  const b = await uploadAI(s),
    r = await parseAI(
      s,
      b,
      extraction([
        parsedRow(2, '300.00', { kind: 'transfer', categoryId: null }),
      ]),
    ),
    before = (await s.api('/accounts')).data.find(
      (a) => a.id === 'bank',
    ).currentBalanceMinor
  const done = await commitAI(
    s,
    r,
    [{ sourceRow: 2, action: 'new', otherAccountId: 'second' }],
    { preserveBalance: true },
  )
  assert.equal(done.status, 200, JSON.stringify(done))
  assert.equal(
    (await s.api('/accounts')).data.find((a) => a.id === 'bank')
      .currentBalanceMinor,
    before,
  )
  assert.equal(
    s.sqlite
      .prepare("SELECT to_account_id FROM transactions WHERE source='import'")
      .get().to_account_id,
    'second',
  )
  const other = {
      fileName: 'second.csv',
      sheetName: 'Statement',
      rows: [{ number: 1, cells: ['2026-10-01', 'Transfer in', '300.00'] }],
    },
    second = await uploadAI(s, 'bank', 'second', other),
    match = (await s.api('/transactions?source=import')).data[0].id
  const fresh = await parseAI(
    s,
    second,
    extraction([
      parsedRow(1, '300.00', {
        kind: 'transfer',
        direction: 'credit',
        categoryId: null,
      }),
    ]),
  )
  assert.equal(fresh.rows[0].status, 'auto_matched')
  assert.equal(
    (
      await commitAI(s, fresh, [
        { sourceRow: 1, action: 'match', matchId: match },
      ])
    ).status,
    200,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    1,
  )
})
test('AI flags rows for review, accepts source-supported corrections and rejects excessive refunds atomically', async () => {
  const s = await fixture(),
    b = await uploadAI(s),
    r = await parseAI(
      s,
      b,
      extraction([
        parsedRow(2, '999.00', { reviewReason: 'Ambiguous amount' }),
      ]),
    )
  assert.equal(
    (await commitAI(s, r, [{ sourceRow: 2, action: 'new' }])).status,
    400,
  )
  const corrected = await s.api(
    '/statement-imports/' + r.id + '/review',
    'POST',
    { corrections: [{ sourceRow: 2, amount: '300.00', confirmed: true }] },
  )
  assert.equal(corrected.data.rows[0].errors.length, 0)
  assert.equal(
    (
      await commitAI(s, corrected.data, [{ sourceRow: 2, action: 'new' }], {
        corrections: [{ sourceRow: 2, amount: '300.00', confirmed: true }],
      })
    ).status,
    200,
  )
  const expense = s.sqlite
    .prepare("SELECT id FROM transactions WHERE transaction_type='expense'")
    .get().id
  const refundFile = {
      fileName: 'refund.xlsx',
      sheetName: 'Statement',
      rows: [
        { number: 1, cells: ['2026-10-02', 'Refund', '200.00'] },
        { number: 2, cells: ['2026-10-03', 'Refund 2', '200.00'] },
      ],
    },
    upload = await uploadAI(s, 'bank', 'bank', refundFile),
    refunds = await parseAI(
      s,
      upload,
      extraction([
        parsedRow(1, '200.00', {
          date: '2026-10-02',
          kind: 'refund',
          direction: 'credit',
        }),
        parsedRow(2, '200.00', {
          date: '2026-10-03',
          kind: 'refund',
          direction: 'credit',
        }),
      ]),
    )
  assert.equal(
    (
      await commitAI(s, refunds, [
        { sourceRow: 1, action: 'new', originalTransactionId: expense },
        { sourceRow: 2, action: 'new', originalTransactionId: expense },
      ])
    ).status,
    400,
  )
  assert.equal(
    s.sqlite
      .prepare(
        "SELECT count(*) n FROM transactions WHERE transaction_type='refund'",
      )
      .get().n,
    0,
  )
})
test('statement destination and holding type cannot be removed beneath an import', async () => {
  const s = await fixture(),
    b = await uploadAI(s)
  assert.ok(b.id)
  assert.throws(
    () => s.sqlite.exec("DELETE FROM accounts WHERE id='bank'"),
    /STATEMENT_DESTINATION_IN_USE/,
  )
  s.sqlite.exec(
    "INSERT INTO investments(id,workspace_id,investment_type,name,institution) VALUES ('epf','one','epf','EPF','EPFO')",
  )
  await uploadAI(s, 'epf', 'epf', bankSource)
  assert.throws(
    () =>
      s.sqlite.exec(
        "UPDATE investments SET investment_type='other' WHERE id='epf'",
      ),
    /STATEMENT_HOLDING_TYPE_LOCKED/,
  )
})

test('discarding an unimported statement clears source/audit without removing confirmed financial records', async () => {
  const s = await fixture(),
    b = await uploadAI(s),
    r = await parseAI(s, b, extraction([parsedRow(2)]))
  assert.equal(
    (await s.api('/statement-imports/' + b.id, 'DELETE', {})).status,
    200,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM statement_ai_attempts').get().n,
    0,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    0,
  )
  const again = await uploadAI(s),
    ready = await parseAI(s, again, extraction([parsedRow(2)]))
  assert.equal(
    (await commitAI(s, ready, [{ sourceRow: 2, action: 'new' }])).status,
    200,
  )
  assert.equal(
    (await s.api('/statement-imports/' + again.id, 'DELETE', {})).status,
    409,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    1,
  )
})

test('bank glossary exclusion spans AI chunks and preserves real movements after a footer', async () => {
  const s = await fixture()
  const source = {
    fileName: 'icici.xls',
    sheetName: 'Statement',
    rows: [
      { number: 1, cells: ['Date', 'Description', 'Debit', 'Credit'] },
      {
        number: 2,
        cells: ['01/10/2026', 'UPI/Shop/628717519115/ICIabc', '300.00', ''],
      },
      { number: 3, cells: ['', 'Legends Used in Account Statement', '', ''] },
      ...Array.from({ length: 42 }, (_, i) => ({
        number: i + 4,
        cells: ['', `${i + 1}. INF - Internet fund transfer`, '', ''],
      })),
      { number: 46, cells: ['Date', 'Description', 'Debit', 'Credit'] },
      { number: 47, cells: ['02/10/2026', 'Actual transfer', '', '1000.00'] },
    ],
  }
  const b = await uploadAI(s, 'bank', 'bank', source)
  await mock(
    (input) => {
      assert.ok(
        input.BLOCK.every(
          (r) => !/Legends|Internet fund transfer/.test(r.cells.join(' ')),
        ),
      )
      return input.BLOCK.some((r) => r.number === 2)
        ? extraction([
            parsedRow(2, '300.00'),
            parsedRow(4, '300.00', {
              description: 'INF - Internet fund transfer',
            }),
          ])
        : extraction([
            parsedRow(44, '300.00'),
            parsedRow(47, '1000.00', {
              date: '2026-10-02',
              direction: 'credit',
              kind: 'income',
            }),
          ])
    },
    async (calls) => {
      await s.api('/statement-imports/' + b.id + '/parse', 'POST', {})
      const r = await s.api('/statement-imports/' + b.id + '/parse', 'POST', {})
      assert.equal(r.status, 200, JSON.stringify(r))
      assert.deepEqual(
        r.data.rows.map((row) => row.sourceRow),
        [2, 47],
      )
      assert.equal(r.data.rows[0].reference, '628717519115')
      assert.deepEqual(r.data.blockers, [])
      assert.equal(calls(), 2)
    },
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    0,
  )
})

test('existing pending AI review is repaired without another paid call and commits only confirmed matches', async () => {
  const s = await fixture()
  const source = {
    fileName: 'existing.xls',
    sheetName: 'Statement',
    rows: [
      { number: 1, cells: ['Date', 'Description', 'Debit'] },
      {
        number: 2,
        cells: ['01/10/2026', 'UPI/Shop/628717519115/ICIabc', '300.00'],
      },
      { number: 3, cells: ['Legends Used in Account Statement'] },
      {
        number: 4,
        cells: ['17. INF - Internet fund transfer in linked accounts'],
      },
    ],
  }
  const b = await uploadAI(s, 'bank', 'bank', source)
  const raw = extraction(
    [
      parsedRow(2, '300.00', {
        employee: 'null',
        employer: 'N/A',
        pension: '',
        salaryMonth: 'null',
      }),
      parsedRow(4, null, {
        date: null,
        description: 'INF - Internet fund transfer',
      }),
    ],
    {
      openingBalance: 'null',
      principal: 'null',
      employeeBalance: 'null',
      employerBalance: 'null',
      pensionBalance: 'null',
    },
  )
  s.sqlite
    .prepare(
      "UPDATE statement_imports SET status='review',parsed_json=?,next_chunk=1 WHERE id=?",
    )
    .run(JSON.stringify(raw), b.id)
  const transaction = (
    await s.api('/transactions', 'POST', {
      transactionType: 'expense',
      description: 'Shop SMS',
      amountMinor: 30000,
      fromAccountId: 'bank',
      transactionDate: '2026-10-01',
      categoryId: 'food',
    })
  ).data.id
  await mock(extraction([]), async (calls) => {
    const r = (await s.api('/statement-imports/' + b.id)).data
    assert.equal(r.rows.length, 1)
    assert.equal(r.rows[0].reference, '628717519115')
    assert.equal(r.rows[0].status, 'auto_matched')
    assert.deepEqual(r.rows[0].errors, [])
    assert.deepEqual(r.blockers, [])
    assert.equal(r.extraction.principal, null)
    // Opening the review is read-only; the raw extraction and AI audit are preserved.
    assert.equal(
      s.sqlite
        .prepare('SELECT parsed_json FROM statement_imports WHERE id=?')
        .get(b.id).parsed_json,
      JSON.stringify(raw),
    )
    const checked = await s.api(
      '/statement-imports/' + b.id + '/review',
      'POST',
      { corrections: [] },
    )
    assert.deepEqual(checked.data.rows, r.rows)
    const done = await commitAI(s, r, [
      { sourceRow: 2, action: 'match', matchId: transaction },
    ])
    assert.equal(done.status, 200, JSON.stringify(done))
    assert.equal(done.data.result.matched, 1)
    assert.equal(done.data.result.added, 0)
    assert.equal(calls(), 0)
  })
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    1,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM statement_import_items').get().n,
    1,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM statement_ai_attempts').get().n,
    0,
  )
})

test('reference recovery prefers explicit columns and leaves ambiguous IDs and malformed amounts for review', async () => {
  const s = await fixture()
  const source = {
    fileName: 'references.csv',
    sheetName: 'Statement',
    rows: [
      { number: 1, cells: ['Date', 'Description', 'Debit', 'Reference No'] },
      {
        number: 2,
        cells: [
          '01/10/2026',
          'UPI/Shop/628717519115/ICIabc',
          '300.00',
          'BANK-001',
        ],
      },
      {
        number: 3,
        cells: [
          '01/10/2026',
          'UPI/Shop/628717519115/628717519116/ICIabc',
          '300.00',
          '',
        ],
      },
      { number: 4, cells: ['01/10/2026', 'No reference', '300.00', ''] },
    ],
  }
  const b = await uploadAI(s, 'bank', 'bank', source)
  const r = await parseAI(
    s,
    b,
    extraction(
      [parsedRow(2), parsedRow(3), parsedRow(4, 'not-money', { date: null })],
      { openingBalance: 'not-money' },
    ),
  )
  assert.equal(r.rows[0].reference, 'BANK-001')
  assert.equal(r.rows[1].reference, '')
  assert.equal(r.rows[2].status, 'needs_review')
  assert.ok(r.blockers.includes('Invalid summary amount: openingBalance'))
  assert.equal(
    (
      await commitAI(
        s,
        r,
        r.rows.map((row) => ({ sourceRow: row.sourceRow, action: 'new' })),
      )
    ).status,
    400,
  )
})

async function seedBankTransaction(
  s,
  id,
  date,
  amount,
  reference = '',
  account = 'bank',
  kind = 'expense',
) {
  s.sqlite
    .prepare(
      "INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,from_account_id,to_account_id,transaction_date,status,source,external_id) VALUES (?,'one',?,'Existing payment',?,?,?,?, 'confirmed','manual',?)",
    )
    .run(
      id,
      kind,
      amount,
      kind === 'expense' ? account : null,
      kind === 'expense' ? null : account,
      date,
      'sms-envelope-' + id,
    )
  if (reference)
    s.sqlite
      .prepare(
        "INSERT INTO sms_messages(id,workspace_id,dedupe_key,sender,raw_text,received_at,transaction_id,bank_reference) VALUES (?,'one',?,'BANK','Synthetic SMS','2026-10-01',?,?)",
      )
      .run('sms-' + id, 'dedupe-' + id, id, reference)
}

test('unique exact bank matches work for fractional and whole amounts, using actual SMS references', async () => {
  const s = await fixture()
  await seedBankTransaction(
    s,
    'fractional',
    '2026-10-01',
    83362,
    '628717519115',
  )
  await seedBankTransaction(s, 'whole', '2026-10-02', 20000)
  const source = {
    fileName: 'bank.csv',
    sheetName: 'Statement',
    rows: [
      {
        number: 1,
        cells: ['01/10/2026', 'UPI/Google/628717519115/ICIabc', '833.62'],
      },
      { number: 2, cells: ['02/10/2026', 'Metro', '200.00'] },
    ],
  }
  const b = await uploadAI(s, 'bank', 'bank', source)
  const r = await parseAI(
    s,
    b,
    extraction([
      parsedRow(1, '833.62'),
      parsedRow(2, '200.00', { date: '2026-10-02' }),
    ]),
  )
  assert.deepEqual(
    r.rows.map((row) => row.status),
    ['auto_matched', 'auto_matched'],
  )
  assert.equal(r.rows[0].autoMatch.id, 'fractional')
  assert.match(r.rows[0].autoMatch.reason, /unique date and amount/)
  assert.match(r.rows[1].autoMatch.reason, /unique date and amount/)
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM statement_import_items').get().n,
    0,
  )
  const done = await commitAI(
    s,
    r,
    r.rows.map((row) => ({
      sourceRow: row.sourceRow,
      action: 'match',
      matchId: row.autoMatch.id,
    })),
  )
  assert.equal(done.status, 200, JSON.stringify(done))
  assert.equal(done.data.result.matched, 2)
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    2,
  )
  assert.equal(
    s.sqlite
      .prepare("SELECT description FROM transactions WHERE id='fractional'")
      .get().description,
    'Existing payment',
  )
})

test('only unique same-date amounts auto-confirm; duplicate amounts and date differences remain manual', async () => {
  for (const scenario of [
    'duplicate payments',
    'competing rows',
    'reference conflict',
    'different date',
  ]) {
    const s = await fixture()
    await seedBankTransaction(
      s,
      'one',
      scenario === 'different date' ? '2026-10-02' : '2026-10-01',
      30000,
      scenario === 'reference conflict' ? '111111111111' : '',
    )
    if (scenario === 'duplicate payments')
      await seedBankTransaction(s, 'two', '2026-10-01', 30000)
    const b = await uploadAI(s)
    const rows = [
      parsedRow(2, '300.00', {
        reference: scenario === 'reference conflict' ? '222222222222' : '',
      }),
    ]
    if (scenario === 'competing rows')
      rows.push(parsedRow(3, '300.00', { date: '2026-10-01' }))
    if (scenario === 'competing rows')
      s.sqlite
        .prepare('UPDATE statement_imports SET source_json=? WHERE id=?')
        .run(
          JSON.stringify({
            ...bankSource,
            rows: [
              ...bankSource.rows.slice(0, 2),
              { number: 3, cells: ['01/10/2026', 'Shop again', '300.00'] },
            ],
          }),
          b.id,
        )
    const r = await parseAI(s, b, extraction(rows))
    assert.ok(
      r.rows.every((row) =>
        scenario === 'reference conflict' ? !!row.autoMatch : !row.autoMatch,
      ),
      scenario,
    )
  }
})

test('shared date and amount require manual review even with distinct references', async () => {
  const s = await fixture()
  await seedBankTransaction(s, 'one', '2026-10-01', 30000, '111111111111')
  await seedBankTransaction(s, 'two', '2026-10-01', 30000, '222222222222')
  const source = {
    ...bankSource,
    rows: [
      { number: 1, cells: ['01/10/2026', 'UPI/Shop/111111111111/a', '300.00'] },
      { number: 2, cells: ['01/10/2026', 'UPI/Shop/222222222222/b', '300.00'] },
    ],
  }
  const b = await uploadAI(s, 'bank', 'bank', source)
  const r = await parseAI(s, b, extraction([parsedRow(1), parsedRow(2)]))
  assert.deepEqual(
    r.rows.map((row) => row.autoMatch?.id),
    [undefined, undefined],
  )
  const duplicate = await commitAI(s, r, [
    { sourceRow: 1, action: 'match', matchId: 'one' },
    { sourceRow: 2, action: 'match', matchId: 'one' },
  ])
  assert.equal(duplicate.status, 400)
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM statement_import_items').get().n,
    0,
  )
})

test('partial bank imports keep unresolved rows pending and resume without recreating prior transactions', async () => {
  const s = await fixture()
  const b = await uploadAI(s)
  const r = await parseAI(
    s,
    b,
    extraction([
      parsedRow(2),
      parsedRow(3, '1000.00', {
        date: '2026-10-02',
        kind: 'income',
        direction: 'credit',
      }),
    ]),
  )
  const first = await commitAI(s, r, [
    { sourceRow: 2, action: 'new' },
    { sourceRow: 3, action: 'pending' },
  ])
  assert.equal(first.status, 200, JSON.stringify(first))
  assert.equal(first.data.status, 'review')
  assert.equal(first.data.result.pending, 1)
  assert.equal(first.data.rows[0].status, 'already_imported')
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    1,
  )
  assert.equal(
    (
      await commitAI(s, r, [
        { sourceRow: 2, action: 'new' },
        { sourceRow: 3, action: 'pending' },
      ])
    ).status,
    409,
  )
  const fresh = (await s.api('/statement-imports/' + b.id)).data
  const second = await commitAI(s, fresh, [
    { sourceRow: 2, action: 'skip' },
    { sourceRow: 3, action: 'new' },
  ])
  assert.equal(second.status, 200, JSON.stringify(second))
  assert.equal(second.data.status, 'committed')
  assert.equal(second.data.result.pending, 0)
  assert.equal(second.data.result.added, 2)
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
    2,
  )
})

test('auto matches are revalidated when SMS reference evidence changes after review', async () => {
  const s = await fixture()
  await seedBankTransaction(s, 'one', '2026-10-01', 30000, '111111111111')
  const b = await uploadAI(s)
  const r = await parseAI(
    s,
    b,
    extraction([parsedRow(2, '300.00', { reference: '111111111111' })]),
  )
  assert.equal(r.rows[0].status, 'auto_matched')
  s.sqlite
    .prepare(
      "UPDATE sms_messages SET bank_reference='222222222222' WHERE transaction_id='one'",
    )
    .run()
  assert.equal(
    (await commitAI(s, r, [{ sourceRow: 2, action: 'match', matchId: 'one' }]))
      .status,
    409,
  )
  const fresh = (await s.api('/statement-imports/' + b.id)).data
  assert.equal(fresh.rows[0].status, 'auto_matched')
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM statement_import_items').get().n,
    0,
  )
})

test('equal amounts on separate dates auto-match independently and frontend defaults need no per-row confirmation', async () => {
  const s = await fixture()
  await seedBankTransaction(s, 'one', '2026-10-01', 30000)
  await seedBankTransaction(s, 'two', '2026-10-02', 30000)
  const source = {
    ...bankSource,
    rows: [
      { number: 1, cells: ['01/10/2026', 'Shop first day', '300.00'] },
      { number: 2, cells: ['02/10/2026', 'Shop second day', '300.00'] },
      { number: 3, cells: ['03/10/2026', 'New shop', '1000.00'] },
    ],
  }
  const b = await uploadAI(s, 'bank', 'bank', source)
  const r = await parseAI(
    s,
    b,
    extraction([
      parsedRow(1),
      parsedRow(2, '300.00', { date: '2026-10-02' }),
      parsedRow(3, '1000.00', { date: '2026-10-03' }),
    ]),
  )
  assert.deepEqual(
    r.rows.map((row) => row.autoMatch?.id),
    ['one', 'two', undefined],
  )
  const decisions = r.rows.map((row) => defaultStatementDecision(row, true))
  assert.deepEqual(
    decisions.map((d) => d.action),
    ['match', 'match', 'new'],
  )
  const done = await commitAI(s, r, decisions)
  assert.equal(done.status, 200, JSON.stringify(done))
  assert.equal(done.data.result.matched, 2)
  assert.equal(done.data.result.added, 1)
})

test('wrong account, direction, type and invalid parsed rows cannot receive automatic matches', async () => {
  const s = await fixture()
  await seedBankTransaction(s, 'foreign', '2026-10-01', 30000, '', 'foreign')
  await seedBankTransaction(
    s,
    'credit',
    '2026-10-01',
    30000,
    '',
    'bank',
    'income',
  )
  const b = await uploadAI(s)
  const r = await parseAI(s, b, extraction([parsedRow(2)]))
  assert.equal(r.rows[0].autoMatch, undefined)
  assert.equal(r.rows[0].candidates.length, 0)
  await seedBankTransaction(s, 'expense', '2026-10-01', 30000)
  s.sqlite
    .prepare('UPDATE statement_imports SET parsed_json=? WHERE id=?')
    .run(
      JSON.stringify(
        extraction([parsedRow(2, '300.00', { kind: 'investment' })]),
      ),
      b.id,
    )
  const wrongType = (await s.api('/statement-imports/' + b.id)).data
  assert.equal(wrongType.rows[0].autoMatch, undefined)
  s.sqlite
    .prepare('UPDATE statement_imports SET parsed_json=? WHERE id=?')
    .run(
      JSON.stringify(
        extraction([
          parsedRow(2, '300.00', { reviewReason: 'Confirm ambiguous source' }),
        ]),
      ),
      b.id,
    )
  const flagged = (await s.api('/statement-imports/' + b.id)).data
  assert.equal(
    defaultStatementDecision(flagged.rows[0], true).action,
    'pending',
  )
  assert.equal(flagged.rows[0].autoMatch, undefined)
})

test('a previously linked transaction cannot be matched again in another statement for the same account', async () => {
  const s = await fixture()
  await seedBankTransaction(s, 'one', '2026-10-01', 30000)
  const b = await uploadAI(s)
  const r = await parseAI(s, b, extraction([parsedRow(2)]))
  await commitAI(s, r, [{ sourceRow: 2, action: 'match', matchId: 'one' }])
  const otherSource = {
    ...bankSource,
    fileName: 'other.csv',
    rows: [
      { number: 1, cells: ['01/10/2026', 'Different narration', '300.00'] },
    ],
  }
  const other = await uploadAI(s, 'bank', 'bank', otherSource)
  const fresh = await parseAI(
    s,
    other,
    extraction([
      parsedRow(1, '300.00', { description: 'Different narration' }),
    ]),
  )
  assert.equal(fresh.rows[0].autoMatch, undefined)
  assert.equal(fresh.rows[0].candidates[0].alreadyLinked, true)
  assert.equal(
    (
      await commitAI(s, fresh, [
        { sourceRow: 1, action: 'match', matchId: 'one' },
      ])
    ).status,
    400,
  )
  assert.equal(
    s.sqlite.prepare('SELECT count(*) n FROM statement_import_items').get().n,
    1,
  )
})

test('matches-only confirmation ignores balance difference without changing cash, while new rows remain blocked', async () => {
  for (const action of ['match', 'new']) {
    const s = await fixture()
    await seedBankTransaction(s, 'existing', '2026-10-01', 30000)
    const source = {
      ...bankSource,
      rows: [
        ...bankSource.rows,
        { number: 4, cells: ['Opening', '500.00'] },
        { number: 5, cells: ['Closing', '123.00'] },
      ],
    }
    const batch = await uploadAI(s, 'bank', 'bank', source)
    const r = await parseAI(
      s,
      batch,
      extraction([parsedRow(2)], {
        openingBalance: '500.00',
        closingBalance: '123.00',
      }),
    )
    assert.ok(
      r.blockers.includes(
        'Opening balance + statement movements does not match closing balance.',
      ),
    )
    const before = s.sqlite
      .prepare("SELECT opening_balance_minor FROM accounts WHERE id='bank'")
      .get().opening_balance_minor
    const result = await commitAI(s, r, [
      {
        sourceRow: 2,
        action,
        matchId: action === 'match' ? 'existing' : undefined,
        acknowledgeDuplicate: true,
      },
    ])
    assert.equal(
      result.status,
      action === 'match' ? 200 : 400,
      JSON.stringify(result),
    )
    assert.equal(
      s.sqlite.prepare('SELECT count(*) n FROM transactions').get().n,
      1,
    )
    assert.equal(
      s.sqlite
        .prepare("SELECT opening_balance_minor FROM accounts WHERE id='bank'")
        .get().opening_balance_minor,
      before,
    )
  }
})

test('custom cash-flow dates clip both boundary months and retain financial semantics and workspace isolation', async () => {
  const { api, sqlite } = await fixture()
  sqlite.exec("INSERT INTO accounts(id,workspace_id,name,institution,account_type) VALUES ('range-other','one','Other example account','Example','bank')")
  const insert = sqlite.prepare("INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,from_account_id,to_account_id,transaction_date,accounting_date,status,original_transaction_id) VALUES (?,?,?,'Synthetic range fixture',?,?,?,?,?,?,?)")
  const add = (id, date, amount, type='expense', status='confirmed', accounting=null, original=null, workspace='one') => insert.run(id,workspace,type,amount,['income','refund'].includes(type)?null:workspace==='one'?'bank':'foreign',type==='transfer'?'range-other':['income','refund'].includes(type)?'bank':null,date,accounting,status,original)
  add('before','2026-09-14',999999)
  add('start','2026-09-15',10000)
  add('september','2026-09-30',20000)
  add('refund','2026-09-28',5000,'refund','confirmed',null,'start')
  add('end','2026-10-10',30000)
  add('after','2026-10-11',999999)
  add('salary','2026-09-20',500000,'income','confirmed','2026-10-01')
  add('transfer','2026-09-21',700000,'transfer')
  add('pending','2026-09-20',88888,'expense','pending')
  add('foreign-range','2026-09-20',999999,'expense','confirmed',null,null,'two')
  const result = await api('/reports/cash-flow?fromDate=2026-09-15&toDate=2026-10-10')
  assert.equal(result.status,200)
  assert.deepEqual(result.data,[{month:'2026-09',incomeMinor:0,expenseMinor:25000},{month:'2026-10',incomeMinor:500000,expenseMinor:30000}])
  const transactions = await api('/transactions?paginated=true&status=confirmed&fromDate=2026-09-15&toDate=2026-10-10&limit=5')
  assert.equal(transactions.status,200)
  assert.equal(transactions.data.summary.incomeMinor,500000)
  assert.equal(transactions.data.summary.expenseMinor,55000)
})
test('cash-flow API refuses invalid, incomplete, reversed and unbounded date ranges', async () => {
  const { api } = await fixture()
  for (const query of ['fromDate=2026-02-30&toDate=2026-03-01','fromDate=2026-09-01','fromDate=2026-10-01&toDate=2026-09-01','fromDate=1900-01-01&toDate=2026-10-01']) {
    assert.equal((await api('/reports/cash-flow?'+query)).status,400)
  }
  assert.equal((await api('/reports/summary?fromDate=2026-09-01&toDate=2026-09-30')).status,400)
})
