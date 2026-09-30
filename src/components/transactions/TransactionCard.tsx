import { formatCurrency, formatDate } from '../../lib/format'
import type { Transaction } from '../../types/finance'
import { TransactionActions } from './TransactionActions'
import { TransactionIcon } from './TransactionIcon'
import { TypeBadge } from './TypeBadge'

export function TransactionCard({ item, onView, onEdit, onDelete, onConfirm, onIgnore, busy = false }: { item: Transaction; onView: () => void; onEdit: () => void; onDelete: () => void; onConfirm: () => void; onIgnore: () => void; busy?: boolean }) {
  const positive = item.type === 'Income' || item.type === 'Refund'; const neutral = item.type === 'Transfer'
  return <article className="transaction-card"><div className="card-row"><div className="description-cell"><TransactionIcon type={item.type}/><div><strong>{item.description}</strong><small>{formatDate(item.date)} · {item.account}</small></div></div><div className="mobile-amount"><strong className={`amount ${positive ? 'positive' : ''} ${neutral ? 'neutral' : ''}`}>{positive ? '+' : neutral ? '' : '−'}{formatCurrency(item.amount)}</strong><TransactionActions transaction={item} busy={busy} onView={onView} onEdit={onEdit} onDelete={onDelete} onConfirm={onConfirm} onIgnore={onIgnore}/></div></div><div className="card-tags"><span className="category-badge">{item.category}</span><TypeBadge type={item.type}/>{item.source === 'sms' && <span className="source-badge">SMS</span>}<span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></div></article>
}
