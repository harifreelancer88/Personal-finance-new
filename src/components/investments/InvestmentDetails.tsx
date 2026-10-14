import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus } from 'lucide-react'
import {
  getActivity,
  addActivity,
  type HoldingActivity,
} from '../../api/investments'
import {
  formatWholeCurrency as formatCurrency,
  formatCurrency as formatUnitPrice,
  formatDate,
  formatWholeSignedCurrency as formatSignedCurrency,
} from '../../lib/format'
import type { Investment } from '../../types/finance'
import { Modal } from '../transactions/Modal'
const NpsDetails=lazy(()=>import('./NpsDetails').then(module=>({default:module.NpsDetails})))
function GeneralInvestmentDetails({
  investment: i,
  onClose,
  onEdit,
}: {
  investment: Investment
  onClose: () => void
  onEdit: () => void
}) {
  const [activity, setActivity] = useState<HoldingActivity[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [adding, setAdding] = useState(false),
    [busy, setBusy] = useState(false),
    [kind, setKind] = useState('contribution'),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [amount, setAmount] = useState(''),
    [description, setDescription] = useState('')
  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setActivity(await getActivity(i.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load activity.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [i.id])
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(amount) ||
      !Number.isSafeInteger(Math.round(Number(amount) * 100))
    ) {
      setError('Enter a non-negative amount with at most two decimals.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const item = await addActivity(i.id, {
        activityType: kind,
        activityDate: date,
        amountMinor: Math.round(Number(amount) * 100),
        description,
      })
      setActivity((old) =>
        [item, ...old].sort((a, b) =>
          b.activityDate.localeCompare(a.activityDate),
        ),
      )
      setAdding(false)
      setAmount('')
      setDescription('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save activity.')
    } finally {
      setBusy(false)
    }
  }
  const optional: [string, string | number | undefined][] = [
    ['Quantity', i.quantity],
    [
      'Average purchase price',
      i.averagePrice === undefined ? undefined : formatUnitPrice(i.averagePrice),
    ],
    [
      'Recorded unit price',
      i.currentPrice === undefined ? undefined : formatUnitPrice(i.currentPrice),
    ],
    ['Units', i.units],
    [
      'Average NAV',
      i.averageNav === undefined ? undefined : formatUnitPrice(i.averageNav),
    ],
    [
      'Recorded NAV',
      i.currentNav === undefined ? undefined : formatUnitPrice(i.currentNav),
    ],
    ['Weight (grams)', i.weightGrams],
    [
      'Monthly contribution',
      i.monthlyContribution === undefined
        ? undefined
        : formatCurrency(i.monthlyContribution),
    ],
    [
      'Interest rate',
      i.interestRate === undefined ? undefined : `${i.interestRate}%`,
    ],
    ['Maturity date', i.maturityDate ? formatDate(i.maturityDate) : undefined],
  ]
  return (
    <Modal
      title={i.name}
      description={`${i.type} · ${i.institution}`}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <div className="wealth-modal-body">
        <div className="wealth-detail-total">
          <span>Recorded current value</span>
          <strong>{formatCurrency(i.currentValue)}</strong>
          <small
            className={
              i.currentValue >= i.investedAmount
                ? 'wealth-positive'
                : 'wealth-negative'
            }
          >
            {formatSignedCurrency(i.currentValue - i.investedAmount)} ·{' '}
            {i.investedAmount > 0
              ? `${(((i.currentValue - i.investedAmount) / i.investedAmount) * 100).toFixed(1)}%`
              : 'Return unavailable'}
          </small>
        </div>
        <p className="wealth-caption">Gain is measured against the recorded basis. Imported opening balances can include prior interest and do not establish lifetime contributions or returns.</p>
        <dl className="wealth-detail-list">
          <div>
            <dt>Recorded basis</dt>
            <dd>{formatCurrency(i.investedAmount)}</dd>
          </div>
          <div>
            <dt>Start date</dt>
            <dd>{i.startDate ? formatDate(i.startDate) : 'Not recorded'}</dd>
          </div>
          {i.updatedAt && (
            <div>
              <dt>Last recorded edit</dt>
              <dd>{formatDate(i.updatedAt.replace(' ', 'T'))}</dd>
            </div>
          )}
          {optional
            .filter(([, v]) => v !== undefined)
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          {i.notes && (
            <div>
              <dt>Notes</dt>
              <dd>{i.notes}</dd>
            </div>
          )}
        </dl>
        <div className="wealth-section-heading">
          <h3>Activity history</h3>
          <button
            className="wealth-text-button"
            disabled={loading || busy}
            onClick={() => {
              setAdding(!adding)
              setError('')
            }}
          >
            <Plus />
            Log activity
          </button>
        </div>
        <p className="wealth-caption">
          Logging activity does not change holding values. Edit the holding to
          update portfolio totals.
        </p>
        {error && (
          <p className="wealth-error" role="alert">
            {error}
            {!adding && <button onClick={() => void load()}>Retry</button>}
          </p>
        )}
        {adding && (
          <form
            className="transaction-form wealth-activity-form"
            onSubmit={save}
          >
            <div className="form-grid">
              <label>
                <span>Activity type</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {[
                    'contribution',
                    'purchase',
                    'sale',
                    'dividend',
                    'interest',
                    'adjustment',
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Activity date</span>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                <span>Amount (₹)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                <span>Description</span>
                <input
                  required
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
            </div>
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? 'Saving…' : 'Save activity'}
            </button>
          </form>
        )}
        {loading ? (
          <p role="status">Loading activity…</p>
        ) : !error && !activity.length ? (
          <p className="wealth-caption">No activity recorded yet.</p>
        ) : (
          activity.map((a) => (
            <div className="wealth-activity-row" key={a.id}>
              <span>
                <strong>{a.description}</strong>
                <small>
                  {formatDate(a.activityDate)} · {a.activityType}
                </small>
              </span>
              <strong>{formatCurrency(a.amountMinor / 100)}</strong>
            </div>
          ))
        )}
      </div>
      <footer className="dialog-footer">
        <button className="secondary-button" disabled={busy} onClick={onClose}>
          Close
        </button>
        <button className="primary-button" disabled={busy} onClick={onEdit}>
          <Pencil />
          Edit holding
        </button>
      </footer>
    </Modal>
  )
}

export function InvestmentDetails(props: {investment: Investment; onClose:()=>void; onEdit:()=>void; onSaved?:()=>void}) {
  return props.investment.type === 'NPS' ? <Suspense fallback={<p role="status">Loading NPS details…</p>}><NpsDetails investment={props.investment} onClose={props.onClose} onSaved={props.onSaved}/></Suspense> : <GeneralInvestmentDetails {...props}/>
}
