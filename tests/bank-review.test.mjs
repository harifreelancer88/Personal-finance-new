import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import BankStatementReview from '../.workflow-test-dist/bank-review.mjs'
import { defaultStatementDecision } from '../.workflow-test-dist/statement-matching.mjs'

const row = (sourceRow, extra = {}) => ({
  sourceRow,
  date: '2026-10-01',
  amount: '300.00',
  amountMinor: 30000,
  description: 'Metro payment',
  direction: 'debit',
  kind: 'expense',
  reference: '',
  categoryId: null,
  employee: null,
  employer: null,
  pension: null,
  salaryMonth: null,
  reviewReason: null,
  sourceCells: [],
  key: String(sourceRow),
  employeeMinor: null,
  employerMinor: null,
  pensionMinor: null,
  errors: [],
  candidates: [],
  status: 'new',
  ...extra,
})
const candidate = {
  id: 'existing',
  label: 'Metro SMS · expense',
  date: '2026-10-01',
  amountMinor: 30000,
  type: 'transaction',
  transactionType: 'expense',
  references: [],
  revision: 0,
}
const render = (
  rows,
  decisions = Object.fromEntries(
    rows.map((r) => [r.sourceRow, defaultStatementDecision(r, true)]),
  ),
) =>
  renderToStaticMarkup(
    createElement(BankStatementReview, {
      rows,
      decisions,
      corrections: {},
      accounts: [],
      categories: [],
      targetId: 'bank',
      busy: false,
      sourceOpen: false,
      change() {},
      choose() {},
      correct() {},
    }),
  )

test('statement table labels automatic matches and keeps candidate actions in expandable details', () => {
  const html = render([
    row(1, {
      status: 'auto_matched',
      autoMatch: {
        id: 'existing',
        reason:
          'Unique match with the same date, account, amount and direction.',
      },
      candidates: [candidate],
    }),
    row(2, {
      status: 'possible_match',
      candidates: [{ ...candidate, id: 'uncertain' }],
    }),
    row(3),
  ])
  assert.match(html, /Auto-confirmed · 1/)
  assert.match(html, /<table>/)
  assert.match(html, /Scrollable statement transactions/)
  assert.match(html, /statement-grid-row-details/)
  assert.match(html, /Needs review · 1/)
  assert.match(html, /New transactions · 1/)
  assert.match(html, /Match this/)
  assert.match(html, /Existing transaction/)
  assert.match(html, /Expand row 2/)
  assert.match(
    html,
    /aria-expanded="false" aria-controls="statement-details-2"/,
  )
  assert.match(
    html,
    /class="statement-grid-detail" hidden="" id="statement-details-2"/,
  )
  assert.match(html, /aria-pressed="true">Needs review · 1/)
  assert.doesNotMatch(html, /Review row 2 ·|Decision for row 2/)
  assert.doesNotMatch(html, /Expand row 1/) // Exceptions are the initial view.
})

test('changing a suggested match to review later moves it to exceptions and displays the alternatives', () => {
  const rows = [
    row(1, {
      status: 'auto_matched',
      autoMatch: { id: 'existing', reason: 'Same reference' },
      candidates: [candidate],
    }),
  ]
  const html = render(rows, { 1: { sourceRow: 1, action: 'pending' } })
  assert.match(html, /Auto-confirmed · 0/)
  assert.match(html, /Needs review · 1/)
  assert.match(html, /Review later/)
  assert.match(html, /Match this/)
})

test('already linked and conflicting-reference suggestions explain why manual attention is needed', () => {
  const html = render([
    row(1, {
      status: 'possible_match',
      reference: '111111111111',
      candidates: [
        { ...candidate, references: ['222222222222'], alreadyLinked: true },
      ],
    }),
  ])
  assert.match(html, /Already linked to a statement row/)
  assert.match(html, /Bank references differ/)
  assert.match(html, /disabled="">Match this/)
})

test('table paginates long statements and locks previously reconciled rows', () => {
  const html = render(
    Array.from({ length: 30 }, (_, i) =>
      row(i + 1, i === 0 ? { status: 'already_imported' } : {}),
    ),
  )
  assert.match(html, /Select this page/)
  assert.match(
    html,
    /disabled="" aria-label="Select row 1"|aria-label="Select row 1"[^>]*disabled=""/,
  )
  assert.match(html, /Expand row 25/)
  assert.doesNotMatch(html, /Expand row 26/)
  assert.match(html, /25 per page/)
  assert.match(html, /Skip selected/)
})
test('validation errors stay in needs-review instead of appearing as safe new rows', () => {
  const html = render([row(1, { errors: ['Check the amount'] })], {
    1: { sourceRow: 1, action: 'new' },
  })
  assert.match(html, /Needs review · 1/)
  assert.match(html, /Check statement fields/)
  assert.match(html, /disabled="">Add as new/)
})
test('empty review explains its state without showing actionable transactions', () => {
  const html = render([])
  assert.match(html, /No transactions match this view/)
  assert.match(html, /disabled="">Skip selected/)
  assert.doesNotMatch(html, /Expand row 1/)
})
