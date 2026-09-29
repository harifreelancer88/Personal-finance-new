import { CalendarDays, CreditCard, Hash, Layers3 } from 'lucide-react'
import { formatCurrency, formatDate, formatTime } from '../../lib/format'
import type { Transaction } from '../../types/finance'
import { Modal } from './Modal'
import { TransactionIcon } from './TransactionIcon'
import { TypeBadge } from './TypeBadge'
export function TransactionDetails({ item, onClose, onEdit }: { item: Transaction; onClose: () => void; onEdit: () => void }) {
 const positive = item.type === 'Income' || item.type === 'Refund'; const neutral = item.type === 'Transfer'
 return <Modal title="Transaction details" description="Review the complete transaction record." onClose={onClose}><div className="details-hero"><TransactionIcon type={item.type}/><div><span>{item.description}</span><strong className={`amount ${positive ? 'positive' : ''} ${neutral ? 'neutral' : ''}`}>{positive ? '+' : neutral ? '' : '−'}{formatCurrency(item.amount)}</strong></div></div><dl className="details-list"><div><dt><CalendarDays/>Date & time</dt><dd>{formatDate(item.date)}, {formatTime(item.date)}</dd></div><div><dt><Layers3/>Category</dt><dd>{item.category}</dd></div><div><dt><CreditCard/>Account</dt><dd>{item.account}</dd></div><div><dt><Hash/>Reference</dt><dd>{item.id}</dd></div><div><dt>Type</dt><dd><TypeBadge type={item.type}/></dd></div><div><dt>Status</dt><dd><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></dd></div>{item.notes && <div className="details-notes"><dt>Notes</dt><dd>{item.notes}</dd></div>}</dl><footer className="dialog-footer"><button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" onClick={onEdit}>Edit transaction</button></footer></Modal>
}
