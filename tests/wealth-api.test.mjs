import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handleApiRequest } from '../.wealth-test-dist/api.mjs'
function setup() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of [
    '0001_initial_schema.sql',
    '0002_allow_short_last4.sql',
    '0003_sms_ingestion.sql',
    '0004_sms_bank_reference.sql','0005_income_accounting_date.sql',
  ])
    sqlite.exec(readFileSync('migrations/' + file, 'utf8'))
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
  }
  async function api(path, method = 'GET', data, workspace = 'one') {
    const response = await handleApiRequest(
      new Request('https://test.local/api' + path, {
        method,
        ...(data === undefined
          ? {}
          : {
              body: JSON.stringify(data),
              headers: { 'Content-Type': 'application/json' },
            }),
      }),
      { ...env, DEFAULT_WORKSPACE_ID: workspace },
    )
    return { status: response.status, ...(await response.json()) }
  }
  return { api, sqlite }
}
const holding = {
  investmentType: 'mutual_fund',
  name: 'Index fund',
  institution: 'Example broker',
  investedMinor: 12501,
  currentValueMinor: 15327,
  units: 8.125,
  averageNavMinor: 1539,
  startDate: '2024-02-29',
}
test('holding writes round-trip paise and type fields, PATCH preserves absent fields, type changes clear old fields', async () => {
  const { api } = setup()
  const made = await api('/investments', 'POST', holding)
  assert.equal(made.status, 201)
  const id = made.data.id
  assert.equal(made.data.investedMinor, 12501)
  assert.equal(made.data.units, 8.125)
  const updated = await api('/investments/' + id, 'PATCH', {
    currentValueMinor: 16003,
  })
  assert.equal(updated.data.investedMinor, 12501)
  assert.equal(updated.data.currentValueMinor, 16003)
  assert.equal(updated.data.units, 8.125)
  assert.equal(
    (
      await api('/investments/' + id, 'PATCH', {
        investmentType: 'gold',
        weightGrams: 1.75,
      })
    ).data.units,
    null,
  )
  assert.equal(
    (await api('/investments/' + id, 'GET', undefined, 'two')).status,
    404,
  )
  assert.equal(
    (await api('/investments/' + id, 'DELETE', undefined, 'two')).status,
    404,
  )
  assert.equal((await api('/investments/' + id, 'DELETE')).status, 200)
  assert.deepEqual((await api('/investments')).data, [])
})
test('invalid amounts, real fields, dates and input rejected before writes', async () => {
  const { api } = setup()
  for (const patch of [
    { investedMinor: 1.1 },
    { currentValueMinor: -1 },
    { currentValueMinor: Number.MAX_SAFE_INTEGER + 1 },
    { units: '8' },
    { units: -1 },
    { startDate: '2025-02-29' },
    { maturityDate: '2026-04-31' },
    { name: '  ' },
    { institution: '' },
    { investmentType: 'unsupported' },
  ])
    assert.equal(
      (await api('/investments', 'POST', { ...holding, ...patch })).status,
      400,
      JSON.stringify(patch),
    )
  assert.deepEqual((await api('/investments')).data, [])
})
test('all eight asset classes supported and zero invested value allowed', async () => {
  const { api } = setup()
  for (const type of [
    'equity',
    'mutual_fund',
    'gold',
    'epf',
    'nps',
    'fixed_deposit',
    'crypto',
    'other',
  ])
    assert.equal(
      (
        await api('/investments', 'POST', {
          ...holding,
          investmentType: type,
          investedMinor: 0,
          currentValueMinor: 0,
          startDate: null,
        })
      ).status,
      201,
    )
})
test('activity saved separately, workspace isolated, prevents history deletion', async () => {
  const { api } = setup()
  const id = (await api('/investments', 'POST', holding)).data.id
  const event = {
    activityType: 'contribution',
    activityDate: '2026-10-12',
    amountMinor: 10001,
    description: 'Monthly contribution',
  }
  assert.equal(
    (await api('/investments/' + id + '/activity', 'POST', event, 'two'))
      .status,
    404,
  )
  assert.equal(
    (
      await api('/investments/' + id + '/activity', 'POST', {
        ...event,
        activityDate: '2026-02-30',
      })
    ).status,
    400,
  )
  assert.equal(
    (await api('/investments/' + id + '/activity', 'POST', event)).status,
    201,
  )
  assert.equal(
    (await api('/investments/' + id + '/activity')).data[0].amountMinor,
    10001,
  )
  assert.equal((await api('/investments/' + id)).data.currentValueMinor, 15327)
  assert.equal((await api('/investments/' + id, 'DELETE')).status, 409)
})
test('categories can be created, renamed, archived and restored while keeping history references', async () => {
  const { api, sqlite } = setup()
  const created = await api('/categories', 'POST', {
    name: 'Groceries',
    kind: 'expense',
  })
  assert.equal(created.status, 201)
  const id = created.data.id
  assert.equal(
    (await api('/categories', 'POST', { name: 'groceries', kind: 'both' }))
      .status,
    409,
  )
  sqlite.exec(
    "INSERT INTO accounts(id,workspace_id,name,institution,account_type) VALUES ('bank','one','Bank','ICICI','bank')",
  )
  sqlite
    .prepare(
      "INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,category_id,from_account_id,transaction_date,status) VALUES ('tx','one','expense','Shop',100,?,'bank','2026-10-12','confirmed')",
    )
    .run(id)
  assert.equal(
    (await api('/categories/' + id, 'PATCH', { isActive: false })).data
      .isActive,
    false,
  )
  assert.equal(
    sqlite.prepare("SELECT category_id FROM transactions WHERE id='tx'").get()
      .category_id,
    id,
  )
  assert.equal(
    (
      await api('/categories/' + id, 'PATCH', {
        isActive: true,
        name: 'Shopping',
      })
    ).data.name,
    'Shopping',
  )
  assert.equal(
    (await api('/categories/' + id, 'PATCH', { name: 'Other' }, 'two')).status,
    404,
  )
  assert.equal((await api('/categories/' + id, 'DELETE')).status, 405)
  assert.equal(
    (await api('/categories', 'POST', { name: 'Invalid', kind: 'other' }))
      .status,
    400,
  )
})
test('status reflects actual workspace and secret presence without returning secret value', async () => {
  const { api } = setup()
  const status = await api('/settings/status')
  assert.equal(status.data.workspaceName, 'Home')
  assert.equal(status.data.smsTokenConfigured, true)
  assert.equal(status.data.database, 'connected')
  assert.ok(!JSON.stringify(status).includes('synthetic-secret'))
  assert.equal((await api('/settings/status', 'POST', {})).status, 405)
})
