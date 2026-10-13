import { formatCurrency, formatDate } from '../../lib/format'
import type { Transaction } from '../../types/finance'
import { TransactionActions } from './TransactionActions'
import { TransactionIcon } from './TransactionIcon'

export function TransactionCard({
  item,
  onView,
  onEdit,
  onDelete,
  onConfirm,
  onIgnore,
  busy = false,
  selecting = false,
  selected = false,
  selectionDisabled = false,
  onSelect,
}: {
  item: Transaction
  onView: () => void
  onEdit: () => void
  onDelete: () => void
  onConfirm: () => void
  onIgnore: () => void
  busy?: boolean
  selecting?: boolean
  selected?: boolean
  selectionDisabled?: boolean
  onSelect?: () => void
}) {
  const positive = item.type === 'Income' || item.type === 'Refund'
  const neutral = item.type === 'Transfer'
  return (
    <article
      className={`transaction-card ${selecting ? 'selection-mode' : ''} ${selected ? 'selected' : ''}`}
    >
      {selecting && (
        <label className="transaction-select">
          <input
            type="checkbox"
            aria-label={`Select ${item.description} on ${item.date.slice(0, 10)}`}
            checked={selected}
            disabled={busy || selectionDisabled}
            onChange={onSelect}
          />
        </label>
      )}
      <TransactionIcon type={item.type} category={item.category} />
      <div className="mobile-transaction-body">
        <div className="mobile-transaction-top">
          <button className="merchant-link" onClick={onView}>
            {item.description}
          </button>
          <strong
            className={`amount ${positive ? 'positive' : ''} ${neutral ? 'neutral' : ''}`}
          >
            {positive ? '+' : neutral ? '' : '−'}
            {formatCurrency(item.amount)}
          </strong>
        </div>
        <div className="mobile-transaction-meta">
          <span>
            {item.category} · {item.account}{item.accountingDate && item.accountingDate !== item.date.slice(0, 10) && <small> · Received {formatDate(item.date)}</small>}
          </span>
          <span className={`status ${item.status.toLowerCase()}`}>
            {item.status}
          </span>
        </div>
      </div>
      <TransactionActions
        transaction={item}
        busy={busy}
        onView={onView}
        onEdit={onEdit}
        onDelete={onDelete}
        onConfirm={onConfirm}
        onIgnore={onIgnore}
      />
    </article>
  )
}
