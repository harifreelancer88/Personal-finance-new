import { Search, X } from 'lucide-react'
import type { TransactionType } from '../../types/finance'
export type FilterState = { search: string; type: 'All' | TransactionType; category: string; account: string; range: 'All' | '7' | '30' | '90'; source: 'All' | 'SMS' | 'Manual'; status: 'All' | 'Pending' | 'Confirmed' | 'Ignored' }
export const emptyFilters: FilterState = { search: '', type: 'All', category: 'All', account: 'All', range: 'All', source: 'All', status: 'All' }
const types: FilterState['type'][] = ['All', 'Expense', 'Income', 'Transfer', 'Investment', 'Refund']
export function TransactionFilters({ value, onChange, categories, accounts }: { value: FilterState; onChange: (next: FilterState) => void; categories: { id: string; name: string }[]; accounts: { id: string; name: string }[] }) {
  const set = <K extends keyof FilterState>(key: K, next: FilterState[K]) => onChange({ ...value, [key]: next })
  const dirty = JSON.stringify(value) !== JSON.stringify(emptyFilters)
  return <div className="filters-area"><label className="search-box"><Search/><span className="sr-only">Search transactions</span><input value={value.search} onChange={e => set('search', e.target.value)} placeholder="Search merchant, category or account…"/></label><div className="filter-selects">
    <label><span>Type</span><select value={value.type} onChange={e => set('type', e.target.value as FilterState['type'])}>{types.map(item => <option key={item}>{item}</option>)}</select></label>
    <label><span>Category</span><select value={value.category} onChange={e => set('category', e.target.value)}><option>All</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label><span>Account</span><select value={value.account} onChange={e => set('account', e.target.value)}><option>All</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label><span>Date range</span><select value={value.range} onChange={e => set('range', e.target.value as FilterState['range'])}><option value="All">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
    <label><span>Source</span><select value={value.source} onChange={e => set('source', e.target.value as FilterState['source'])}><option>All</option><option>SMS</option><option>Manual</option></select></label>
    <label><span>Status</span><select value={value.status} onChange={e => set('status', e.target.value as FilterState['status'])}><option>All</option><option>Pending</option><option>Confirmed</option><option>Ignored</option></select></label>
    {dirty && <button className="clear-filters" onClick={() => onChange(emptyFilters)}><X/>Clear filters</button>}
  </div></div>
}
