import { useEffect, useState, type FormEvent } from 'react'
import { apiRequest } from '../api/client'
import {
  write,
  errorText,
  rupees,
  lookups,
  type Lookup,
  type ImportPreview,
  type ImportHistory,
} from '../api/workflows'
import { parseCsv } from '../../worker/lib/statement-parser'
import { WorkflowShell, Feedback } from '../components/workflows/WorkflowShell'
export default function ImportsPage() {
  const [csv, setCsv] = useState(''),
    [filename, setFilename] = useState('statement.csv'),
    [header, setHeader] = useState<string[]>([]),
    [account, setAccount] = useState(''),
    [format, setFormat] = useState('DMY'),
    [preserve, setPreserve] = useState(false),
    [mapping, setMapping] = useState<Record<string, string>>({
      date: '',
      description: '',
      amount: '',
      debit: '',
      credit: '',
      reference: '',
    }),
    [choices, setChoices] = useState<{
      accounts: Lookup[]
      categories: Lookup[]
    }>({ accounts: [], categories: [] }),
    [preview, setPreview] = useState<ImportPreview>(),
    [selected, setSelected] = useState<number[]>([]),
    [categories, setCategories] = useState<Record<string, string>>({}),
    [history, setHistory] = useState<ImportHistory[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const refresh = () =>
    apiRequest<ImportHistory[]>('/api/imports').then(setHistory)
  useEffect(() => {
    let alive = true
    Promise.all([lookups(), apiRequest<ImportHistory[]>('/api/imports')])
      .then(([l, h]) => {
        if (alive) {
          setChoices(l)
          setHistory(h)
        }
      })
      .catch((e) => {
        if (alive) setError(errorText(e))
      })
    return () => {
      alive = false
    }
  }, [])
  const applyPreview = (p: ImportPreview) => {
    setPreview(p)
    setCategories({})
    setSelected(
      p.rows
        .filter((r) => !r.error && !r.candidates.length)
        .map((r) => r.number),
    )
  }
  const loadFile = async (file?: File) => {
    setError('')
    setPreview(undefined)
    setHeader([])
    setCsv('')
    if (!file) return
    if (file.size > 500_000) {
      setError('Choose a CSV or text statement smaller than 500 KB.')
      return
    }
    try {
      const text = await file.text(),
        rows = parseCsv(text)
      setCsv(text)
      setFilename(file.name)
      setHeader(rows[0] ?? [])
      const fields: Record<string, string> = {}
      for (const key of Object.keys(mapping)) {
        const aliases: Record<string, string[]> = {
          date: ['date', 'transaction date', 'txn date'],
          description: ['description', 'narration', 'particulars', 'remarks'],
          amount: ['amount', 'signed amount'],
          debit: ['debit', 'withdrawal', 'withdrawal amt.'],
          credit: ['credit', 'deposit', 'deposit amt.'],
          reference: ['reference', 'reference no', 'utr', 'ref no'],
        }
        const index = (rows[0] ?? []).findIndex((c) =>
          aliases[key].includes(c.trim().toLowerCase()),
        )
        fields[key] = index < 0 ? '' : String(index)
      }
      if (fields.amount) {
        fields.debit = ''
        fields.credit = ''
      }
      setMapping(fields)
    } catch (e) {
      setError(errorText(e))
    }
  }
  const makePreview = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const p = await write<ImportPreview>('/api/imports', {
        csv,
        fileName: filename,
        accountId: account,
        dateFormat: format,
        mapping,
        preserveBalance: preserve,
      })
      if (p.status !== 'preview') {
        setPreview(undefined)
        setNotice(
          `This exact statement is already ${p.status}. Check import history.`,
        )
      } else applyPreview(p)
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const commit = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      const result = await write<{
        imported: number
        balanceChangeMinor: number
      }>('/api/imports/' + preview.id + '/commit', {
        selectedRows: selected,
        categories,
        acceptDuplicateRows: preview.rows
          .filter((r) => r.candidates.length && selected.includes(r.number))
          .map((r) => r.number),
      })
      setNotice(
        `${result.imported} transactions imported. Balance change: ${rupees(result.balanceChangeMinor)}.`,
      )
      setPreview(undefined)
      await refresh()
    } catch (e) {
      setError(errorText(e))
      try {
        applyPreview(
          await apiRequest<ImportPreview>('/api/imports/' + preview.id),
        )
      } catch {
        /* Keep the original failure visible. */
      }
    } finally {
      setBusy(false)
    }
  }
  const undo = async (id: string) => {
    if (
      !window.confirm(
        'Undo this import? Only its unedited, unlinked transactions will be removed; existing transactions are preserved.',
      )
    )
      return
    setBusy(true)
    setError('')
    try {
      await write('/api/imports/' + id + '/undo', {})
      setNotice('Import undone. Existing records were preserved.')
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const delta =
    preview?.rows
      .filter((r) => selected.includes(r.number))
      .reduce(
        (n, r) => n + (r.type === 'income' ? r.amountMinor : -r.amountMinor),
        0,
      ) ?? 0
  return (
    <WorkflowShell
      title="Statement import centre"
      description="Fill gaps in SMS capture using a bank or card statement. Review dates, amounts and possible duplicates before posting."
    >
      <Feedback error={error} notice={notice} />
      <section className="panel">
        <h2>Import CSV statement</h2>
        <p>
          CSV and delimited text · up to 500 rows / 500 KB. For PDF statements,
          export CSV from the provider first. No statement data is sent to an AI
          service.
        </p>
        <form className="workflow-form" onSubmit={makePreview}>
          <label>
            Statement file
            <input
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              disabled={busy}
              onChange={(e) => void loadFile(e.target.files?.[0])}
            />
          </label>
          <div className="workflow-fields">
            <label>
              Account
              <select
                required
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value)
                  setPreview(undefined)
                }}
              >
                <option value="">Choose account</option>
                {choices.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date convention
              <select
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value)
                  setPreview(undefined)
                }}
              >
                <option value="DMY">Day / month / year (India)</option>
                <option value="MDY">Month / day / year</option>
                <option value="ISO">YYYY-MM-DD only</option>
              </select>
            </label>
          </div>
          {header.length > 0 && (
            <>
              <div className="workflow-fields">
                {Object.keys(mapping).map((key) => (
                  <label key={key}>
                    {key === 'amount'
                      ? 'Signed amount'
                      : key[0].toUpperCase() + key.slice(1)}{' '}
                    column
                    <select
                      value={mapping[key]}
                      onChange={(e) => {
                        setMapping({ ...mapping, [key]: e.target.value })
                        setPreview(undefined)
                      }}
                    >
                      <option value="">Not mapped</option>
                      {header.map((h, i) => (
                        <option key={i} value={String(i)}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p>
                Use a signed amount column (negative means debit), or map
                separate debit and credit columns. ₹1,25,000.50 is supported.
              </p>
              <label className="workflow-check">
                <input
                  type="checkbox"
                  checked={preserve}
                  onChange={(e) => {
                    setPreserve(e.target.checked)
                    setPreview(undefined)
                  }}
                />
                Historical backfill: preserve the current account balance
              </label>
              <p>
                {preserve
                  ? 'Imported history will be offset against the opening balance. The offset is recorded for undo.'
                  : 'Selected income and expenses will change the account balance. Review the impact below.'}
              </p>
              <button
                className="primary-button"
                disabled={busy || !csv || !account}
              >
                {busy ? 'Checking…' : 'Preview statement'}
              </button>
            </>
          )}
        </form>
      </section>
      {preview && preview.status === 'preview' && (
        <section className="panel">
          <h2>Review {preview.rows.length} rows</h2>
          <p>
            Possible duplicates start unchecked. Select one only if you have
            verified that it is a separate payment. Imports are confirmed
            records: check transfers, refunds and investments carefully; omit
            them here and record them using their proper transaction types.
          </p>
          <div className="workflow-table">
            <table>
              <thead>
                <tr>
                  <th>Import</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Direction / amount</th>
                  <th>Category</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.number}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Import row ${r.number}`}
                        disabled={!!r.error || busy}
                        checked={selected.includes(r.number)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, r.number]
                              : selected.filter((n) => n !== r.number),
                          )
                        }
                      />
                    </td>
                    <td>{r.date || 'Invalid date'}</td>
                    <td>{r.description}</td>
                    <td>
                      {r.type} {rupees(r.amountMinor)}
                    </td>
                    <td>
                      <select
                        aria-label={`Category for row ${r.number}`}
                        value={categories[String(r.number)] ?? ''}
                        onChange={(e) =>
                          setCategories({
                            ...categories,
                            [r.number]: e.target.value,
                          })
                        }
                      >
                        <option value="">Uncategorized</option>
                        {choices.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {r.error ? (
                        <span className="workflow-error">{r.error}</span>
                      ) : r.candidates.length ? (
                        <details>
                          <summary>Possible duplicate</summary>
                          {r.candidates.map((c) => (
                            <p key={c.id}>
                              {c.transaction_date} · {c.description} ·{' '}
                              {rupees(c.amount_minor)}
                            </p>
                          ))}
                        </details>
                      ) : (
                        'Ready'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <strong>{selected.length} selected</strong> · Proposed balance
            change {rupees((preview.preserveBalance ?? preserve) ? 0 : delta)}
          </p>
          <button
            className="primary-button"
            disabled={busy || !selected.length}
            onClick={() => void commit()}
          >
            {busy
              ? 'Importing…'
              : `Import ${selected.length} selected transactions`}
          </button>
        </section>
      )}
      <section className="panel">
        <h2>Import history</h2>
        {!history.length ? (
          <p>No imports yet.</p>
        ) : (
          <ul className="workflow-history">
            {history.map((h) => (
              <li key={h.id}>
                <div>
                  <strong>{h.file_name}</strong>
                  <p>
                    {h.created_at} · {h.status}
                  </p>
                </div>
                {h.status === 'committed' && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void undo(h.id)}
                  >
                    Undo import
                  </button>
                )}
                {h.status === 'preview' && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true)
                      apiRequest<ImportPreview>('/api/imports/' + h.id)
                        .then(applyPreview)
                        .catch((e) => setError(errorText(e)))
                        .finally(() => setBusy(false))
                    }}
                  >
                    Resume review
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </WorkflowShell>
  )
}
