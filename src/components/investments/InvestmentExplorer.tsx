import { Fragment, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { investmentTypes } from '../../api/investments'
import { FilterChips, type FilterChip } from '../shared/FilterChips'
import {
  freshnessLabels,
  holdingGainMinor,
  holdingSorts,
} from '../../lib/investment-explorer'
import { valuationFreshness } from '../../lib/dashboard-preview'
import {
  formatCurrency,
  formatSignedCurrency,
  formatDate,
} from '../../lib/format'
import type { Investment } from '../../types/finance'
import { HoldingExpansion } from './HoldingExpansion'
import './investment-explorer.css'
export function InvestmentExplorer({
  rows,
  total,
  search,
  type,
  freshness,
  sort,
  asOf,
  change,
  onView,
  onEdit,
  onDelete,
}: {
  rows: Investment[]
  total: number
  search: string
  type: string
  freshness: keyof typeof freshnessLabels
  sort: keyof typeof holdingSorts
  asOf: string
  change: (changes: Record<string, string>) => void
  onView: (i: Investment) => void
  onEdit: (i: Investment) => void
  onDelete: (i: Investment) => void
}) {
  const scope = JSON.stringify([search, type, freshness, sort])
  const [expanded, setExpanded] = useState<string[]>([])
  const [pagination, setPagination] = useState({ scope, page: 0 })
  const page = pagination.scope === scope ? pagination.page : 0
  const last = Math.max(0, Math.ceil(rows.length / 20) - 1),
    current = Math.min(page, last),
    visible = rows.slice(current * 20, current * 20 + 20)
  const chips: FilterChip[] = []
  if (search)
    chips.push({
      key: 'search',
      label: `Search: ${search}`,
      remove: () => change({ search: '' }),
    })
  if (type !== 'all')
    chips.push({
      key: 'type',
      label: `Type: ${type}`,
      remove: () => change({ assetType: 'all' }),
    })
  if (freshness !== 'all')
    chips.push({
      key: 'freshness',
      label: freshnessLabels[freshness],
      remove: () => change({ freshness: 'all' }),
    })
  return (
    <section className="investment-explorer" aria-label="Holdings explorer">
      <div className="investment-filter-toolbar">
        <label className="investment-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search holdings"
            placeholder="Name or institution…"
            value={search}
            onChange={(e) => change({ search: e.target.value })}
          />
        </label>
        <label>
          Asset type
          <select
            value={type}
            onChange={(e) => change({ assetType: e.target.value })}
          >
            <option value="all">All types</option>
            {investmentTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Valuation date
          <select
            value={freshness}
            onChange={(e) => change({ freshness: e.target.value })}
          >
            {Object.entries(freshnessLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select
            value={sort}
            onChange={(e) => change({ sort: e.target.value })}
          >
            {Object.entries(holdingSorts).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FilterChips
        chips={chips}
        clear={() => change({ search: '', assetType: 'all', freshness: 'all' })}
      />
      <div className="investment-grid-caption">
        <h2>Holdings</h2>
        <span role="status">
          {rows.length} of {total} holdings · totals include all matches
        </span>
      </div>
      {!rows.length ? (
        <p className="wealth-empty">
          No holdings match these filters. Clear filters to see your portfolio.
        </p>
      ) : (
        <>
          <table className="investment-grid">
            <caption className="sr-only">
              Recorded holdings, comparable gains and valuation dates
            </caption>
            <thead>
              <tr>
                <th>
                  <span className="sr-only">Details</span>
                </th>
                <th scope="col">Holding</th>
                <th scope="col">Value</th>
                <th scope="col" className="investment-gain">
                  Gain
                </th>
                <th scope="col" className="investment-date">
                  Valuation date
                </th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => {
                const open = expanded.includes(i.id),
                  gain = holdingGainMinor(i),
                  dateState = valuationFreshness(i.valuationDate, asOf)
                return (
                  <Fragment key={i.id}>
                    <tr>
                      <td>
                        <button
                          className="holding-chevron"
                          aria-label={`${open ? 'Collapse' : 'Expand'} ${i.name}`}
                          aria-expanded={open}
                          aria-controls={`holding-${i.id}`}
                          onClick={() =>
                            setExpanded((old) =>
                              open
                                ? old.filter((id) => id !== i.id)
                                : [...old, i.id],
                            )
                          }
                        >
                          <ChevronDown
                            size={17}
                            style={{
                              transform: open ? 'rotate(180deg)' : undefined,
                            }}
                          />
                        </button>
                      </td>
                      <td>
                        <button
                          className="holding-name"
                          onClick={() => onView(i)}
                        >
                          {i.name}
                        </button>
                        <small>
                          {i.institution} · {i.type}
                        </small>
                        <span className={`valuation-badge ${dateState}`}>
                          {dateState === 'undated'
                            ? 'Date needs review'
                            : dateState === 'older'
                              ? 'Over 90 days old'
                              : 'Dated'}
                        </span>
                      </td>
                      <td className="holding-number">
                        {formatCurrency(i.currentValue)}
                      </td>
                      <td
                        className={`holding-number investment-gain ${gain === null ? '' : gain < 0 ? 'wealth-negative' : 'wealth-positive'}`}
                      >
                        {gain === null ? (
                          <span title="Unknown cost or opening valuation">
                            Unavailable
                          </span>
                        ) : (
                          formatSignedCurrency(gain / 100)
                        )}
                      </td>
                      <td className="investment-date">
                        {dateState === 'undated'
                          ? 'Not verified'
                          : formatDate(i.valuationDate!)}
                      </td>
                      <td>
                        <details className="holding-menu">
                          <summary aria-label={`Actions for ${i.name}`}>
                            •••
                          </summary>
                          <div>
                            <button onClick={() => onView(i)}>
                              Manage holding
                            </button>
                            <button onClick={() => onEdit(i)}>
                              Edit holding
                            </button>
                            <button onClick={() => onDelete(i)}>
                              Delete holding
                            </button>
                          </div>
                        </details>
                      </td>
                    </tr>
                    {open && (
                      <tr className="holding-detail-row" id={`holding-${i.id}`}>
                        <td colSpan={6}>
                          <p className="holding-mobile-details">
                            Valuation:{' '}
                            {dateState === 'undated'
                              ? 'Date needs review'
                              : formatDate(i.valuationDate!)}{' '}
                            · Gain:{' '}
                            {gain === null
                              ? 'Unavailable'
                              : formatSignedCurrency(gain / 100)}
                          </p>
                          <HoldingExpansion item={i} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          <footer className="investment-grid-footer">
            <span>
              {current * 20 + 1}–{Math.min((current + 1) * 20, rows.length)} of{' '}
              {rows.length}
            </span>
            <div>
              <button
                disabled={current === 0}
                onClick={() => setPagination({ scope, page: current - 1 })}
              >
                Previous
              </button>
              <span>
                Page {current + 1} of {last + 1}
              </span>
              <button
                disabled={current >= last}
                onClick={() => setPagination({ scope, page: current + 1 })}
              >
                Next
              </button>
            </div>
          </footer>
        </>
      )}
      <p className="investment-grid-note">
        Dated does not mean a live quote. Dates over 90 days old are
        highlighted. Missing, invalid or future dates need review.
      </p>
    </section>
  )
}
