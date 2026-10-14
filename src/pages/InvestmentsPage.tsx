import {
  Menu,
  Plus,
  RefreshCw,
  Search,
  ChevronDown,
  Eye,
  Pencil,
  Trash2,
  Layers,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  getInvestments,
  investmentTypes,
  saveInvestment,
  removeInvestment,
} from '../api/investments'
import { RetirementNotice } from '../components/payroll/RetirementNotice'
import { InvestmentForm } from '../components/investments/InvestmentForm'
import { InvestmentDetails } from '../components/investments/InvestmentDetails'
import { Modal } from '../components/transactions/Modal'
import { formatWholeCurrency as formatCurrency, formatWholeSignedCurrency as formatSignedCurrency } from '../lib/format'
import type { Investment } from '../types/finance'
const colors = [
  '#5594bd',
  '#7d72b1',
  '#d3aa48',
  '#67a890',
  '#ba829d',
  '#819cab',
  '#ad8869',
  '#aaa49b',
]
export function InvestmentsPage() {
  const { openMenu } = useOutletContext<{ openMenu: () => void }>(),
    [items, setItems] = useState<Investment[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('All types'),
    [editing, setEditing] = useState<Investment | null>(),
    [viewing, setViewing] = useState<Investment>(),
    [deleting, setDeleting] = useState<Investment>(),
    [busy, setBusy] = useState(false),
    [deleteError, setDeleteError] = useState(''),
    [collapsed, setCollapsed] = useState<string[]>([])
  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await getInvestments())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load investments.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  const invested =
      items.reduce((sum, i) => sum + Math.round(i.investedAmount * 100), 0) /
      100,
    value =
      items.reduce((sum, i) => sum + Math.round(i.currentValue * 100), 0) / 100,
    gainItems = items.filter(i=>i.basisKind!=='unknown' && i.basisKind!=='opening_valuation'),
    gainBasis = gainItems.reduce((s,i)=>s+Math.round(i.investedAmount*100),0)/100,
    gain = gainItems.reduce((s,i)=>s+Math.round(i.currentValue*100)-Math.round(i.investedAmount*100),0)/100
  const groups = investmentTypes
    .map((type, index) => ({
      type,
      color: colors[index],
      items: items.filter((i) => i.type === type),
      visible: items.filter(
        (i) =>
          i.type === type &&
          (filter === 'All types' || filter === type) &&
          `${i.name} ${i.institution}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    }))
    .filter((g) => g.items.length)
  let cumulative = 0
  const gradient = groups
    .filter((g) => g.items.some((i) => i.currentValue > 0))
    .map((g) => {
      const begin = cumulative
      cumulative +=
        (g.items.reduce((s, i) => s + i.currentValue, 0) / value) * 100
      return `${g.color} ${begin}% ${cumulative}%`
    })
    .join(',')
  return (
    <>
      <header className="activity-header">
        <button
          className="activity-menu"
          onClick={openMenu}
          aria-label="Open navigation"
        >
          <Menu />
        </button>
        <h1>Investments</h1>
        <div className="wealth-header-actions">
          <button
            className="wealth-icon"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh investments"
          >
            <RefreshCw className={loading ? 'spinning' : ''} />
          </button>
          <button
            className="wealth-add"
            onClick={() => setEditing(null)}
            aria-label="Add holding"
          >
            <Plus />
            <span>Add holding</span>
          </button>
        </div>
      </header>
      <main className="wealth-page">
        <RetirementNotice onReview={id=>setViewing(items.find(item=>item.id===id))}/>
        {error && (
          <p className="wealth-error" role="alert">
            {error} <button onClick={() => void load()}>Try again</button>
          </p>
        )}
        {loading ? (
          <p role="status" className="wealth-empty">
            Loading saved portfolio…
          </p>
        ) : (
          !error && (
            <>
              <div className="wealth-metrics investment-overview">
                {[
                  ['Current value', formatCurrency(value)],
                  ['Recorded basis', formatCurrency(invested)],
                  ['Gain on comparable holdings', gainItems.length?formatSignedCurrency(gain):'Unavailable'],
                  [
                    'Return',
                    gainBasis > 0
                      ? `${((gain / gainBasis) * 100).toFixed(1)}%`
                      : '—',
                  ],
                ].map(([label, total], index) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong
                      className={
                        index > 1
                          ? gain >= 0
                            ? 'wealth-positive'
                            : 'wealth-negative'
                          : ''
                      }
                    >
                      {total}
                    </strong>
                  </div>
                ))}
              </div>
              <p className="wealth-caption">
                Amounts shown in whole rupees; calculations retain paise. Return is change against the recorded basis, not annualized.
                Opening valuations and holdings with unknown purchase cost are excluded from gain and return. Imported EPF opening balances can include prior interest; recorded-basis change is not lifetime return.
              </p>
              <div className="wealth-grid">
                <section className="wealth-holdings">
                  <div className="wealth-toolbar">
                    <label className="wealth-search">
                      <Search />
                      <input
                        aria-label="Search holdings"
                        placeholder="Search holdings…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="Filter asset type"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option>All types</option>
                      {investmentTypes.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  {!items.length ? (
                    <div className="wealth-empty">
                      <Layers />
                      <h2>Your portfolio starts here</h2>
                      <p>
                        Add a holding and record its invested amount and current
                        value.
                      </p>
                      <button
                        className="wealth-add"
                        onClick={() => setEditing(null)}
                      >
                        <Plus />
                        Add your first holding
                      </button>
                    </div>
                  ) : !groups.some((g) => g.visible.length) ? (
                    <p className="wealth-empty">
                      No holdings match your search.
                    </p>
                  ) : (
                    groups
                      .filter((g) => g.visible.length)
                      .map((g) => (
                        <section className="wealth-group" key={g.type}>
                          <button
                            className="wealth-group-title"
                            aria-expanded={!collapsed.includes(g.type)}
                            onClick={() =>
                              setCollapsed((old) =>
                                old.includes(g.type)
                                  ? old.filter((t) => t !== g.type)
                                  : [...old, g.type],
                              )
                            }
                          >
                            <span>
                              <span
                                className="wealth-dot"
                                style={{ background: g.color }}
                              />
                              {g.type}
                              <small>{g.visible.length}</small>
                            </span>
                            <span>
                              {formatCurrency(
                                g.visible.reduce(
                                  (s, i) => s + i.currentValue,
                                  0,
                                ),
                              )}
                              <ChevronDown
                                className={
                                  collapsed.includes(g.type) ? 'rotated' : ''
                                }
                              />
                            </span>
                          </button>
                          {!collapsed.includes(g.type) &&
                            g.visible.map((i) => (
                              <div className="wealth-row" key={i.id}>
                                <button
                                  className="wealth-holding-title"
                                  onClick={() => setViewing(i)}
                                >
                                  <span
                                    className="wealth-avatar"
                                    style={{
                                      color: g.color,
                                      background: g.color + '18',
                                    }}
                                  >
                                    <Layers />
                                  </span>
                                  <span>
                                    <strong>{i.name}</strong>
                                    <small>{i.institution}</small>
                                  </span>
                                </button>
                                <div className="wealth-holding-value">
                                  <strong>
                                    {formatCurrency(i.currentValue)}
                                  </strong>
                                  <small
                                    className={
                                      i.currentValue >= i.investedAmount
                                        ? 'wealth-positive'
                                        : 'wealth-negative'
                                    }
                                  >
                                    {i.basisKind==='unknown'||i.basisKind==='opening_valuation'?'Historical profit unavailable':formatSignedCurrency(i.currentValue-i.investedAmount)}
                                    {i.basisKind!=='unknown'&&i.basisKind!=='opening_valuation'&&i.investedAmount > 0
                                      ? ` (${(((i.currentValue - i.investedAmount) / i.investedAmount) * 100).toFixed(1)}%)`
                                      : ''}
                                  </small>
                                </div>
                                <details className="wealth-row-actions">
                                  <summary aria-label={`Actions for ${i.name}`}>
                                    •••
                                  </summary>
                                  <div>
                                    <button onClick={() => setViewing(i)}>
                                      <Eye />
                                      View holding
                                    </button>
                                    <button onClick={() => setEditing(i)}>
                                      <Pencil />
                                      Edit holding
                                    </button>
                                    <button
                                      onClick={() => {
                                        setDeleteError('')
                                        setDeleting(i)
                                      }}
                                    >
                                      <Trash2 />
                                      Delete holding
                                    </button>
                                  </div>
                                </details>
                              </div>
                            ))}
                        </section>
                      ))
                  )}
                </section>
                <aside className="wealth-allocation wealth-panel">
                  <h2>Asset allocation</h2>
                  <p>By recorded current value</p>
                  {value > 0 ? (
                    <>
                      <div
                        className="wealth-donut"
                        role="img"
                        aria-label={`Portfolio allocation. ${groups.map((g) => `${g.type}: ${((g.items.reduce((s, i) => s + i.currentValue, 0) / value) * 100).toFixed(1)} percent`).join('. ')}`}
                        style={{ background: `conic-gradient(${gradient})` }}
                      >
                        <div>
                          <small>Portfolio value</small>
                          <strong>{formatCurrency(value, true)}</strong>
                        </div>
                      </div>
                      <ul>
                        {groups.map((g) => {
                          const total = g.items.reduce(
                            (s, i) => s + i.currentValue,
                            0,
                          )
                          return (
                            <li key={g.type}>
                              <span>
                                <span
                                  className="wealth-dot"
                                  style={{ background: g.color }}
                                />
                                {g.type}
                              </span>
                              <strong>
                                {((total / value) * 100).toFixed(1)}%
                              </strong>
                            </li>
                          )
                        })}
                      </ul>
                    </>
                  ) : (
                    <p className="wealth-empty">
                      Allocation appears when a holding has a recorded value
                      above zero.
                    </p>
                  )}
                </aside>
              </div>
            </>
          )
        )}
      </main>
      {editing !== undefined && (
        <InvestmentForm
          initial={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSave={async (item) => {
            const saved = await saveInvestment(item, Boolean(editing))
            setItems((old) =>
              editing
                ? old.map((i) => (i.id === saved.id ? saved : i))
                : [...old, saved],
            )
            setEditing(undefined)
          }}
        />
      )}
      {viewing && (
        <InvestmentDetails
            onSaved={()=>{setViewing(undefined);void load()}}
          investment={viewing}
          onClose={() => setViewing(undefined)}
          onEdit={() => {
            setEditing(viewing)
            setViewing(undefined)
          }}
        />
      )}
      {deleting && (
        <Modal
          title="Delete holding"
          description={deleting.name}
          onClose={() => {
            if (!busy) setDeleting(undefined)
          }}
        >
          <div className="wealth-modal-body">
            <p>
              This permanently removes the holding. Holdings with activity
              history cannot be deleted.
            </p>
            {deleteError && (
              <p role="alert" className="wealth-error">
                {deleteError}
              </p>
            )}
          </div>
          <footer className="dialog-footer">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setDeleting(undefined)}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await removeInvestment(deleting.id)
                  setItems((old) => old.filter((i) => i.id !== deleting.id))
                  setDeleting(undefined)
                } catch (e) {
                  setDeleteError(
                    e instanceof Error
                      ? e.message
                      : 'Could not delete holding.',
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Deleting…' : 'Delete holding'}
            </button>
          </footer>
        </Modal>
      )}
    </>
  )
}
