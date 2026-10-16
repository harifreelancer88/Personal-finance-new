import { useEffect, useState, type FormEvent } from 'react'
import { apiRequest } from '../api/client'
import {
  write,
  errorText,
  rupees,
  today,
  lookups,
  type Lookup,
  type Pivot,
  type PivotRow,
} from '../api/workflows'
import { WorkflowShell, Feedback } from '../components/workflows/WorkflowShell'
import { Modal } from '../components/transactions/Modal'
interface Filters {
  from: string
  to: string
  dimension: string
  accountId: string
  categoryId: string
}
interface Saved {
  id: string
  name: string
  filters_json: string
}
export default function AnalyticsPage() {
  const [filters, setFilters] = useState<Filters>({
      from: today().slice(0, 4) + '-01-01',
      to: today(),
      dimension: 'category',
      accountId: '',
      categoryId: '',
    }),
    [data, setData] = useState<Pivot>(),
    [choices, setChoices] = useState<{
      accounts: Lookup[]
      categories: Lookup[]
    }>({ accounts: [], categories: [] }),
    [views, setViews] = useState<Saved[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [name, setName] = useState(''),
    [detail, setDetail] = useState<{ row: PivotRow; month: string }>()
  useEffect(() => {
    let alive = true
    Promise.all([lookups(), apiRequest<Saved[]>('/api/analytics/views')])
      .then(([l, v]) => {
        if (alive) {
          setChoices(l)
          setViews(v)
        }
      })
      .catch((e) => {
        if (alive) setError(errorText(e))
      })
    return () => {
      alive = false
    }
  }, [])
  const run = async (event?: FormEvent) => {
    event?.preventDefault()
    setBusy(true)
    setError('')
    setData(undefined)
    try {
      setData(
        await apiRequest<Pivot>(
          '/api/analytics/pivot?' + new URLSearchParams({ ...filters }),
        ),
      )
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await write('/api/analytics/views', { name, filters })
      setViews(await apiRequest<Saved[]>('/api/analytics/views'))
      setNotice('View saved with these exact dates and filters.')
      setName('')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const change = (key: keyof Filters, value: string) => {
    setFilters({ ...filters, [key]: value })
    setData(undefined)
  }
  return (
    <WorkflowShell
      title="Comparison reports"
      description="Compare recorded spending by category, merchant description or account. Click a monthly amount to inspect the records behind it."
    >
      <Feedback error={error} notice={notice} />
      <section className="panel">
        <form className="workflow-form" onSubmit={(e) => void run(e)}>
          <div className="workflow-fields">
            <label>
              From
              <input
                type="date"
                required
                value={filters.from}
                max={filters.to}
                onChange={(e) => change('from', e.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                required
                value={filters.to}
                min={filters.from}
                max={today()}
                onChange={(e) => change('to', e.target.value)}
              />
            </label>
            <label>
              Compare by
              <select
                value={filters.dimension}
                onChange={(e) => change('dimension', e.target.value)}
              >
                <option value="category">Category</option>
                <option value="merchant">Merchant description</option>
                <option value="account">Account</option>
              </select>
            </label>
          </div>
          <div className="workflow-fields">
            <label>
              Account
              <select
                value={filters.accountId}
                onChange={(e) => change('accountId', e.target.value)}
              >
                <option value="">All accounts</option>
                {choices.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select
                value={filters.categoryId}
                onChange={(e) => change('categoryId', e.target.value)}
              >
                <option value="">All categories</option>
                {choices.categories.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Saved view
              <select
                defaultValue=""
                onChange={(e) => {
                  const v = views.find((v) => v.id === e.target.value)
                  if (v) {
                    setFilters(JSON.parse(v.filters_json))
                    setData(undefined)
                  }
                }}
              >
                <option value="">Choose a view</option>
                {views.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="workflow-toolbar">
            <button className="primary-button" disabled={busy}>
              {busy ? 'Loading…' : 'Run report'}
            </button>
            {data && (
              <a
                className="secondary-button"
                href={
                  '/api/analytics/export?' + new URLSearchParams({ ...filters })
                }
                download
              >
                Download CSV
              </a>
            )}
          </div>
        </form>
      </section>
      {data && (
        <section className="panel">
          <h2>Net recorded spending · {rupees(data.totalMinor)}</h2>
          <p>
            {data.from} – {data.to}. Confirmed expenses less eligible refunds;
            transfers and investments excluded. Refunds appear in the month
            received. Category cells show allocated amounts; account and
            merchant totals count each payment once.
          </p>
          {!data.rows.length ? (
            <p>No matching activity in this period.</p>
          ) : (
            <div className="workflow-table">
              <table>
                <caption>Monthly spending in INR</caption>
                <thead>
                  <tr>
                    <th>{data.dimension}</th>
                    {data.months.map((m) => (
                      <th key={m}>{m}</th>
                    ))}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.key}>
                      <th>{row.label}</th>
                      {data.months.map((m) => (
                        <td key={m}>
                          <button
                            className="workflow-cell"
                            disabled={
                              !row.entries.some((e) => e.date.startsWith(m))
                            }
                            onClick={() => setDetail({ row, month: m })}
                          >
                            {rupees(row.values[m])}
                          </button>
                        </td>
                      ))}
                      <td>
                        <strong>{rupees(row.totalMinor)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    {data.months.map((m) => (
                      <td key={m}>{rupees(data.totals[m])}</td>
                    ))}
                    <td>{rupees(data.totalMinor)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <div className="workflow-toolbar">
            <label>
              Save view as
              <input
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Family spending 2026"
              />
            </label>
            <button
              className="secondary-button"
              disabled={busy || !name.trim()}
              onClick={() => void save()}
            >
              Save dates and filters
            </button>
          </div>
        </section>
      )}
      {!data && !busy && !error && (
        <section className="panel workflow-empty">
          <h2>Choose a period to compare</h2>
          <p>Run a report to see monthly totals and drill into transactions.</p>
        </section>
      )}
      {detail && (
        <Modal
          title={`${detail.row.label} · ${detail.month}`}
          onClose={() => setDetail(undefined)}
        >
          <div className="workflow-table">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount included</th>
                </tr>
              </thead>
              <tbody>
                {detail.row.entries
                  .filter((e) => e.date.startsWith(detail.month))
                  .map((e) => (
                    <tr key={e.id}>
                      <td>{e.date}</td>
                      <td>{e.description}</td>
                      <td>{rupees(e.amountMinor)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p>
            Negative amounts are refunds. Category allocations may be smaller
            than the full bank payment.
          </p>
        </Modal>
      )}
    </WorkflowShell>
  )
}
