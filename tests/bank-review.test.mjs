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

test('simple bank review renders automatic matches collapsed and uncertain candidates as direct actions', () => {
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
  assert.match(html, /Auto-matched · 1/)
  assert.match(html, /<details class="bank-review-group"><summary>Auto-matched/)
  assert.match(html, /Needs your review · 1/)
  assert.match(html, /New transactions · 1/)
  assert.match(html, /Same|same date/)
  assert.match(html, /Match this/)
  assert.match(html, /Existing transaction/)
  assert.doesNotMatch(html, /Decision for row/)
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
  assert.match(html, /Auto-matched · 0/)
  assert.match(html, /Needs your review · 1/)
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
