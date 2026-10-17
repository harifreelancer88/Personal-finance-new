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

export default function BankStatementReview(props: Props) {
  const { rows, decisions, busy, choose } = props
  const groups = {
    manual: [] as ReviewedStatementRow[],
    auto: [] as ReviewedStatementRow[],
    new: [] as ReviewedStatementRow[],
    done: [] as ReviewedStatementRow[],
  }
  for (const row of rows) {
    const decision = decisions[row.sourceRow]
    if (row.status === 'already_imported') groups.done.push(row)
    else if (
      row.autoMatch &&
      decision?.action === 'match' &&
      decision.matchId === row.autoMatch.id
    )
      groups.auto.push(row)
    else if (row.status === 'new' && !['transfer', 'refund'].includes(row.kind))
      groups.new.push(row)
    else groups.manual.push(row)
  }
  const render = (row: ReviewedStatementRow) => (
    <BankRow key={row.sourceRow} row={row} {...props} />
  )
  return (
    <div className="bank-review-groups">
      <section aria-label="Needs your review">
        <h3>Needs your review · {groups.manual.length}</h3>
        <p>
          Choose a match, add a separate transaction, or skip. Rows marked
          “Review later” stay pending.
        </p>
        {groups.manual.length ? (
          <div className="statement-review-list">
            {groups.manual.map(render)}
          </div>
        ) : (
          <p>No uncertain rows to resolve.</p>
        )}
      </section>
      <details className="bank-review-group">
        <summary>Auto-matched · {groups.auto.length} — view matches</summary>
        <p>
          Selected for confirmation. These link to existing payments; they do
          not create another transaction.
        </p>
        <div className="statement-review-list">{groups.auto.map(render)}</div>
      </details>
      <details className="bank-review-group" open={groups.new.length > 0}>
        <summary>New transactions · {groups.new.length}</summary>
        <div className="statement-review-list">{groups.new.map(render)}</div>
      </details>
      {!!groups.done.length && (
        <details className="bank-review-group">
          <summary>Already reconciled · {groups.done.length}</summary>
          <p>Previously linked. These will not be added again.</p>
          <div className="statement-review-list">{groups.done.map(render)}</div>
        </details>
      )}
      {!!rows.length && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            for (const row of rows)
              if (row.status !== 'already_imported')
                choose({ sourceRow: row.sourceRow, action: 'pending' })
          }}
        >
          Review all decisions myself
        </button>
      )}
    </div>
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
