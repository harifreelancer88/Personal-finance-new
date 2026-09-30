import { formatCurrency, formatDate } from '../../lib/format'
import type { Transaction } from '../../types/finance'
import { TransactionActions } from './TransactionActions'
import { TransactionCard } from './TransactionCard'
import { TransactionIcon } from './TransactionIcon'
import { TypeBadge } from './TypeBadge'

type Props = { items: Transaction[]; onView: (item: Transaction) => void; onEdit: (item: Transaction) => void; onDelete: (item: Transaction) => void; onConfirm: (item: Transaction) => void; onIgnore: (item: Transaction) => void; statusBusy?: boolean }
export function TransactionTable({ items, onView, onEdit, onDelete, onConfirm, onIgnore, statusBusy = false }: Props) {
  if (!items.length) return <div className="empty-state"><h3>No transactions found</h3><p>Try adjusting your search or filters.</p></div>
  return <><div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>Date</th><th>Description / Merchant</th><th>Category</th><th>Account</th><th>Type</th><th>Amount</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{items.map(item => { const positive = item.type === 'Income' || item.type === 'Refund'; const neutral = item.type === 'Transfer'; return <tr key={item.id}>
    <td><strong>{formatDate(item.date)}</strong></td><td><div className="description-cell"><TransactionIcon type={item.type}/><div><strong>{item.description}</strong><small>{item.merchant}</small>{item.source === 'sms' && <span className="source-badge">SMS</span>}</div></div></td>
    <td><span className="category-badge">{item.category}</span></td><td>{item.account}</td><td><TypeBadge type={item.type}/></td><td><strong className={`amount ${positive ? 'positive' : ''} ${neutral ? 'neutral' : ''}`}>{positive ? '+' : neutral ? '' : '−'}{formatCurrency(item.amount)}</strong></td><td><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></td><td><TransactionActions transaction={item} busy={statusBusy} onView={() => onView(item)} onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} onConfirm={() => onConfirm(item)} onIgnore={() => onIgnore(item)}/></td>
  </tr>})}</tbody></table></div><div className="transaction-cards">{items.map(item => <TransactionCard key={item.id} item={item} busy={statusBusy} onView={() => onView(item)} onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} onConfirm={() => onConfirm(item)} onIgnore={() => onIgnore(item)}/>)}</div></>
}
