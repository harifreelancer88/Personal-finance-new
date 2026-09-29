import { Filter, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { PageHeader } from '../components/layout/PageHeader'
import { TransactionTable } from '../components/transactions/TransactionTable'
import { transactions } from '../data/mockData'
import type { TransactionType } from '../types/finance'

const filters: Array<'All' | TransactionType> = ['All', 'Expense', 'Income', 'Transfer', 'Investment']

export function TransactionsPage() {
  const { openMenu } = useOutletContext<{ openMenu: () => void }>()
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState<(typeof filters)[number]>('All')
  const visible = useMemo(() => transactions.filter(item => (filter === 'All' || item.type === filter) && `${item.description} ${item.merchant} ${item.category} ${item.account}`.toLowerCase().includes(search.toLowerCase())), [filter, search])
  return <><PageHeader title="Transactions" eyebrow="Money movement" onMenu={openMenu}/><div className="page-body">
    <div className="transaction-intro"><div><h2>All transactions</h2><p>Track and review spending across all your accounts.</p></div><button className="primary-button"><Plus size={18}/> Add transaction</button></div>
    <section className="transactions-panel panel"><div className="transaction-tools"><label className="search-box"><Search/><span className="sr-only">Search transactions</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search transactions..."/></label><button className="outline-button"><Filter/> Date range</button><button className="outline-button"><SlidersHorizontal/> More filters</button></div>
      <div className="filter-tabs" aria-label="Transaction type filters">{filters.map(type => <button className={filter === type ? 'active' : ''} onClick={() => setFilter(type)} key={type}>{type}<span>{type === 'All' ? transactions.length : transactions.filter(item => item.type === type).length}</span></button>)}</div>
      <TransactionTable items={visible}/><footer className="table-footer">Showing {visible.length} of {transactions.length} transactions <div><button disabled>Previous</button><button disabled>Next</button></div></footer>
    </section>
  </div></>
}
