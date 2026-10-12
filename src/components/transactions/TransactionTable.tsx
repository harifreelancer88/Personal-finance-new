import { Fragment } from 'react'
import { formatCurrency, formatDate } from '../../lib/format'
import type { Transaction } from '../../types/finance'
import { TransactionActions } from './TransactionActions'
import { TransactionCard } from './TransactionCard'
import { TransactionIcon } from './TransactionIcon'

type Props = { items: Transaction[]; onView: (item: Transaction) => void; onEdit: (item: Transaction) => void; onDelete: (item: Transaction) => void; onConfirm: (item: Transaction) => void; onIgnore: (item: Transaction) => void; statusBusy?: boolean }
export function TransactionTable({ items, onView, onEdit, onDelete, onConfirm, onIgnore, statusBusy = false }: Props) {
  if (!items.length) return <div className="empty-state"><h3>No transactions found</h3><p>Try adjusting your search or filters.</p></div>
  const groups = new Map<string, Transaction[]>()
  for (const item of items) { const key = item.date.slice(0,10); const group = groups.get(key) ?? []; group.push(item); groups.set(key,group) }
  const actions = (item:Transaction) => <TransactionActions transaction={item} busy={statusBusy} onView={() => onView(item)} onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} onConfirm={() => onConfirm(item)} onIgnore={() => onIgnore(item)}/>
  return <><div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>Merchant</th><th>Category</th><th>Account</th><th className="amount-heading">Amount</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{Array.from(groups,([date,rows]) => <Fragment key={date}><tr className="date-group"><th colSpan={6} scope="rowgroup">{formatDate(`${date}T12:00:00`)}</th></tr>{rows.map(item => { const positive = item.type === 'Income' || item.type === 'Refund'; const neutral = item.type === 'Transfer'; return <tr key={item.id}>
    <td><div className="description-cell"><TransactionIcon type={item.type} category={item.category}/><button className="merchant-link" onClick={() => onView(item)}>{item.description}</button></div></td>
    <td>{item.category}</td><td className="account-cell">{item.account}</td><td className="amount-cell"><strong className={`amount ${positive ? 'positive' : ''} ${neutral ? 'neutral' : ''}`}>{positive ? '+' : neutral ? '' : '−'}{formatCurrency(item.amount)}</strong></td><td><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></td><td>{actions(item)}</td>
  </tr>})}</Fragment>)}</tbody></table></div><div className="transaction-cards">{Array.from(groups,([date,rows]) => <section key={date} className="mobile-date-group"><h3>{formatDate(`${date}T12:00:00`)}</h3>{rows.map(item => <TransactionCard key={item.id} item={item} busy={statusBusy} onView={() => onView(item)} onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} onConfirm={() => onConfirm(item)} onIgnore={() => onIgnore(item)}/>)}</section>)}</div></>
}
