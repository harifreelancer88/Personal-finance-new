import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../api/client'
import {
  write,
  lookups,
  errorText,
  rupees,
  type Lookup,
} from '../api/workflows'
import BankStatementReview from '../components/workflows/BankStatementReview'
import {
  defaultStatementDecision,
  importBlockers,
} from '../../shared/statement-matching'
import { WorkflowShell, Feedback } from '../components/workflows/WorkflowShell'
import { readStatementFile, type StatementSheet } from '../lib/statement-upload'
import type {
  StatementReview,
  StatementType,
  StatementSelection,
  ParsedStatementRow,
  StatementKind,
  StatementExtraction,
} from '../../shared/statement-import'
const ManualImports = lazy(() => import('./ManualImportsPage'))
type Choices = {
  accounts: Lookup[]
  categories: Lookup[]
  investments: Lookup[]
}
interface History {
  id: string
  file_name: string
  statement_type: string
  status: string
  created_at: string
}
type Correction = Partial<ParsedStatementRow> & {
  sourceRow: number
  confirmed?: boolean
}
export default function ImportsPage() {
  const [mode, setMode] = useState('ai'),
    [choices, setChoices] = useState<Choices>({
      accounts: [],
      categories: [],
      investments: [],
    }),
    [configured, setConfigured] = useState<boolean>(),
    [type, setType] = useState<StatementType>('bank'),
    [target, setTarget] = useState(''),
    [filename, setFilename] = useState(''),
    [sheets, setSheets] = useState<StatementSheet[]>([]),
    [sheet, setSheet] = useState(''),
    [review, setReview] = useState<StatementReview>(),
    [history, setHistory] = useState<History[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [decisions, setDecisions] = useState<Record<number, StatementSelection>>(
      {},
    ),
    [corrections, setCorrections] = useState<Record<number, Correction>>({}),
    [summary, setSummary] = useState<Partial<StatementExtraction>>({}),
    [preserve, setPreserve] = useState(false),
    [updateValue, setUpdateValue] = useState(false),
    [confirmTarget, setConfirmTarget] = useState(false),
    [confirmReview, setConfirmReview] = useState(false),
    [filter, setFilter] = useState('all'),
    [page, setPage] = useState(0),
    [audit, setAudit] = useState<unknown>(),
    [sourceOpen, setSourceOpen] = useState(false),
    [summaryConfirmed, setSummaryConfirmed] = useState(false),
    [validationDirty, setValidationDirty] = useState(false)
  const alive = useRef(true),
    active = useRef(0)
  useEffect(() => {
    alive.current = true
    const c = new AbortController()
    Promise.all([
      lookups(),
      apiRequest<{ configured: boolean }>('/api/statement-imports/status', {
        signal: c.signal,
      }),
      apiRequest<History[]>('/api/statement-imports', { signal: c.signal }),
    ])
      .then(([l, s, h]) => {
        if (alive.current) {
          setChoices(l)
          setConfigured(s.configured)
          setHistory(h)
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e))
      })
    return () => {
      alive.current = false
      active.current++
      c.abort()
    }
  }, [])
  const refreshHistory = async () =>
    setHistory(await apiRequest<History[]>('/api/statement-imports'))
  const apply = (r: StatementReview, reset = true) => {
    setReview(r)
    if (reset) {
      setPage(0)
      setCorrections({})
      setSummary({})
      setSummaryConfirmed(false)
      setValidationDirty(false)
      setDecisions(
        Object.fromEntries(
          r.rows.map((row) => [
            row.sourceRow,
            r.result?.skippedSourceRows?.includes(row.sourceRow)
              ? { sourceRow: row.sourceRow, action: 'skip' }
              : defaultStatementDecision(row, r.statementType === 'bank'),
          ]),
        ),
      )
      setUpdateValue(r.canUpdateValuation)
      setConfirmReview(false)
      setConfirmTarget(false)
      setAudit(undefined)
    }
  }
  const clear = () => {
    active.current++
    setReview(undefined)
    setError('')
    setNotice('')
    setConfirmReview(false)
    setSourceOpen(false)
  }
  const loadFile = async (file?: File) => {
    clear()
    setSheets([])
    setSheet('')
    if (!file) return
    setBusy(true)
    try {
      const result = await readStatementFile(file)
      if (alive.current) {
        setSheets(result)
        setSheet(result[0].name)
        setFilename(file.name)
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const submit = async (resume?: StatementReview) => {
    const request = ++active.current
    setBusy(true)
    setError('')
    setNotice('')
    try {
      let r =
        resume ??
        (await write<StatementReview>('/api/statement-imports', {
          statementType: type,
          targetId: target,
          source: {
            fileName: filename,
            sheetName: sheet,
            rows: sheets.find((s) => s.name === sheet)!.rows,
          },
        }))
      if (!alive.current || request !== active.current) return
      apply(r)
      while (!['review', 'committed'].includes(r.status)) {
        r = await write<StatementReview>(
          '/api/statement-imports/' + r.id + '/parse',
          {},
        )
        if (!alive.current || request !== active.current) return
        apply(r)
      }
      await refreshHistory()
      if (r.status === 'committed')
        setNotice(
          'This exact statement was already imported. No duplicate records were added.',
        )
    } catch (e) {
      if (alive.current) {
        setError(errorText(e))
        await refreshHistory().catch(() => {})
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const change = (
    n: number,
    field: keyof StatementSelection,
    value: unknown,
  ) => {
    setDecisions((old) => ({
      ...old,
      [n]: { ...(old[n] ?? { sourceRow: n, action: 'skip' }), [field]: value },
    }))
    setConfirmReview(false)
  }
  const correct = (n: number, field: keyof Correction, value: unknown) => {
    setValidationDirty(true)
    if (review?.statementType === 'bank')
      setDecisions((old) => ({
        ...old,
        [n]: { sourceRow: n, action: 'pending' },
      }))
    setCorrections((old) => ({
      ...old,
      [n]: { ...old[n], sourceRow: n, [field]: value },
    }))
    setConfirmReview(false)
  }
  const correctedRows = Object.values(corrections)
  const recheck = async () => {
    if (!review) return
    setBusy(true)
    setError('')
    try {
      const next = await write<StatementReview>(
        '/api/statement-imports/' + review.id + '/review',
        { corrections: correctedRows, summary, summaryConfirmed },
      )
      setReview(next)
      setValidationDirty(false)
      if (next.statementType === 'bank')
        setDecisions((old) =>
          Object.fromEntries(
            next.rows.map((row) => {
              const previous = old[row.sourceRow]
              const wasAutomatic =
                review.rows.find((r) => r.sourceRow === row.sourceRow)
                  ?.autoMatch?.id === previous?.matchId &&
                previous?.action === 'match'
              const validMatch =
                previous?.action === 'match' &&
                row.candidates.some(
                  (c) =>
                    c.id === previous.matchId &&
                    !c.alreadyLinked &&
                    c.transactionType === row.kind,
                ) &&
                !row.errors.length &&
                !row.reviewReason
              const preserve =
                previous?.action === 'skip' ||
                (!wasAutomatic && validMatch) ||
                (previous?.action === 'new' &&
                  !row.errors.length &&
                  !row.reviewReason)
              return [
                row.sourceRow,
                preserve ? previous : defaultStatementDecision(row, true),
              ]
            }),
          ),
        )
      setConfirmReview(false)
      setNotice(
        'Validation and matches refreshed. Clear matches are selected; review any remaining exceptions.',
      )
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const commit = async () => {
    if (!review) return
    setBusy(true)
    setError('')
    try {
      const r = await write<StatementReview>(
        '/api/statement-imports/' + review.id + '/commit',
        {
          expectedTarget: review.expectedTarget,
          selections: Object.values(decisions),
          corrections: correctedRows,
          summary,
          summaryConfirmed,
          preserveBalance: preserve,
          updateValuation: updateValue,
          confirmTarget: review.statementType === 'bank' || confirmTarget,
          confirmReview: review.statementType === 'bank' || confirmReview,
        },
      )
      apply(r)
      setNotice(
        `Import ${r.status === 'committed' ? 'complete' : 'saved'}: ${r.result?.added ?? 0} added, ${r.result?.matched ?? 0} matched, ${r.result?.skipped ?? 0} skipped.${r.result?.pending ? ` ${r.result.pending} rows remain pending for review.` : ''}`,
      )
      await refreshHistory()
    } catch (e) {
      setError(errorText(e))
      setConfirmReview(false)
    } finally {
      setBusy(false)
    }
  }
  if (mode === 'manual')
    return (
      <>
        <div className="workflow-mode-switch">
          <button className="secondary-button" onClick={() => setMode('ai')}>
            Back to AI statement imports
          </button>
        </div>
        <Suspense fallback={<p>Loading manual CSV importer…</p>}>
          <ManualImports />
        </Suspense>
      </>
    )
  const visibleRows = (review?.rows ?? []).filter(
    (r) => filter === 'all' || r.status === filter,
  )
  const bank = (review?.statementType ?? type) === 'bank',
    destinations =
      type === 'bank'
        ? choices.accounts
        : choices.investments.filter((i) => i.investmentType === type),
    selectedSheet = sheets.find((s) => s.name === sheet),
    editable = review?.status === 'review',
    selectedDecisions = Object.values(decisions),
    selectedNew = selectedDecisions.filter((d) => d.action === 'new').length,
    selectedMatches = selectedDecisions.filter(
      (d) => d.action === 'match',
    ).length,
    pendingRows = selectedDecisions.filter(
      (d) => d.action === 'pending',
    ).length,
    activeBlockers = importBlockers(
      review?.blockers ?? [],
      bank,
      selectedDecisions,
    ),
    missingDetails =
      bank &&
      (review?.rows ?? []).some((row) => {
        const d = decisions[row.sourceRow]
        if (!d || ['skip', 'pending'].includes(d.action)) return false
        return (
          row.errors.length > 0 ||
          !!row.reviewReason ||
          (d.action === 'new' &&
            ((row.candidates.length > 0 && !d.acknowledgeDuplicate) ||
              (row.kind === 'transfer' && !d.otherAccountId) ||
              (row.kind === 'refund' && !d.originalTransactionId))) ||
          (d.action === 'match' && !d.matchId)
        )
      })
  return (
    <WorkflowShell
      title="Statement import centre"
      description="Upload a bank, card, NPS or EPFO statement, ask AI to interpret it, then review and confirm exactly what to import."
    >
      <Feedback error={error} notice={notice} />
      <div className="workflow-toolbar">
        <span className="workflow-chip">AI statement review</span>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => setMode('manual')}
        >
          Use manual CSV mapping
        </button>
      </div>
      {configured === false && (
        <p role="alert">
          The existing OpenAI API key is not configured on this Worker.
          Configure OPENAI_API_KEY to enable Submit to AI.
        </p>
      )}
      <section className="panel workflow-form">
        <h2>1. Upload and choose destination</h2>
        <label>
          Statement file
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xls,.xlsx"
            disabled={busy}
            onChange={(e) => void loadFile(e.target.files?.[0])}
          />
        </label>
        <p>
          CSV, XLS or XLSX · up to 2 MB, 600 source rows and 40 columns per
          worksheet. Files stay local until you submit. Encrypted files must be
          unlocked first.
        </p>
        <div className="workflow-fields">
          <label>
            Statement type
            <select
              value={type}
              disabled={busy}
              onChange={(e) => {
                clear()
                setType(e.target.value as StatementType)
                setTarget('')
              }}
            >
              <option value="bank">Bank / credit card</option>
              <option value="nps">NPS</option>
              <option value="epf">EPFO / EPF</option>
            </select>
          </label>
          <label>
            {type === 'bank' ? 'Destination account' : 'Destination holding'}
            <select
              value={target}
              disabled={busy}
              onChange={(e) => {
                clear()
                setTarget(e.target.value)
              }}
            >
              <option value="">
                Choose existing {type === 'bank' ? 'account' : 'holding'}
              </option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {sheets.length > 0 && (
            <label>
              Worksheet
              <select
                value={sheet}
                disabled={busy}
                onChange={(e) => {
                  clear()
                  setSheet(e.target.value)
                }}
              >
                {sheets.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {selectedSheet && (
          <details>
            <summary>Preview source · {selectedSheet.rows.length} rows</summary>
            <div className="workflow-table">
              <table>
                <tbody>
                  {selectedSheet.rows.slice(0, 8).map((r) => (
                    <tr key={r.number}>
                      <th>{r.number}</th>
                      {r.cells.map((c, i) => (
                        <td key={i}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        <p>
          Submit sends the selected worksheet’s cells to OpenAI using the
          existing GPT-4o-mini connection. AI calls share your configured daily
          limit. No financial records are created during parsing.
        </p>
        <button
          className="primary-button"
          disabled={busy || !configured || !target || !selectedSheet}
          onClick={() => void submit()}
        >
          {busy ? 'Processing…' : 'Submit to AI'}
        </button>
      </section>
      {review && (
        <section className="panel workflow-form">
          <h2>2. Review parsed statement</h2>
          <p>
            <strong>{review.fileName}</strong> ·{' '}
            {review.statementType.toUpperCase()} · {review.progress}/
            {review.totalChunks} AI batches · {review.tokens.toLocaleString()}{' '}
            tokens
          </p>
          {busy && (
            <p role="status">
              Reading and validating statement batches. You can reopen this
              import from history if you leave.
            </p>
          )}
          {review.extraction && review.status === 'review' && (
            <>
              <div className="workflow-toolbar">
                {[
                  'new',
                  ...(bank ? ['auto_matched'] : []),
                  'possible_match',
                  'already_imported',
                  'needs_review',
                ].map((status) => (
                  <span className="workflow-chip" key={status}>
                    {review.rows.filter((r) => r.status === status).length}{' '}
                    {status.replaceAll('_', ' ')}
                  </span>
                ))}
              </div>
              {!!review.warnings.length && (
                <details>
                  <summary>
                    Statement checks and warnings ({review.warnings.length})
                  </summary>
                  <ul>
                    {review.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
              {review.blockers.map((b, i) => (
                <p role="alert" className="api-feedback error" key={i}>
                  {b}
                </p>
              ))}
              {bank && (
                <div
                  className={
                    review.reconciliation.differenceMinor
                      ? 'bank-reconciliation error'
                      : 'bank-reconciliation'
                  }
                  role={
                    review.reconciliation.differenceMinor ? 'alert' : 'status'
                  }
                >
                  <strong>
                    {review.reconciliation.differenceMinor === null
                      ? 'Balance check unavailable'
                      : review.reconciliation.differenceMinor === 0
                        ? 'Statement balances reconcile'
                        : `Balance difference: ${rupees(Math.abs(review.reconciliation.differenceMinor))}`}
                  </strong>
                  {review.reconciliation.differenceMinor !== null ? (
                    <p>
                      Opening {rupees(review.reconciliation.openingMinor!)} +
                      net movements{' '}
                      {rupees(review.reconciliation.movementMinor)} − closing{' '}
                      {rupees(review.reconciliation.closingMinor!)} ={' '}
                      {rupees(review.reconciliation.differenceMinor)}.
                    </p>
                  ) : (
                    <p>
                      The opening or closing balance is missing. Verify the
                      statement is complete.
                    </p>
                  )}
                  {!!review.reconciliation.differenceMinor && (
                    <p>
                      Check the statement totals and missing or duplicate rows
                      below. Resolve the difference before importing.
                    </p>
                  )}
                </div>
              )}
              <details>
                <summary>
                  Statement dates and totals — inspect or correct
                </summary>
                <div className="workflow-fields">
                  {(
                    [
                      'statementDate',
                      'openingBalance',
                      'closingBalance',
                      ...(!bank
                        ? [
                            'principal',
                            'employeeBalance',
                            'employerBalance',
                            'pensionBalance',
                          ]
                        : []),
                    ] as (keyof StatementExtraction)[]
                  ).map((field) => (
                    <label key={field}>
                      {field.replace(/([A-Z])/g, ' $1')}
                      <input
                        type={field === 'statementDate' ? 'date' : 'text'}
                        value={String(
                          (field in summary
                            ? summary[field]
                            : review.extraction?.[field]) ?? '',
                        )}
                        disabled={!editable || busy}
                        onChange={(e) => {
                          setValidationDirty(true)
                          setSummary({
                            ...summary,
                            [field]: e.target.value || null,
                          })
                          setConfirmReview(false)
                        }}
                      />
                    </label>
                  ))}
                </div>
                <p>
                  Amounts are rupees. EPF value excludes EPS/pension. Opening
                  balance + movements − closing balance:{' '}
                  {review.reconciliation.differenceMinor === null
                    ? 'Unavailable'
                    : rupees(review.reconciliation.differenceMinor)}
                </p>
                <label className="workflow-check">
                  <input
                    type="checkbox"
                    checked={summaryConfirmed}
                    onChange={(e) => {
                      setSummaryConfirmed(e.target.checked)
                      setConfirmReview(false)
                    }}
                  />
                  I verified the statement summary against the source; use my
                  corrected totals to resolve conflicting AI summaries.
                </label>
                {!bank && review.valuation && (
                  <p>
                    Holding snapshot: {rupees(review.valuation.valueMinor)} as
                    of {review.valuation.date}. Contributions/cost:{' '}
                    {rupees(review.valuation.investedMinor)} (
                    {review.valuation.basisKind.replaceAll('_', ' ')}).
                  </p>
                )}
              </details>
              <div className="workflow-toolbar">
                {!bank && (
                  <label>
                    Show rows
                    <select
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value)
                        setPage(0)
                      }}
                    >
                      <option value="all">All</option>
                      <option value="new">New</option>
                      <option value="possible_match">Possible matches</option>
                      <option value="already_imported">Already imported</option>
                      <option value="needs_review">Needs review</option>
                    </select>
                  </label>
                )}
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void recheck()}
                >
                  Validate corrections & refresh matches
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setSourceOpen(!sourceOpen)}
                >
                  Show original source rows
                </button>
              </div>
              {!bank && (
                <div className="workflow-toolbar">
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setDecisions((old) => ({
                        ...old,
                        ...Object.fromEntries(
                          review.rows
                            .filter((r) => r.status === 'new')
                            .map((r) => [
                              r.sourceRow,
                              {
                                sourceRow: r.sourceRow,
                                action: 'new' as const,
                              },
                            ]),
                        ),
                      }))
                      setConfirmReview(false)
                    }}
                  >
                    Select validated new rows
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setDecisions(
                        Object.fromEntries(
                          review.rows.map((r) => [
                            r.sourceRow,
                            { sourceRow: r.sourceRow, action: 'skip' },
                          ]),
                        ),
                      )
                      setConfirmReview(false)
                    }}
                  >
                    Skip all rows
                  </button>
                </div>
              )}
              {bank ? (
                <BankStatementReview
                  key={review.id}
                  rows={review.rows}
                  decisions={decisions}
                  corrections={corrections}
                  accounts={choices.accounts}
                  categories={choices.categories}
                  targetId={review.targetId}
                  busy={busy}
                  sourceOpen={sourceOpen}
                  change={change}
                  correct={correct}
                  choose={(selection) => {
                    setDecisions((old) => ({
                      ...old,
                      [selection.sourceRow]: selection,
                    }))
                    setConfirmReview(false)
                  }}
                />
              ) : (
                <div className="statement-grid">
                  <div className="statement-grid-title">
                    <div>
                      <h3>Review statement entries</h3>
                      <p>
                        Expand a row to confirm contribution matches or correct
                        parsed fields.
                      </p>
                    </div>
                  </div>
                  <div
                    className="statement-grid-scroll"
                    role="region"
                    aria-label="Retirement statement table"
                    tabIndex={0}
                  >
                    <table>
                      <caption className="statement-grid-sr">
                        Retirement contribution review
                      </caption>
                      <thead>
                        <tr>
                          {[
                            'Date',
                            'Entry',
                            'Amount',
                            'Status',
                            'Decision',
                          ].map((h) => (
                            <th scope="col" key={h}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {review.rows
                          .filter(
                            (r) => filter === 'all' || r.status === filter,
                          )
                          .slice(page * 25, (page + 1) * 25)
                          .map((row) => {
                            const decision = decisions[row.sourceRow] ?? {
                                sourceRow: row.sourceRow,
                                action: 'skip',
                              },
                              fix = corrections[row.sourceRow] ?? {},
                              locked = row.status === 'already_imported',
                              payroll = row.candidates.filter(
                                (c) => c.type === 'payroll',
                              )
                            return (
                              <Fragment key={row.sourceRow}>
                                <tr>
                                  <td className="statement-grid-date">
                                    {fix.date ?? row.date ?? 'Missing date'}
                                    <small>Row {row.sourceRow}</small>
                                  </td>
                                  <td className="statement-grid-description">
                                    <strong>
                                      {fix.description ?? row.description}
                                    </strong>
                                    <small>
                                      {row.salaryMonth
                                        ? 'Salary month: ' + row.salaryMonth
                                        : (row.reference ??
                                          'Contribution entry')}
                                    </small>
                                    {corrections[row.sourceRow] && (
                                      <small>
                                        Corrections staged — validate before
                                        importing
                                      </small>
                                    )}
                                  </td>
                                  <td className="statement-grid-amount">
                                    <strong>{rupees(row.amountMinor)}</strong>
                                  </td>
                                  <td>
                                    <span
                                      className={`statement-grid-status ${locked ? 'done' : row.errors.length || row.reviewReason ? 'manual' : 'new'}`}
                                    >
                                      {row.status.replaceAll('_', ' ')}
                                    </span>
                                  </td>
                                  <td>
                                    {locked
                                      ? 'Already reconciled'
                                      : decision.action === 'new'
                                        ? 'Add as new'
                                        : decision.action === 'match'
                                          ? 'Match selected'
                                          : decision.action === 'skip'
                                            ? 'Skipped'
                                            : 'Review later'}
                                  </td>
                                </tr>
                                <tr className="statement-grid-detail">
                                  <td colSpan={5}>
                                    <details className="statement-grid-row-details">
                                      <summary>
                                        Review row {row.sourceRow} · matches,
                                        contribution details and corrections
                                      </summary>
                                      <article
                                        className="statement-review-row"
                                        key={row.sourceRow}
                                      >
                                        <div className="workflow-toolbar">
                                          <h3>
                                            Row {row.sourceRow} ·{' '}
                                            {row.description}
                                          </h3>
                                          <span className="workflow-chip">
                                            {row.status.replaceAll('_', ' ')}
                                          </span>
                                        </div>
                                        <p>
                                          {row.date ?? 'Date missing'} ·{' '}
                                          {row.direction} ·{' '}
                                          <strong>
                                            {rupees(row.amountMinor)}
                                          </strong>
                                          {row.salaryMonth
                                            ? ' · salary ' + row.salaryMonth
                                            : ''}
                                        </p>
                                        {row.reviewReason && (
                                          <p>{row.reviewReason}</p>
                                        )}
                                        {row.errors.map((e, i) => (
                                          <p className="workflow-error" key={i}>
                                            {e}
                                          </p>
                                        ))}
                                        <div className="workflow-fields">
                                          <label>
                                            Decision for row {row.sourceRow}
                                            <select
                                              disabled={busy || locked}
                                              value={decision.action}
                                              onChange={(e) =>
                                                change(
                                                  row.sourceRow,
                                                  'action',
                                                  e.target.value,
                                                )
                                              }
                                            >
                                              <option value="skip">Skip</option>
                                              <option value="new">
                                                Add new{' '}
                                                {bank
                                                  ? 'transaction'
                                                  : 'evidence'}
                                              </option>
                                              <option value="match">
                                                Match existing
                                              </option>
                                            </select>
                                          </label>
                                          {decision.action === 'match' && (
                                            <label>
                                              Existing evidence
                                              <select
                                                value={decision.matchId ?? ''}
                                                onChange={(e) =>
                                                  change(
                                                    row.sourceRow,
                                                    'matchId',
                                                    e.target.value,
                                                  )
                                                }
                                                disabled={busy}
                                              >
                                                <option value="">
                                                  Choose evidence
                                                  {!bank
                                                    ? ' (or payroll below)'
                                                    : ''}
                                                </option>
                                                {row.candidates
                                                  .filter(
                                                    (c) => c.type !== 'payroll',
                                                  )
                                                  .map((c) => (
                                                    <option
                                                      key={c.id}
                                                      value={c.id}
                                                    >
                                                      {c.date} · {c.label} ·{' '}
                                                      {rupees(c.amountMinor)}
                                                    </option>
                                                  ))}
                                              </select>
                                            </label>
                                          )}
                                          {decision.action === 'new' &&
                                            row.candidates.length > 0 && (
                                              <label className="workflow-check">
                                                <input
                                                  type="checkbox"
                                                  checked={
                                                    decision.acknowledgeDuplicate ??
                                                    false
                                                  }
                                                  disabled={busy}
                                                  onChange={(e) =>
                                                    change(
                                                      row.sourceRow,
                                                      'acknowledgeDuplicate',
                                                      e.target.checked,
                                                    )
                                                  }
                                                />
                                                I checked the possible matches;
                                                this is a separate movement.
                                              </label>
                                            )}
                                        </div>
                                        {!bank &&
                                          decision.action === 'match' &&
                                          payroll.length > 0 && (
                                            <div className="workflow-fields">
                                              {(row.employeeMinor !== null &&
                                              row.employerMinor !== null
                                                ? [
                                                    'employee',
                                                    'employer',
                                                    ...(row.pensionMinor
                                                      ? ['pension']
                                                      : []),
                                                  ]
                                                : [
                                                    'total',
                                                    ...(row.pensionMinor
                                                      ? ['pension']
                                                      : []),
                                                  ]
                                              ).map((component) => (
                                                <label key={component}>
                                                  {component} payroll match
                                                  <select
                                                    value={
                                                      decision.payrollMatches?.find(
                                                        (m) =>
                                                          m.component ===
                                                          component,
                                                      )?.id ?? ''
                                                    }
                                                    disabled={busy}
                                                    onChange={(e) =>
                                                      change(
                                                        row.sourceRow,
                                                        'payrollMatches',
                                                        [
                                                          ...(
                                                            decision.payrollMatches ??
                                                            []
                                                          ).filter(
                                                            (m) =>
                                                              m.component !==
                                                              component,
                                                          ),
                                                          ...(e.target.value
                                                            ? [
                                                                {
                                                                  component,
                                                                  id: e.target
                                                                    .value,
                                                                },
                                                              ]
                                                            : []),
                                                        ],
                                                      )
                                                    }
                                                  >
                                                    <option value="">
                                                      Leave unmatched
                                                    </option>
                                                    {payroll
                                                      .filter(
                                                        (c) =>
                                                          component ===
                                                            'total' ||
                                                          c.label.startsWith(
                                                            component,
                                                          ),
                                                      )
                                                      .map((c) => (
                                                        <option
                                                          key={c.id}
                                                          value={c.id}
                                                        >
                                                          {c.label} ·{' '}
                                                          {rupees(
                                                            c.amountMinor,
                                                          )}
                                                        </option>
                                                      ))}
                                                  </select>
                                                </label>
                                              ))}
                                            </div>
                                          )}
                                        <details>
                                          <summary>
                                            Inspect / correct parsed fields
                                          </summary>
                                          <div className="workflow-fields">
                                            <label>
                                              Date
                                              <input
                                                type="date"
                                                value={
                                                  fix.date ?? row.date ?? ''
                                                }
                                                disabled={busy || locked}
                                                onChange={(e) =>
                                                  correct(
                                                    row.sourceRow,
                                                    'date',
                                                    e.target.value,
                                                  )
                                                }
                                              />
                                            </label>
                                            <label>
                                              Amount ₹
                                              <input
                                                value={
                                                  fix.amount ?? row.amount ?? ''
                                                }
                                                disabled={busy || locked}
                                                onChange={(e) =>
                                                  correct(
                                                    row.sourceRow,
                                                    'amount',
                                                    e.target.value,
                                                  )
                                                }
                                              />
                                            </label>
                                            <label>
                                              Description
                                              <input
                                                maxLength={200}
                                                value={
                                                  fix.description ??
                                                  row.description
                                                }
                                                disabled={busy || locked}
                                                onChange={(e) =>
                                                  correct(
                                                    row.sourceRow,
                                                    'description',
                                                    e.target.value,
                                                  )
                                                }
                                              />
                                            </label>
                                            <label>
                                              Direction
                                              <select
                                                value={
                                                  fix.direction ?? row.direction
                                                }
                                                disabled={busy || locked}
                                                onChange={(e) =>
                                                  correct(
                                                    row.sourceRow,
                                                    'direction',
                                                    e.target.value,
                                                  )
                                                }
                                              >
                                                <option value="debit">
                                                  Debit
                                                </option>
                                                <option value="credit">
                                                  Credit
                                                </option>
                                              </select>
                                            </label>
                                            <label>
                                              Reference
                                              <input
                                                maxLength={200}
                                                value={
                                                  fix.reference ?? row.reference
                                                }
                                                disabled={busy || locked}
                                                onChange={(e) =>
                                                  correct(
                                                    row.sourceRow,
                                                    'reference',
                                                    e.target.value,
                                                  )
                                                }
                                              />
                                            </label>
                                            <label>
                                              Movement type
                                              <select
                                                value={fix.kind ?? row.kind}
                                                disabled={busy || locked}
                                                onChange={(e) =>
                                                  correct(
                                                    row.sourceRow,
                                                    'kind',
                                                    e.target
                                                      .value as StatementKind,
                                                  )
                                                }
                                              >
                                                {(bank
                                                  ? [
                                                      'expense',
                                                      'income',
                                                      'transfer',
                                                      'investment',
                                                      'refund',
                                                    ]
                                                  : [
                                                      'contribution',
                                                      'interest',
                                                      'fee',
                                                      'withdrawal',
                                                    ]
                                                ).map((k) => (
                                                  <option key={k}>{k}</option>
                                                ))}
                                              </select>
                                            </label>
                                            {bank ? (
                                              <label>
                                                Category
                                                <select
                                                  value={
                                                    'categoryId' in fix
                                                      ? (fix.categoryId ?? '')
                                                      : (row.categoryId ?? '')
                                                  }
                                                  disabled={busy || locked}
                                                  onChange={(e) =>
                                                    correct(
                                                      row.sourceRow,
                                                      'categoryId',
                                                      e.target.value || null,
                                                    )
                                                  }
                                                >
                                                  <option value="">
                                                    Uncategorized
                                                  </option>
                                                  {choices.categories.map(
                                                    (c) => (
                                                      <option
                                                        key={c.id}
                                                        value={c.id}
                                                      >
                                                        {c.name}
                                                      </option>
                                                    ),
                                                  )}
                                                </select>
                                              </label>
                                            ) : (
                                              <>
                                                <label>
                                                  Salary month
                                                  <input
                                                    type="month"
                                                    value={
                                                      fix.salaryMonth ??
                                                      row.salaryMonth ??
                                                      ''
                                                    }
                                                    disabled={busy || locked}
                                                    onChange={(e) =>
                                                      correct(
                                                        row.sourceRow,
                                                        'salaryMonth',
                                                        e.target.value || null,
                                                      )
                                                    }
                                                  />
                                                </label>
                                                {(
                                                  [
                                                    'employee',
                                                    'employer',
                                                    'pension',
                                                  ] as const
                                                ).map((k) => (
                                                  <label key={k}>
                                                    {k} ₹
                                                    <input
                                                      value={
                                                        fix[k] ?? row[k] ?? ''
                                                      }
                                                      disabled={busy || locked}
                                                      onChange={(e) =>
                                                        correct(
                                                          row.sourceRow,
                                                          k,
                                                          e.target.value ||
                                                            null,
                                                        )
                                                      }
                                                    />
                                                  </label>
                                                ))}
                                              </>
                                            )}
                                          </div>
                                          <label className="workflow-check">
                                            <input
                                              type="checkbox"
                                              checked={fix.confirmed ?? false}
                                              disabled={busy || locked}
                                              onChange={(e) =>
                                                correct(
                                                  row.sourceRow,
                                                  'confirmed',
                                                  e.target.checked,
                                                )
                                              }
                                            />
                                            I checked this row against the
                                            original statement.
                                          </label>
                                        </details>
                                        {bank &&
                                          (fix.kind ?? row.kind) ===
                                            'transfer' &&
                                          decision.action === 'new' && (
                                            <label>
                                              Other transfer account
                                              <select
                                                value={
                                                  decision.otherAccountId ?? ''
                                                }
                                                onChange={(e) =>
                                                  change(
                                                    row.sourceRow,
                                                    'otherAccountId',
                                                    e.target.value,
                                                  )
                                                }
                                              >
                                                <option value="">
                                                  Choose account
                                                </option>
                                                {choices.accounts
                                                  .filter(
                                                    (a) =>
                                                      a.id !== review.targetId,
                                                  )
                                                  .map((a) => (
                                                    <option
                                                      key={a.id}
                                                      value={a.id}
                                                    >
                                                      {a.name}
                                                    </option>
                                                  ))}
                                              </select>
                                            </label>
                                          )}
                                        {bank &&
                                          (fix.kind ?? row.kind) === 'refund' &&
                                          decision.action === 'new' && (
                                            <label>
                                              Original expense transaction ID
                                              <input
                                                value={
                                                  decision.originalTransactionId ??
                                                  ''
                                                }
                                                onChange={(e) =>
                                                  change(
                                                    row.sourceRow,
                                                    'originalTransactionId',
                                                    e.target.value,
                                                  )
                                                }
                                              />
                                            </label>
                                          )}
                                        {sourceOpen && (
                                          <pre className="statement-audit">
                                            {JSON.stringify(
                                              row.sourceCells,
                                              null,
                                              2,
                                            )}
                                          </pre>
                                        )}
                                        {locked && (
                                          <p>
                                            Recorded evidence is already linked.
                                            This row will not be added again.
                                          </p>
                                        )}
                                      </article>
                                    </details>
                                  </td>
                                </tr>
                              </Fragment>
                            )
                          })}
                        {!visibleRows.length && (
                          <tr>
                            <td colSpan={5} className="statement-grid-empty">
                              No entries match this filter.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {!bank && visibleRows.length > 25 && (
                <div className="workflow-toolbar">
                  <button
                    className="secondary-button"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous rows
                  </button>
                  <span>
                    Rows {page * 25 + 1}–
                    {Math.min((page + 1) * 25, visibleRows.length)} of{' '}
                    {visibleRows.length}
                  </span>
                  <button
                    className="secondary-button"
                    disabled={(page + 1) * 25 >= visibleRows.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Next rows
                  </button>
                </div>
              )}
              {bank ? (
                <label className="workflow-check">
                  <input
                    type="checkbox"
                    checked={preserve}
                    disabled={busy}
                    onChange={(e) => {
                      setPreserve(e.target.checked)
                      setConfirmReview(false)
                    }}
                  />
                  Historical backfill: preserve the current account balance
                  using a recorded opening-balance offset.
                </label>
              ) : (
                <label className="workflow-check">
                  <input
                    type="checkbox"
                    checked={updateValue}
                    disabled={busy || !review.canUpdateValuation}
                    onChange={(e) => {
                      setUpdateValue(e.target.checked)
                      setConfirmReview(false)
                    }}
                  />
                  Update this holding to the newer statement snapshot.
                  Older/equal-date statements add history only.
                </label>
              )}
              <p>
                {bank
                  ? 'Matching links evidence to the existing payment. Only Add new creates a cash transaction.'
                  : 'Retirement movements are statement evidence. They do not create bank debits; the selected snapshot replaces the holding value once.'}
              </p>
              {!bank && (
                <>
                  <label className="workflow-check">
                    <input
                      type="checkbox"
                      checked={confirmTarget}
                      disabled={busy}
                      onChange={(e) => setConfirmTarget(e.target.checked)}
                    />
                    I verified this statement belongs to{' '}
                    {choices.accounts
                      .concat(choices.investments)
                      .find((t) => t.id === review.targetId)?.name ??
                      'the selected destination'}
                    .
                  </label>
                  <label className="workflow-check">
                    <input
                      type="checkbox"
                      checked={confirmReview}
                      disabled={busy}
                      onChange={(e) => setConfirmReview(e.target.checked)}
                    />
                    I reviewed the totals, selected rows and matches. Import
                    these decisions.
                  </label>
                </>
              )}
              {bank && (
                <p>
                  Confirm the selected decisions for{' '}
                  <strong>
                    {choices.accounts.find((a) => a.id === review.targetId)
                      ?.name ?? 'the selected account'}
                  </strong>
                  . Existing descriptions and categories stay unchanged when
                  matching.
                </p>
              )}
              <p>
                {
                  Object.values(decisions).filter((d) => d.action === 'new')
                    .length
                }{' '}
                new ·{' '}
                {
                  Object.values(decisions).filter((d) => d.action === 'match')
                    .length
                }{' '}
                matches ·{' '}
                {
                  Object.values(decisions).filter((d) => d.action === 'skip')
                    .length
                }{' '}
                skipped
                {bank && pendingRows > 0
                  ? ` · ${pendingRows} pending (kept for later)`
                  : ''}
              </p>
              {bank && validationDirty && (
                <p role="status">
                  Validate corrections & refresh matches before confirming.
                </p>
              )}
              {bank && missingDetails && (
                <p role="status">
                  Complete the selected row’s details or mark it Review later.
                </p>
              )}
              {activeBlockers.length > 0 && (
                <div className="workflow-error" role="alert">
                  <strong>Cannot apply yet:</strong>
                  {activeBlockers.map((b, i) => (
                    <p key={i}>{b}</p>
                  ))}
                </div>
              )}
              {bank &&
                selectedNew === 0 &&
                selectedMatches > 0 &&
                review.blockers.length > activeBlockers.length && (
                  <p role="status">
                    Only existing transactions will be linked. The statement
                    balance difference does not block these matches; no balances
                    or payments will change.
                  </p>
                )}
              <button
                className="primary-button"
                disabled={
                  busy ||
                  (!bank && (!confirmTarget || !confirmReview)) ||
                  (bank &&
                    (validationDirty ||
                      missingDetails ||
                      (selectedNew + selectedMatches === 0 &&
                        pendingRows > 0))) ||
                  activeBlockers.length > 0
                }
                onClick={() => void commit()}
              >
                {busy
                  ? 'Importing…'
                  : bank
                    ? `Confirm & import: ${selectedMatches} matches + ${selectedNew} new`
                    : 'Import Now'}
              </button>
            </>
          )}
          {review.status === 'committed' && (
            <p>
              Import completed.{' '}
              <Link to={bank ? '/transactions' : '/investments'}>
                View {bank ? 'transactions' : 'investments'}
              </Link>
            </p>
          )}
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              apiRequest('/api/statement-imports/' + review.id + '/audit')
                .then(setAudit)
                .catch((e) => setError(errorText(e)))
            }}
          >
            View AI audit
          </button>
          {review.status !== 'committed' && (
            <button
              className="secondary-button"
              disabled={
                busy ||
                (review.result?.added ?? 0) + (review.result?.matched ?? 0) > 0
              }
              onClick={() => {
                if (
                  !window.confirm(
                    'Discard this unimported statement and its AI audit? No financial records will be removed.',
                  )
                )
                  return
                setBusy(true)
                write('/api/statement-imports/' + review.id, {}, 'DELETE')
                  .then(async () => {
                    setReview(undefined)
                    setNotice('Unimported statement discarded.')
                    await refreshHistory()
                  })
                  .catch((e) => setError(errorText(e)))
                  .finally(() => setBusy(false))
              }}
            >
              Discard unimported statement
            </button>
          )}
          {audit !== undefined && (
            <details open>
              <summary>
                AI requests and responses — private statement data
              </summary>
              <pre className="statement-audit">
                {JSON.stringify(audit, null, 2)}
              </pre>
            </details>
          )}
        </section>
      )}
      <section className="panel">
        <h2>AI import history</h2>
        {history.length === 0 ? (
          <p>No AI statements submitted yet.</p>
        ) : (
          <ul className="workflow-history">
            {history.map((h) => (
              <li key={h.id}>
                <div>
                  <strong>{h.file_name}</strong>
                  <p>
                    {h.statement_type.toUpperCase()} · {h.status} ·{' '}
                    {h.created_at}
                  </p>
                </div>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    setError('')
                    apiRequest<StatementReview>(
                      '/api/statement-imports/' + h.id,
                    )
                      .then(async (r) => {
                        apply(r)
                        if (!['review', 'committed'].includes(r.status))
                          await submit(r)
                      })
                      .catch((e) => setError(errorText(e)))
                      .finally(() => setBusy(false))
                  }}
                >
                  Open / resume
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </WorkflowShell>
  )
}
