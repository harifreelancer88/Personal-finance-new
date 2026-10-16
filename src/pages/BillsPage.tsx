import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../api/client'
import {
  write,
  lookups,
  errorText,
  rupees,
  today,
  type Lookup,
  type BillsData,
  type BillPeriod,
  type BillPlan,
  type Candidate,
} from '../api/workflows'
import { parseMoney } from '../../worker/lib/statement-parser'
import { WorkflowShell, Feedback } from '../components/workflows/WorkflowShell'
import { Modal } from '../components/transactions/Modal'
export default function BillsPage() {
  const [data, setData] = useState<BillsData>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [create, setCreate] = useState(false),
    [pay, setPay] = useState<{ plan: BillPlan; period: BillPeriod }>(),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [candidate, setCandidate] = useState(''),
    [accept, setAccept] = useState(false),
    [choices, setChoices] = useState<{
      accounts: Lookup[]
      categories: Lookup[]
      investments: Lookup[]
    }>({ accounts: [], categories: [], investments: [] }),
    [type, setType] = useState('expense'),
    [requestId, setRequestId] = useState('')
  const load = useCallback(async () => {
    const next = await apiRequest<BillsData>('/api/bills')
    setData(next)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    apiRequest<BillsData>('/api/bills', { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e))
      })
    return () => controller.abort()
  }, [])
  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      setCreate(false)
      setPay(undefined)
      setNotice(message)
      await load()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const openCreate = async () => {
    setError('')
    try {
      setChoices(await lookups())
      setType('expense')
      setRequestId(crypto.randomUUID())
      setCreate(true)
    } catch (e) {
      setError(errorText(e))
    }
  }
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const f = new FormData(event.currentTarget)
    void act(
      () =>
        write('/api/bills', {
          requestId,
          name: f.get('name'),
          amountMinor: parseMoney(String(f.get('amount'))),
          accountId: f.get('account'),
          categoryId: f.get('category') || null,
          transactionType: type,
          investmentId: type === 'investment' ? f.get('investment') : null,
          firstDueDate: f.get('date'),
          frequency: f.get('frequency'),
          maxOccurrences: f.get('max') ? Number(f.get('max')) : null,
          openingPaidCount: Number(f.get('opening') || 0),
        }),
      'Bill schedule added. No cash transaction was created.',
    )
  }
  const openPay = async (plan: BillPlan, period: BillPeriod) => {
    setBusy(true)
    setError('')
    try {
      setCandidates(
        await apiRequest<Candidate[]>('/api/bills/' + plan.id + '/candidates'),
      )
      setCandidate('')
      setAccept(false)
      setPay({ plan, period })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <WorkflowShell
      title="Bills & instalments"
      description="Keep track of due payments and match them to real bank transactions. Schedules do not change your balances."
    >
      <Feedback error={error} notice={notice} />
      <div className="workflow-toolbar">
        <button
          className="primary-button"
          onClick={() => void openCreate()}
          disabled={busy}
        >
          Add bill or instalment
        </button>
        <button
          className="secondary-button"
          onClick={() => void load().catch((e) => setError(errorText(e)))}
        >
          Refresh
        </button>
        <Link to="/transactions?new=1">Record a payment in Transactions</Link>
      </div>
      {!data && !error && <p role="status">Loading bills…</p>}
      {data?.plans.length === 0 && (
        <section className="panel workflow-empty">
          <h2>No scheduled payments yet</h2>
          <p>
            Add a recurring bill or a fixed instalment plan. Enter any earlier
            paid count only when you have confirmed it.
          </p>
        </section>
      )}
      <div className="workflow-cards">
        {data?.plans.map((plan) => {
          const periods = data.periods.filter((p) => p.plan_id === plan.id),
            open = periods.find((p) => p.status === 'upcoming')
          return (
            <section className="panel bill-card" key={plan.id}>
              <div className="workflow-toolbar">
                <h2>{plan.name}</h2>
                <span className="workflow-chip">
                  {plan.transaction_type === 'investment'
                    ? 'Investment contribution'
                    : 'Expense'}
                </span>
              </div>
              <strong className="workflow-value">
                {rupees(plan.amount_minor)}
              </strong>
              <p>
                {plan.account_name} · {plan.paid_count} paid
                {plan.max_occurrences !== null
                  ? ` of ${plan.max_occurrences}`
                  : ''}{' '}
                · {plan.skipped_count} skipped
              </p>
              <p>
                {!plan.is_active
                  ? 'Paused'
                  : open
                    ? `Next due ${open.due_date}${open.due_date < data.today ? ' · Overdue' : open.due_date === data.today ? ' · Due today' : ''}`
                    : 'Schedule ended'}
              </p>
              <div className="workflow-toolbar">
                {open && !!plan.is_active && (
                  <>
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void openPay(plan, open)}
                    >
                      Match payment
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Skip this scheduled instalment? It will remain unpaid in history and consume this schedule slot.',
                          )
                        )
                          void act(
                            () =>
                              write('/api/bills/' + plan.id + '/skip', {
                                periodId: open.id,
                              }),
                            'Period skipped; paid count is unchanged.',
                          )
                      }}
                    >
                      Skip period
                    </button>
                  </>
                )}
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        write(
                          '/api/bills/' + plan.id,
                          { isActive: !plan.is_active },
                          'PATCH',
                        ),
                      plan.is_active ? 'Schedule paused.' : 'Schedule resumed.',
                    )
                  }
                >
                  {plan.is_active ? 'Pause' : 'Resume'}
                </button>
              </div>
              <details>
                <summary>Payment history</summary>
                <ul className="workflow-history">
                  {periods.map((p) => (
                    <li key={p.id}>
                      {p.due_date} <strong>{p.status}</strong>
                      {p.transaction_id && (
                        <small>Linked transaction: {p.transaction_id}</small>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )
        })}
      </div>
      {create && (
        <Modal
          title="Add scheduled payment"
          onClose={() => {
            if (!busy) setCreate(false)
          }}
        >
          <form className="workflow-form" onSubmit={save}>
            <label>
              Name
              <input
                name="name"
                required
                maxLength={200}
                placeholder="e.g. GRT monthly contribution"
              />
            </label>
            <div className="workflow-fields">
              <label>
                Expected amount (₹)
                <input name="amount" inputMode="decimal" required />
              </label>
              <label>
                Payment type
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="expense">Expense</option>
                  <option value="investment">Investment</option>
                </select>
              </label>
            </div>
            <label>
              Payment account
              <select name="account" required defaultValue="">
                <option value="" disabled>
                  Select account
                </option>
                {choices.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            {type === 'investment' ? (
              <label>
                Investment holding
                <select name="investment" required defaultValue="">
                  <option value="" disabled>
                    Select holding
                  </option>
                  {choices.investments
                    .filter(
                      (i) => !['epf', 'nps'].includes(i.investmentType ?? ''),
                    )
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <label>
                Category
                <select name="category">
                  <option value="">Uncategorized</option>
                  {choices.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="workflow-fields">
              <label>
                First unpaid due date
                <input
                  type="date"
                  name="date"
                  required
                  defaultValue={today()}
                />
              </label>
              <label>
                Repeats
                <select name="frequency">
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Yearly</option>
                </select>
              </label>
            </div>
            <div className="workflow-fields">
              <label>
                Total instalments (optional)
                <input name="max" type="number" min="1" max="600" />
              </label>
              <label>
                Previously paid instalments
                <input name="opening" type="number" min="0" defaultValue="0" />
              </label>
            </div>
            <p>
              Earlier paid instalments are a count only. No historical
              transactions or investment values are added.
            </p>
            <Feedback error={error} />
            <button className="primary-button" disabled={busy}>
              {busy ? 'Saving…' : 'Add schedule'}
            </button>
          </form>
        </Modal>
      )}
      {pay && (
        <Modal
          title={'Match payment · ' + pay.plan.name}
          onClose={() => {
            if (!busy) setPay(undefined)
          }}
        >
          <div className="workflow-form">
            <p>
              Expected {rupees(pay.plan.amount_minor)} · due{' '}
              {pay.period.due_date}. Suggestions cover ten days either side of
              the due date.
            </p>
            <label>
              Confirmed bank payment
              <select
                value={candidate}
                onChange={(e) => setCandidate(e.target.value)}
              >
                <option value="">Select payment</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.transaction_date} · {c.description} ·{' '}
                    {rupees(c.amount_minor)}
                  </option>
                ))}
              </select>
            </label>
            {candidates.length === 0 && (
              <p>
                No eligible payments.{' '}
                <Link to="/transactions?new=1">Record the real payment</Link>,
                then return here.
              </p>
            )}
            <label className="workflow-check">
              <input
                type="checkbox"
                checked={accept}
                onChange={(e) => setAccept(e.target.checked)}
              />
              I accept any difference from the expected amount.
            </label>
            <p>
              This links the existing transaction. Investment contributions
              enter the holding ledger once, awaiting credit confirmation.
            </p>
            <Feedback error={error} />
            <button
              className="primary-button"
              disabled={busy || !candidate}
              onClick={() =>
                void act(
                  () =>
                    write('/api/bills/' + pay.plan.id + '/pay', {
                      periodId: pay.period.id,
                      transactionId: candidate,
                      acceptAmountDifference: accept,
                    }),
                  'Payment matched. No duplicate cash transaction was created.',
                )
              }
            >
              {busy ? 'Matching…' : 'Confirm payment match'}
            </button>
          </div>
        </Modal>
      )}
    </WorkflowShell>
  )
}
