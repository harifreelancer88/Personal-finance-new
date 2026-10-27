import { Fragment, useState } from 'react'
import './statement-review-table.css'
import { rupees, type Lookup } from '../../api/workflows'
import type {
  ParsedStatementRow,
  ReviewedStatementRow,
  StatementSelection,
} from '../../../shared/statement-import'

type Correction = Partial<ParsedStatementRow> & {
  sourceRow: number
  confirmed?: boolean
}
interface Props {
  rows: ReviewedStatementRow[]
  decisions: Record<number, StatementSelection>
  corrections: Record<number, Correction>
  accounts: Lookup[]
  categories: Lookup[]
  targetId: string
  busy: boolean
  sourceOpen: boolean
  change: (n: number, field: keyof StatementSelection, value: unknown) => void
  choose: (selection: StatementSelection) => void
  correct: (n: number, field: keyof Correction, value: unknown) => void
}

export function reviewGroup(
  row: ReviewedStatementRow,
  decision?: StatementSelection,
) {
  if (row.status === 'already_imported') return 'done'
  if (row.errors.length || row.reviewReason) return 'manual'
  if (decision?.action === 'skip') return 'skip'
  if (
    row.autoMatch &&
    decision?.action === 'match' &&
    decision.matchId === row.autoMatch.id
  )
    return 'auto'
  if (decision?.action === 'match') return 'matched'
  if (
    row.status === 'new' &&
    decision?.action === 'new' &&
    !['transfer', 'refund'].includes(row.kind)
  )
    return 'new'
  return 'manual'
}
const groupLabels = {
  manual: 'Needs your review',
  auto: 'Auto-matched',
  new: 'New transactions',
  matched: 'Match selected',
  skip: 'Skipped',
  done: 'Already reconciled',
}

export default function BankStatementReview(props: Props) {
  const { rows, decisions, busy, choose } = props
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<number[]>([])
  const counts = Object.fromEntries(
    Object.keys(groupLabels).map((g) => [
      g,
      rows.filter((r) => reviewGroup(r, decisions[r.sourceRow]) === g).length,
    ]),
  )
  const filtered = rows.filter(
    (r) =>
      (filter === 'all' || reviewGroup(r, decisions[r.sourceRow]) === filter) &&
      `${r.description} ${r.reference ?? ''} ${r.date ?? ''} ${r.amount}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  const lastPage = Math.max(0, Math.ceil(filtered.length / 25) - 1),
    currentPage = Math.min(page, lastPage)
  const visible = filtered.slice(currentPage * 25, currentPage * 25 + 25)
  const eligible = visible.filter((r) => r.status !== 'already_imported')
  const selectedRows = rows.filter(
    (r) => selected.includes(r.sourceRow) && r.status !== 'already_imported',
  )
  const allSelected =
    eligible.length > 0 && eligible.every((r) => selected.includes(r.sourceRow))
  const bulk = (action: 'skip' | 'pending') => {
    for (const row of selectedRows) choose({ sourceRow: row.sourceRow, action })
    setSelected([])
  }
  return (
    <section
      className="statement-grid"
      aria-label="Statement confirmation table"
    >
      <div className="statement-grid-title">
        <div>
          <h3>Review transactions</h3>
          <p>
            Confirm new payments and existing matches. Nothing is imported until
            you click Import Now.
          </p>
        </div>
        <span>{rows.length} statement rows</span>
      </div>
      <div
        className="statement-grid-filters"
        role="group"
        aria-label="Filter statement decisions"
      >
        <button
          type="button"
          aria-pressed={filter === 'all'}
          onClick={() => {
            setFilter('all')
            setPage(0)
          }}
        >
          All · {rows.length}
        </button>
        {Object.entries(groupLabels).map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key)
              setPage(0)
            }}
          >
            {label} · {counts[key]}
          </button>
        ))}
      </div>
      <div className="statement-grid-toolbar">
        <label>
          Search transactions
          <input
            type="search"
            placeholder="Description, reference, date or amount"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
          />
        </label>
        <span role="status">
          {selectedRows.length} selected
          {selectedRows.some((r) => !visible.includes(r))
            ? ' (includes rows outside this page)'
            : ''}
        </span>
        <button
          type="button"
          disabled={busy || !selectedRows.length}
          onClick={() => bulk('pending')}
        >
          Review selected later
        </button>
        <button
          type="button"
          disabled={busy || !selectedRows.length}
          onClick={() => bulk('skip')}
        >
          Skip selected
        </button>
        {selected.length > 0 && (
          <button type="button" disabled={busy} onClick={() => setSelected([])}>
            Clear selection
          </button>
        )}
      </div>
      <div
        className="statement-grid-scroll"
        role="region"
        aria-label="Scrollable statement transactions"
        tabIndex={0}
      >
        <table>
          <caption className="statement-grid-sr">
            AI parsed statement transactions and import decisions
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  aria-label="Select this page"
                  disabled={busy || !eligible.length}
                  checked={allSelected}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [
                            ...new Set([
                              ...old,
                              ...eligible.map((r) => r.sourceRow),
                            ]),
                          ]
                        : old.filter(
                            (n) => !eligible.some((r) => r.sourceRow === n),
                          ),
                    )
                  }
                />
              </th>
              {[
                'Date',
                'Transaction',
                'Type / Category',
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
            {visible.map((row) => {
              const decision = decisions[row.sourceRow],
                group = reviewGroup(row, decision),
                fix = props.corrections[row.sourceRow]
              const match = row.candidates.find(
                (c) => c.id === decision?.matchId,
              )
              const locked = row.status === 'already_imported',
                blocked = !!row.errors.length || !!row.reviewReason
              return (
                <Fragment key={row.sourceRow}>
                  <tr
                    className={
                      selected.includes(row.sourceRow) ? 'is-selected' : ''
                    }
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select row ${row.sourceRow}`}
                        checked={!locked && selected.includes(row.sourceRow)}
                        disabled={busy || locked}
                        onChange={(e) =>
                          setSelected((old) =>
                            e.target.checked
                              ? [...old, row.sourceRow]
                              : old.filter((n) => n !== row.sourceRow),
                          )
                        }
                      />
                    </td>
                    <td className="statement-grid-date">
                      {fix?.date ?? row.date ?? 'Missing date'}
                      <small>Row {row.sourceRow}</small>
                    </td>
                    <td className="statement-grid-description">
                      <strong>{fix?.description ?? row.description}</strong>
                      <small>
                        {row.reference
                          ? `Ref: ${fix?.reference ?? row.reference}`
                          : 'No bank reference'}
                      </small>
                      {match && decision?.action === 'match' && (
                        <small>Links to: {match.label}</small>
                      )}
                      {fix && (
                        <small className="statement-grid-warning">
                          Corrections staged — validate before importing
                        </small>
                      )}
                    </td>
                    <td>
                      <span className="statement-grid-kind">
                        {fix?.kind ?? row.kind}
                      </span>
                      <small>
                        {props.categories.find(
                          (c) =>
                            c.id ===
                            (fix && 'categoryId' in fix
                              ? fix.categoryId
                              : row.categoryId),
                        )?.name ?? 'Uncategorized'}
                      </small>
                    </td>
                    <td className={`statement-grid-amount ${row.direction}`}>
                      <strong>
                        {row.direction === 'debit' ? '−' : '+'}
                        {rupees(row.amountMinor)}
                      </strong>
                      <small>
                        {row.direction === 'debit' ? 'Money out' : 'Money in'}
                      </small>
                    </td>
                    <td>
                      <span className={`statement-grid-status ${group}`}>
                        {groupLabels[group]}
                      </span>
                      {blocked && (
                        <small className="statement-grid-warning">
                          Check statement fields
                        </small>
                      )}
                    </td>
                    <td>
                      <select
                        aria-label={`Decision for row ${row.sourceRow}`}
                        disabled={busy || locked}
                        value={
                          locked ? 'done' : (decision?.action ?? 'pending')
                        }
                        onChange={(e) => {
                          if (e.target.value === 'match') return
                          choose({
                            sourceRow: row.sourceRow,
                            action: e.target
                              .value as StatementSelection['action'],
                          })
                        }}
                      >
                        {locked ? (
                          <option value="done">Already imported</option>
                        ) : (
                          <>
                            <option value="pending">Review later</option>
                            {decision?.action === 'match' && (
                              <option value="match">
                                {group === 'auto'
                                  ? 'Auto-match selected'
                                  : 'Match selected'}
                              </option>
                            )}
                            <option value="new" disabled={blocked}>
                              Add as new
                            </option>
                            <option value="skip">Skip</option>
                          </>
                        )}
                      </select>
                    </td>
                  </tr>
                  <tr className="statement-grid-detail">
                    <td colSpan={7}>
                      <details className="statement-grid-row-details">
                        <summary>
                          {locked
                            ? 'View source and details'
                            : row.candidates.length
                              ? `Review row ${row.sourceRow} · ${row.candidates.length} possible ${row.candidates.length === 1 ? 'match' : 'matches'}`
                              : `Review row ${row.sourceRow} · edit fields or view source`}
                          {group === 'auto' ? ' · auto-match explanation' : ''}
                        </summary>
                        <BankRow row={row} {...props} />
                      </details>
                    </td>
                  </tr>
                </Fragment>
              )
            })}
            {!visible.length && (
              <tr>
                <td colSpan={7} className="statement-grid-empty">
                  No transactions match this view. Change the filter or search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <footer className="statement-grid-footer">
        <span>
          {filtered.length
            ? `${currentPage * 25 + 1}–${Math.min((currentPage + 1) * 25, filtered.length)}`
            : '0'}{' '}
          of {filtered.length} rows · 25 per page
        </span>
        <div>
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <span>
            Page {currentPage + 1} of {lastPage + 1}
          </span>
          <button
            type="button"
            disabled={currentPage >= lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      </footer>
    </section>
  )
}

function BankRow({
  row,
  decisions,
  corrections,
  accounts,
  categories,
  targetId,
  busy,
  sourceOpen,
  choose,
  change,
  correct,
}: Props & { row: ReviewedStatementRow }) {
  const decision = decisions[row.sourceRow] ?? {
    sourceRow: row.sourceRow,
    action: 'pending',
  }
  const fix = corrections[row.sourceRow] ?? {}
  const locked = row.status === 'already_imported'
  const selected = row.candidates.find((c) => c.id === decision.matchId)
  const used = new Set(
    Object.values(decisions)
      .filter((d) => d.sourceRow !== row.sourceRow && d.action === 'match')
      .map((d) => d.matchId),
  )
  const automatic =
    decision.action === 'match' && decision.matchId === row.autoMatch?.id
  const status = locked
    ? 'Already reconciled'
    : automatic
      ? 'Auto-matched'
      : decision.action === 'match'
        ? 'Match selected'
        : decision.action === 'new'
          ? 'New transaction'
          : decision.action === 'skip'
            ? 'Skipped'
            : 'Review later'
  const blocked = row.errors.length > 0 || !!row.reviewReason
  return (
    <article
      className="statement-review-row bank-review-row"
      aria-label={`Statement row ${row.sourceRow}`}
    >
      <div className="bank-review-heading">
        <div>
          <h4>{row.description}</h4>
          <p>
            {row.date ?? 'Date missing'} ·{' '}
            {row.direction === 'debit' ? 'Debit' : 'Credit'} ·{' '}
            <strong>{rupees(row.amountMinor)}</strong>
          </p>
        </div>
        <span className={`workflow-chip ${automatic ? 'bank-auto-match' : ''}`}>
          {status}
        </span>
      </div>
      {row.reference && (
        <p className="bank-reference">Reference: {row.reference}</p>
      )}
      {automatic && (
        <p className="bank-match-reason">{row.autoMatch?.reason}</p>
      )}
      {selected && decision.action === 'match' && (
        <div className="bank-selected-match">
          <strong>Existing transaction</strong>
          <p>
            {selected.date} · {selected.label} · {rupees(selected.amountMinor)}
          </p>
        </div>
      )}
      {row.reviewReason && <p className="workflow-error">{row.reviewReason}</p>}
      {row.errors.map((e) => (
        <p key={e} className="workflow-error">
          {e}
        </p>
      ))}
      {!locked && (
        <>
          {!automatic && row.candidates.length > 0 && (
            <div
              className="bank-candidates"
              aria-label={`Possible matches for row ${row.sourceRow}`}
            >
              <strong>Possible existing transactions</strong>
              {row.candidates.map((c) => {
                const unavailable =
                  c.alreadyLinked ||
                  used.has(c.id) ||
                  c.transactionType !== (fix.kind ?? row.kind)
                return (
                  <div className="bank-candidate" key={c.id}>
                    <div>
                      <p>
                        {c.date} · {c.label} ·{' '}
                        <strong>{rupees(c.amountMinor)}</strong>
                      </p>
                      {c.references?.length ? (
                        <small>Reference: {c.references.join(', ')}</small>
                      ) : null}
                      {unavailable && (
                        <small>
                          {c.alreadyLinked
                            ? 'Already linked to a statement row'
                            : used.has(c.id)
                              ? 'Selected for another row'
                              : 'Different transaction type — inspect the parsed fields'}
                        </small>
                      )}
                      {row.reference &&
                        c.references?.length &&
                        !c.references.includes(
                          row.reference.trim().toUpperCase(),
                        ) && (
                          <small>
                            Bank references differ. Check carefully before
                            matching.
                          </small>
                        )}
                    </div>
                    <button
                      className="secondary-button"
                      disabled={busy || blocked || unavailable}
                      onClick={() =>
                        choose({
                          sourceRow: row.sourceRow,
                          action: 'match',
                          matchId: c.id,
                        })
                      }
                    >
                      {decision.matchId === c.id && decision.action === 'match'
                        ? 'Selected'
                        : 'Match this'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <div className="workflow-toolbar bank-row-actions">
            {automatic ? (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  choose({ sourceRow: row.sourceRow, action: 'pending' })
                }
              >
                Change match
              </button>
            ) : (
              <button
                className="secondary-button"
                disabled={busy || blocked}
                onClick={() =>
                  choose({ sourceRow: row.sourceRow, action: 'new' })
                }
              >
                {row.candidates.length
                  ? 'Add as separate transaction'
                  : 'Add as new'}
              </button>
            )}
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                choose({ sourceRow: row.sourceRow, action: 'skip' })
              }
            >
              Skip
            </button>
            {!automatic && (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  choose({ sourceRow: row.sourceRow, action: 'pending' })
                }
              >
                Review later
              </button>
            )}
          </div>
          {decision.action === 'new' && row.candidates.length > 0 && (
            <label className="workflow-check">
              <input
                type="checkbox"
                disabled={busy}
                checked={decision.acknowledgeDuplicate ?? false}
                onChange={(e) =>
                  change(
                    row.sourceRow,
                    'acknowledgeDuplicate',
                    e.target.checked,
                  )
                }
              />
              This is a separate payment, not one of the existing transactions
              above.
            </label>
          )}
          {decision.action === 'new' &&
            (fix.kind ?? row.kind) === 'transfer' && (
              <label>
                Other transfer account
                <select
                  disabled={busy}
                  value={decision.otherAccountId ?? ''}
                  onChange={(e) =>
                    change(row.sourceRow, 'otherAccountId', e.target.value)
                  }
                >
                  <option value="">Choose account</option>
                  {accounts
                    .filter((a) => a.id !== targetId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          {decision.action === 'new' && (fix.kind ?? row.kind) === 'refund' && (
            <label>
              Original expense transaction ID
              <input
                disabled={busy}
                value={decision.originalTransactionId ?? ''}
                onChange={(e) =>
                  change(row.sourceRow, 'originalTransactionId', e.target.value)
                }
              />
            </label>
          )}
          <details>
            <summary>Inspect or correct statement fields</summary>
            <div className="workflow-fields">
              {(['date', 'amount', 'description', 'reference'] as const).map(
                (field) => (
                  <label key={field}>
                    {field === 'amount'
                      ? 'Amount ₹'
                      : field[0].toUpperCase() + field.slice(1)}
                    <input
                      type={field === 'date' ? 'date' : 'text'}
                      disabled={busy}
                      value={fix[field] ?? row[field] ?? ''}
                      onChange={(e) =>
                        correct(row.sourceRow, field, e.target.value)
                      }
                    />
                  </label>
                ),
              )}
              <label>
                Direction
                <select
                  disabled={busy}
                  value={fix.direction ?? row.direction}
                  onChange={(e) =>
                    correct(row.sourceRow, 'direction', e.target.value)
                  }
                >
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
              </label>
              <label>
                Transaction type
                <select
                  disabled={busy}
                  value={fix.kind ?? row.kind}
                  onChange={(e) =>
                    correct(row.sourceRow, 'kind', e.target.value)
                  }
                >
                  {[
                    'expense',
                    'income',
                    'transfer',
                    'investment',
                    'refund',
                  ].map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  disabled={busy}
                  value={
                    'categoryId' in fix
                      ? (fix.categoryId ?? '')
                      : (row.categoryId ?? '')
                  }
                  onChange={(e) =>
                    correct(row.sourceRow, 'categoryId', e.target.value || null)
                  }
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {(blocked || Object.keys(fix).length > 0) && (
              <label className="workflow-check">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={fix.confirmed ?? false}
                  onChange={(e) =>
                    correct(row.sourceRow, 'confirmed', e.target.checked)
                  }
                />
                I checked the corrected fields against the statement.
              </label>
            )}
          </details>
        </>
      )}
      {sourceOpen && (
        <pre className="statement-audit">
          {JSON.stringify(row.sourceCells, null, 2)}
        </pre>
      )}
    </article>
  )
}
