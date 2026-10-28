import { useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { FilterChips, type FilterChip } from '../shared/FilterChips'
import { emptyFilters, type FilterState } from '../../lib/transaction-filters'
export { emptyFilters, type FilterState } from '../../lib/transaction-filters'
const types: FilterState['type'][] = [
  'All',
  'Expense',
  'Income',
  'Transfer',
  'Investment',
  'Refund',
]
export function TransactionFilters({
  value,
  onChange,
  categories,
  accounts,
  monthScoped = false,
}: {
  value: FilterState
  onChange: (next: FilterState) => void
  categories: { id: string; name: string }[]
  accounts: { id: string; name: string }[]
  monthScoped?: boolean
}) {
  const set = <K extends keyof FilterState>(key: K, next: FilterState[K]) =>
    onChange({ ...value, [key]: next })
  const [expanded, setExpanded] = useState(false)
  const activeCount = Object.entries(value).filter(
    ([key, val]) => key !== 'search' && val !== 'All',
  ).length
  const chips: FilterChip[] = []
  if (value.search)
    chips.push({
      key: 'search',
      label: `Search: ${value.search}`,
      remove: () => set('search', ''),
    })
  for (const key of [
    'type',
    'category',
    'account',
    'source',
    'status',
  ] as const) {
    if (value[key] === 'All') continue
    const label =
      key === 'category'
        ? (categories.find((c) => c.id === value.category)?.name ??
          'Unavailable category')
        : key === 'account'
          ? (accounts.find((a) => a.id === value.account)?.name ??
            'Unavailable account')
          : value[key]
    chips.push({
      key,
      label: `${key[0].toUpperCase() + key.slice(1)}: ${label}`,
      remove: () => set(key, 'All'),
    })
  }
  if (!monthScoped && value.range !== 'All')
    chips.push({
      key: 'range',
      label: `Last ${value.range} days`,
      remove: () => set('range', 'All'),
    })
  return (
    <div className="filters-area">
      <label className="search-box">
        <Search />
        <span className="sr-only">Search transactions</span>
        <input
          type="search"
          value={value.search}
          onChange={(e) => set('search', e.target.value)}
          placeholder="Search transactions…"
        />
      </label>
      <button
        className="secondary-button filter-toggle"
        aria-expanded={expanded}
        aria-controls="transaction-filter-options"
        onClick={() => setExpanded(!expanded)}
      >
        <SlidersHorizontal />
        <span>Filters{activeCount ? ` (${activeCount})` : ''}</span>
      </button>
      <div
        id="transaction-filter-options"
        className="filter-selects"
        hidden={!expanded}
      >
        <label>
          <span>Type</span>
          <select
            value={value.type}
            onChange={(e) => set('type', e.target.value as FilterState['type'])}
          >
            {types.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Category</span>
          <select
            value={value.category}
            onChange={(e) => set('category', e.target.value)}
          >
            <option>All</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Account</span>
          <select
            value={value.account}
            onChange={(e) => set('account', e.target.value)}
          >
            <option>All</option>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {!monthScoped && (
          <label>
            <span>Date range</span>
            <select
              value={value.range}
              onChange={(e) =>
                set('range', e.target.value as FilterState['range'])
              }
            >
              <option value="All">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
        )}
        <label>
          <span>Source</span>
          <select
            value={value.source}
            onChange={(e) =>
              set('source', e.target.value as FilterState['source'])
            }
          >
            <option>All</option>
            <option>SMS</option>
            <option>Manual</option>
            <option>Import</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select
            value={value.status}
            onChange={(e) =>
              set('status', e.target.value as FilterState['status'])
            }
          >
            <option>All</option>
            <option>Pending</option>
            <option>Confirmed</option>
            <option>Ignored</option>
          </select>
        </label>
      </div>
      <FilterChips
        chips={chips}
        clear={() => onChange({ ...emptyFilters })}
        hint={monthScoped ? 'Selected dates stay unchanged.' : undefined}
      />
    </div>
  )
}
