import { useEffect, useState } from 'react'
import { apiRequest } from '../../api/client'
import { write, errorText, rupees, type Lookup } from '../../api/workflows'
import { parseMoney } from '../../../worker/lib/statement-parser'
import { Feedback } from './WorkflowShell'
export function SplitEditor({
  id,
  amountMinor,
  categoryId,
}: {
  id: string
  amountMinor: number
  categoryId?: string | null
}) {
  const [rows, setRows] = useState<{ categoryId: string; amount: string }[]>(
      [],
    ),
    [categories, setCategories] = useState<Lookup[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true)
  useEffect(() => {
    const c = new AbortController()
    Promise.all([
      apiRequest<{ category_id: string; amount_minor: number }[]>(
        '/api/transactions/' + id + '/splits',
        { signal: c.signal },
      ),
      apiRequest<Lookup[]>('/api/categories', { signal: c.signal }),
    ])
      .then(([splits, cats]) => {
        setRows(
          splits.map((s) => ({
            categoryId: s.category_id,
            amount: (s.amount_minor / 100).toFixed(2),
          })),
        )
        setCategories(
          cats.filter((cat) => cat.isActive !== false && cat.id !== categoryId),
        )
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorText(e))
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false)
      })
    return () => c.abort()
  }, [id, categoryId])
  const total = rows.reduce((n, r) => n + (parseMoney(r.amount) ?? 0), 0)
  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await write(
        '/api/transactions/' + id + '/splits',
        {
          splits: rows.map((r) => ({
            categoryId: r.categoryId,
            amountMinor: parseMoney(r.amount),
          })),
        },
        'PUT',
      )
      setNotice('Splits saved. Bank balance and total payment are unchanged.')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="split-editor" aria-label="Category splits">
      <h3>Split into categories</h3>
      <p>
        The main category keeps the remainder. This does not create another bank
        payment.
      </p>
      {loading ? (
        <p role="status">Loading allocations…</p>
      ) : (
        <>
          {rows.map((r, i) => (
            <div className="workflow-fields" key={i}>
              <label>
                Split category {i + 1}
                <select
                  value={r.categoryId}
                  onChange={(e) =>
                    setRows(
                      rows.map((row, j) =>
                        j === i ? { ...row, categoryId: e.target.value } : row,
                      ),
                    )
                  }
                >
                  <option value="">Select category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount ₹
                <input
                  inputMode="decimal"
                  value={r.amount}
                  onChange={(e) =>
                    setRows(
                      rows.map((row, j) =>
                        j === i ? { ...row, amount: e.target.value } : row,
                      ),
                    )
                  }
                />
              </label>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <p>
            Split total {rupees(total)} · Main category keeps{' '}
            <strong>{rupees(amountMinor - total)}</strong>
          </p>
          <div className="workflow-toolbar">
            <button
              className="secondary-button"
              disabled={busy || rows.length >= 10}
              onClick={() => setRows([...rows, { categoryId: '', amount: '' }])}
            >
              Add category
            </button>
            <button
              className="primary-button"
              disabled={busy || total > amountMinor}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : 'Save splits'}
            </button>
          </div>
        </>
      )}
      <Feedback error={error} notice={notice} />
    </section>
  )
}
