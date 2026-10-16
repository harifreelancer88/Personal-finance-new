import type { StatementExtraction } from '../../../shared/statement-import'
import { parseMoney } from '../../../worker/lib/statement-parser'
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiRequest } from '../../api/client'
import { Modal } from '../transactions/Modal'
import {
  formatWholeMinorCurrency as formatMinorCurrency,
  formatDate,
} from '../../lib/format'
import type { Investment } from '../../types/finance'
import type { NpsStatement } from '../../../shared/nps'
import '../../nps.css'
interface Pending {
  id: string
  description: string
  amountMinor: number
  transactionDate: string
  salaryMonth?: string
}
interface Detail {
  aiStatement?: {
    id: string
    fileName: string
    extraction: StatementExtraction
  } | null
  statement: NpsStatement | null
  pending: Pending[]
  matches: {
    transactionId: string
    creditDate: string
    salaryMonth: string
    amountMinor: number
  }[]
}
interface Preview {
  statement: NpsStatement
  pending: Pending[]
  accountLast4: string
  expectedUpdatedAt: string
  expectedInvestedMinor: number
  expectedValueMinor: number
  alreadyImported?: boolean
}
const precise = (scaled: number) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(scaled / 10000)
export function NpsDetails({
  investment,
  onClose,
  onSaved,
}: {
  investment: Investment
  onClose: () => void
  onSaved?: () => void
}) {
  const [detail, setDetail] = useState<Detail>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [csvText, setCsvText] = useState(''),
    [preview, setPreview] = useState<Preview>(),
    [matches, setMatches] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState(''),
    [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const c = new AbortController()
    setError('')
    void apiRequest<Detail>(`/api/investments/${investment.id}/nps`, {
      signal: c.signal,
    })
      .then((v) => {
        if (!c.signal.aborted) setDetail(v)
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof Error ? e.message : 'Could not load NPS history.',
          )
      })
    return () => c.abort()
  }, [investment.id, refresh])
  const choose = async (file: File | undefined) => {
    setPreview(undefined)
    setMatches({})
    setCsvText('')
    setNotice('')
    setError('')
    if (!file) return
    if (file.size > 1_000_000) {
      setError('Choose an NPS CSV smaller than 1 MB.')
      return
    }
    setBusy(true)
    try {
      const text = await file.text(),
        result = await apiRequest<Preview>(
          `/api/investments/${investment.id}/nps/preview`,
          { method: 'POST', body: JSON.stringify({ csvText: text }) },
        )
      if (result.alreadyImported) {
        setNotice('This statement is already imported. No changes were made.')
        return
      }
      setCsvText(text)
      setPreview(result)
      const selections: Record<string, string> = {}
      for (const credit of result.statement.credits) {
        const eligible = result.pending.filter(
          (p) =>
            p.salaryMonth === credit.salaryMonth &&
            p.amountMinor === credit.amountMinor,
        )
        if (eligible.length === 1)
          selections[`${credit.date}:${credit.salaryMonth}`] = eligible[0].id
      }
      setMatches(selections)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this NPS CSV.')
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      await apiRequest(`/api/investments/${investment.id}/nps/import`, {
        method: 'POST',
        body: JSON.stringify({
          csvText,
          expectedUpdatedAt: preview.expectedUpdatedAt,
          expectedInvestedMinor: preview.expectedInvestedMinor,
          expectedValueMinor: preview.expectedValueMinor,
          matches: preview.statement.credits.flatMap((c) => {
            const transactionId = matches[`${c.date}:${c.salaryMonth}`]
            return transactionId
              ? [
                  {
                    transactionId,
                    creditDate: c.date,
                    salaryMonth: c.salaryMonth,
                  },
                ]
              : []
          }),
        }),
      })
      setPreview(undefined)
      setCsvText('')
      setNotice(
        'Statement imported. Portfolio values updated; monthly transactions preserved.',
      )
      setRefresh((v) => v + 1)
      onSaved?.()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not import the statement.',
      )
    } finally {
      setBusy(false)
    }
  }
  const ai = detail?.aiStatement,
    showAi =
      !!ai &&
      !preview &&
      (!detail?.statement ||
        String(ai.extraction.statementDate) >= detail.statement.statementDate)
  const statement = preview?.statement ?? (showAi ? null : detail?.statement),
    pending = preview?.pending ?? detail?.pending ?? []
  return (
    <Modal
      title={investment.name}
      description="NPS Tier I · statement and salary reconciliation"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="wealth-modal-body nps-details">
        {error && (
          <p className="wealth-error" role="alert">
            {error}
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setRefresh((v) => v + 1)}
            >
              Retry
            </button>
          </p>
        )}
        {notice && (
          <p role="status" className="nps-notice">
            {notice}
          </p>
        )}
        <section className="nps-import">
          <h3>Import NPS statement</h3>
          <p>
            Choose the CRA Tier I transaction CSV. Preview verified balances,
            fees and salary matches before saving.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="NPS transaction CSV"
            disabled={busy}
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          {busy && <p role="status">Working…</p>}
        </section>
        {preview && (
          <div className="nps-notice">
            <strong>
              Import preview · account ending {preview.accountLast4}
            </strong>
            <p>
              This will replace the holding’s recorded cost and value with the
              statement totals. Historical contributions and fees stay in NPS
              history; no new bank, salary or dashboard transactions are
              created.
            </p>
          </div>
        )}
        {showAi && ai && (
          <section>
            <h3>Latest reviewed AI statement</h3>
            <p className="wealth-caption">
              As of {ai.extraction.statementDate} · {ai.fileName}. NAV dates
              remain as reported in the source.
            </p>
            <div className="nps-metrics">
              <div>
                <small>Holding value</small>
                <strong>
                  {formatMinorCurrency(
                    parseMoney(ai.extraction.closingBalance ?? '') ?? 0,
                  )}
                </strong>
              </div>
              <div>
                <small>Lifetime contributions</small>
                <strong>
                  {formatMinorCurrency(
                    parseMoney(ai.extraction.principal ?? '') ?? 0,
                  )}
                </strong>
              </div>
            </div>
            <h3>Scheme holdings</h3>
            <div className="nps-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Scheme</th>
                    <th>Units</th>
                    <th>NAV (₹)</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {ai.extraction.schemes.map((s) => (
                    <tr key={s.name}>
                      <td>{s.name}</td>
                      <td>{s.units}</td>
                      <td>{s.nav}</td>
                      <td>{formatMinorCurrency(parseMoney(s.value) ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="wealth-caption">
              These schemes are components of the holding, counted once in
              portfolio value.
            </p>
            <h3>Statement movements</h3>
            {ai.extraction.rows.map((r) => (
              <div className="nps-credit" key={r.sourceRow}>
                <div>
                  <strong>
                    {r.date} · {r.kind}
                  </strong>
                  <span>
                    {formatMinorCurrency(parseMoney(r.amount ?? '') ?? 0)}
                  </span>
                </div>
                <small>
                  {r.description}
                  {r.salaryMonth ? ' · salary ' + r.salaryMonth : ''}
                </small>
              </div>
            ))}
            <Link to="/imports">
              Review import history, matches and AI audit
            </Link>
          </section>
        )}
        {statement ? (
          <>
            <h3>
              {preview ? 'Preview valuation' : 'Statement-verified holding'}
            </h3>
            <p className="wealth-caption">
              As of {formatDate(statement.statementDate)} · NAV dated{' '}
              {formatDate(statement.navDate)}
            </p>
            <div className="nps-metrics">
              {[
                ['Holding value', formatMinorCurrency(statement.valueMinor)],
                [
                  'Credited contributions',
                  formatMinorCurrency(statement.contributedMinor),
                ],
                [
                  'Unrealised gain',
                  `${statement.gainMinor < 0 ? '−' : ''}${formatMinorCurrency(statement.gainMinor)}`,
                ],
                [
                  'Reported XIRR',
                  statement.xirrPercent === null
                    ? 'Not reported'
                    : `${statement.xirrPercent}%`,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <small>{label}</small>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <h3>Scheme holdings</h3>
            <div className="nps-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Scheme</th>
                    <th>Units</th>
                    <th>NAV (₹)</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.schemes.map((s) => (
                    <tr key={s.code}>
                      <td>{s.name}</td>
                      <td>{precise(s.units4)}</td>
                      <td>{precise(s.nav4)}</td>
                      <td>{formatMinorCurrency(s.valueMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="wealth-caption">
              Scheme values are components of one NPS holding. Gain is excluded
              from Money In.
            </p>
            <h3>Credited contributions</h3>
            <p className="wealth-caption">
              NPS posting date and salary month are kept separately. Matching a
              salary entry does not count the investment again.
            </p>
            {statement.credits.map((c) => {
              const key = `${c.date}:${c.salaryMonth}`,
                candidates = pending.filter(
                  (p) =>
                    p.salaryMonth === c.salaryMonth &&
                    p.amountMinor === c.amountMinor,
                ),
                linked = detail?.matches.find(
                  (m) =>
                    m.creditDate === c.date && m.salaryMonth === c.salaryMonth,
                )
              return (
                <div className="nps-credit" key={key}>
                  <div>
                    <strong>
                      {formatDate(c.date)} · salary {c.salaryMonth}
                    </strong>
                    <span>{formatMinorCurrency(c.amountMinor)}</span>
                  </div>
                  <small>
                    Employee {formatMinorCurrency(c.employeeMinor)} · Employer{' '}
                    {formatMinorCurrency(c.employerMinor)}
                  </small>
                  {preview ? (
                    <label>
                      Match existing salary deduction
                      <select
                        disabled={busy}
                        aria-label={`Salary match for ${c.salaryMonth}`}
                        value={matches[key] ?? ''}
                        onChange={(e) =>
                          setMatches((old) => ({
                            ...old,
                            [key]: e.target.value,
                          }))
                        }
                      >
                        <option value="">
                          Keep as historical contribution
                        </option>
                        {candidates.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.description} · {formatDate(p.transactionDate)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <small>
                      {linked
                        ? 'Matched to an existing salary investment'
                        : 'Historical NPS credit'}
                    </small>
                  )}
                  <details>
                    <summary>Scheme allocation</summary>
                    {statement.movements
                      .filter(
                        (m) =>
                          m.kind === 'contribution' &&
                          m.date === c.date &&
                          m.salaryMonth === c.salaryMonth,
                      )
                      .map((m) => (
                        <p key={m.scheme}>
                          Scheme {m.scheme}:{' '}
                          {formatMinorCurrency(m.amountMinor)} ·{' '}
                          {precise(m.units4)} units · NAV ₹{precise(m.nav4)}
                        </p>
                      ))}
                  </details>
                </div>
              )
            })}
            <details className="nps-fees">
              <summary>
                Fees deducted through units ·{' '}
                {formatMinorCurrency(statement.feesMinor)}
              </summary>
              <p>
                Fees are already included in the closing units and holding
                value. They are not deducted again or posted as bank spending.
              </p>
              {statement.movements
                .filter((m) => m.kind === 'fee')
                .map((m, index) => (
                  <div className="nps-fee" key={index}>
                    <span>
                      {formatDate(m.date)} · Scheme {m.scheme}
                      <small>
                        {m.description} · {precise(m.units4)} units redeemed
                      </small>
                    </span>
                    <strong>{formatMinorCurrency(m.amountMinor)}</strong>
                  </div>
                ))}
            </details>
          </>
        ) : showAi ? null : detail ? (
          <p className="nps-notice">
            No statement-verified valuation yet. Recorded value:{' '}
            {formatMinorCurrency(Math.round(investment.currentValue * 100))}.
            Import a statement to separate the actual holding from salary
            deductions awaiting credit.
          </p>
        ) : (
          !error && <p role="status">Loading NPS history…</p>
        )}
        <section className="nps-pending">
          <h3>Salary deductions awaiting confirmation</h3>
          <p>
            These amounts are separate from the statement-verified portfolio
            value. A later CSV can match a contribution for the same salary
            month and amount.
          </p>
          {pending
            .filter((p) => !preview || !Object.values(matches).includes(p.id))
            .map((p) => (
              <div className="nps-credit" key={p.id}>
                <div>
                  <strong>{p.description}</strong>
                  <span>{formatMinorCurrency(p.amountMinor)}</span>
                </div>
                <small>
                  {formatDate(p.transactionDate)} · salary{' '}
                  {p.salaryMonth ?? 'month not tagged'} · awaiting NPS statement
                  confirmation
                </small>
              </div>
            ))}
          {!pending.length && <p>No unmatched linked salary deductions.</p>}
        </section>
      </div>
      <footer className="dialog-footer">
        <button className="secondary-button" disabled={busy} onClick={onClose}>
          Close
        </button>
        {preview && (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void save()}
          >
            Import statement & update holding
          </button>
        )}
      </footer>
    </Modal>
  )
}
