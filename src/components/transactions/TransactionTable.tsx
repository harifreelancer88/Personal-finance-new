import { MoreHorizontal } from 'lucide-react'
import { formatCurrency, formatDate, formatTime } from '../../lib/format'
import type { Transaction } from '../../types/finance'
import { TransactionIcon } from './TransactionIcon'
import { TypeBadge } from './TypeBadge'

export function TransactionTable({ items }: { items: Transaction[] }) {
  if (!items.length) return <div className="empty-state"><h3>No transactions found</h3><p>Try adjusting your search or filters.</p></div>
  return <>
    <div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th>Type</th><th>Amount</th><th>Status / Action</th></tr></thead><tbody>{items.map(item => <tr key={item.id}>
      <td><strong>{formatDate(item.date)}</strong><small>{formatTime(item.date)}</small></td>
      <td><div className="description-cell"><TransactionIcon type={item.type}/><div><strong>{item.description}</strong><small>{item.merchant}</small></div></div></td>
      <td>{item.category}</td><td>{item.account}</td><td><TypeBadge type={item.type}/></td>
      <td><strong className={`amount ${item.amount > 0 ? 'positive' : ''}`}>{item.amount > 0 ? '+' : '−'}{formatCurrency(item.amount)}</strong></td>
      <td><div className="status-action"><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span><button aria-label={`Actions for ${item.description}`}><MoreHorizontal/></button></div></td>
    </tr>)}</tbody></table></div>
    <div className="transaction-cards">{items.map(item => <article className="transaction-card" key={item.id}><div className="card-row"><div className="description-cell"><TransactionIcon type={item.type}/><div><strong>{item.description}</strong><small>{item.merchant}</small></div></div><strong className={`amount ${item.amount > 0 ? 'positive' : ''}`}>{item.amount > 0 ? '+' : '−'}{formatCurrency(item.amount)}</strong></div><div className="card-tags"><TypeBadge type={item.type}/><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></div><dl><div><dt>Date</dt><dd>{formatDate(item.date)}</dd></div><div><dt>Category</dt><dd>{item.category}</dd></div><div><dt>Account</dt><dd>{item.account}</dd></div></dl></article>)}</div>
  </>
}
