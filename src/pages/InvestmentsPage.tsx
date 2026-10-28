import { InvestmentExplorer } from '../components/investments/InvestmentExplorer'
import {
  exploreHoldings,
  holdingTotals,
  holdingSorts,
  freshnessLabels,
} from '../lib/investment-explorer'
import { todayInIndia } from '../lib/dashboard-preview'
import { ZerodhaSync } from '../components/investments/ZerodhaSync'
import { Menu, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
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
import {
  formatWholeCurrency as formatCurrency,
  formatWholeSignedCurrency as formatSignedCurrency,
} from '../lib/format'
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
    [editing, setEditing] = useState<Investment | null>(),
    [viewing, setViewing] = useState<Investment>(),
    [deleting, setDeleting] = useState<Investment>(),
    [busy, setBusy] = useState(false),
    [deleteError, setDeleteError] = useState('')
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
  const [params, setParams] = useSearchParams()
  const search = params.get('search') ?? ''
  const type = investmentTypes.includes(
    params.get('assetType') as (typeof investmentTypes)[number],
  )
    ? params.get('assetType')!
    : 'all'
  const freshness = Object.hasOwn(
    freshnessLabels,
    params.get('freshness') ?? '',
  )
    ? (params.get('freshness') as keyof typeof freshnessLabels)
    : 'all'
  const sort = Object.hasOwn(holdingSorts, params.get('sort') ?? '')
    ? (params.get('sort') as keyof typeof holdingSorts)
    : 'valueDesc'
  const asOf = todayInIndia()
  const matching = exploreHoldings(items, search, type, freshness, sort, asOf)
  const totals = holdingTotals(matching)
  const invested = totals.basisMinor / 100,
    value = totals.valueMinor / 100,
    gain = totals.gainMinor / 100,
    gainBasis = totals.gainBasisMinor / 100
  const groups = investmentTypes
    .map((type, index) => ({
      type,
      color: colors[index],
      items: matching.filter((i) => i.type === type),
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
        <ZerodhaSync onSaved={() => void load()} />
        <RetirementNotice
          onReview={(id) => setViewing(items.find((item) => item.id === id))}
        />
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
              <p className="wealth-caption" role="status">
                Showing {matching.length} of {items.length} holdings. Summary
                and allocation follow your filters.
              </p>
              <div className="wealth-metrics investment-overview">
                {[
                  ['Current value', formatCurrency(value)],
                  ['Recorded basis', formatCurrency(invested)],
                  [
                    'Gain on comparable holdings',
                    totals.comparableCount
                      ? formatSignedCurrency(gain)
                      : 'Unavailable',
                  ],
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
                        index > 1 &&
                        totals.comparableCount > 0 &&
                        (index === 2 || gainBasis > 0)
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
                Amounts shown in whole rupees; calculations retain paise. Return
                is change against the recorded basis, not annualized. Opening
                valuations and holdings with unknown purchase cost are excluded
                from gain and return. Imported EPF opening balances can include
                prior interest; recorded-basis change is not lifetime return.
              </p>
              <div className="wealth-grid">
                <section className="wealth-holdings">
                  <InvestmentExplorer
                    rows={matching}
                    total={items.length}
                    search={search}
                    type={type}
                    freshness={freshness}
                    sort={sort}
                    asOf={asOf}
                    change={(changes) => {
                      const next = new URLSearchParams(params)
                      for (const [key, value] of Object.entries(changes)) {
                        if (value === '' || value === 'all') next.delete(key)
                        else next.set(key, value)
                      }
                      setParams(next, { replace: 'search' in changes })
                    }}
                    onView={setViewing}
                    onEdit={setEditing}
                    onDelete={(i) => {
                      setDeleteError('')
                      setDeleting(i)
                    }}
                  />
                </section>
                <aside className="wealth-allocation wealth-panel">
                  <h2>Asset allocation</h2>
                  <p>Matching holdings · recorded current value</p>
                  {value > 0 ? (
                    <>
                      <div
                        className="wealth-donut"
                        role="img"
                        aria-label={`Portfolio allocation. ${groups.map((g) => `${g.type}: ${((g.items.reduce((s, i) => s + i.currentValue, 0) / value) * 100).toFixed(1)} percent`).join('. ')}`}
                        style={{ background: `conic-gradient(${gradient})` }}
                      >
                        <div>
                          <small>Matching value</small>
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
          onSaved={() => {
            setViewing(undefined)
            void load()
          }}
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
