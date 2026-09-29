import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { transactions } from '../../data/mockData'
import { formatCurrency, formatDate } from '../../lib/format'
import { TransactionIcon } from '../transactions/TransactionIcon'
import { TypeBadge } from '../transactions/TypeBadge'

export function RecentTransactions() {
  return <section className="panel recent-panel"><div className="section-heading"><div><p className="eyebrow">Latest activity</p><h2>Recent transactions</h2></div><Link className="text-link" to="/transactions">View all <ArrowRight size={16}/></Link></div>
    <div className="recent-list">{transactions.slice(0, 5).map(item => <article className="recent-row" key={item.id}><TransactionIcon type={item.type}/><div className="recent-name"><strong>{item.description}</strong><small>{item.merchant}</small></div><TypeBadge type={item.type}/><div className="recent-date"><span>{formatDate(item.date)}</span><small>{item.account}</small></div><strong className={`amount ${item.amount > 0 ? 'positive' : ''}`}>{item.amount > 0 ? '+' : '−'}{formatCurrency(item.amount)}</strong></article>)}</div>
  </section>
}
