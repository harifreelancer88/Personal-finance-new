import { CalendarDays, CreditCard, Hash, Layers3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getTransaction, type SmsDetails } from '../../api/transactions'
import { formatCurrency, formatDate } from '../../lib/format'
import type { Transaction } from '../../types/finance'
import { Modal } from './Modal'
import { TransactionIcon } from './TransactionIcon'
import { TypeBadge } from './TypeBadge'

type Props = { item: Transaction; onClose: () => void; onEdit: () => void; busy?: boolean; onConfirm?: () => void; onIgnore?: () => void }
export function TransactionDetails({ item, onClose, onEdit, busy = false, onConfirm, onIgnore }: Props) {
  const positive = item.type === 'Income' || item.type === 'Refund', neutral = item.type === 'Transfer'
  const [sms, setSms] = useState<SmsDetails | null>(), [error, setError] = useState<string>(), [loading, setLoading] = useState(item.source === 'sms'), [retry, setRetry] = useState(0)
  useEffect(() => {
    if (item.source !== 'sms') return
    const controller = new AbortController()
    setLoading(true); setError(undefined); setSms(undefined)
    getTransaction(item.id, controller.signal).then(data => { if (!controller.signal.aborted) setSms(data.sms ?? null) })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load the original SMS.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [item.id, item.source, retry])
  return <Modal title={item.source === 'sms' ? 'Review SMS transaction' : 'Transaction details'} description={item.source === 'sms' ? 'Compare the parsed record with the original message before confirming.' : 'Review the complete transaction record.'} onClose={onClose}>
    <div className="details-hero"><TransactionIcon type={item.type}/><div><span>{item.description}</span><strong className={`amount ${positive ? 'positive' : ''} ${neutral ? 'neutral' : ''}`}>{positive ? '+' : neutral ? '' : '−'}{formatCurrency(item.amount)}</strong></div></div>
    <dl className="details-list"><div><dt><CalendarDays/>Transaction date</dt><dd>{formatDate(item.date)}</dd></div><div><dt><Layers3/>Category</dt><dd>{item.category}</dd></div><div><dt><CreditCard/>Account</dt><dd>{item.account}</dd></div><div><dt><Hash/>Reference</dt><dd>{item.id}</dd></div><div><dt>Type</dt><dd><TypeBadge type={item.type}/></dd></div><div><dt>Status</dt><dd><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></dd></div>{item.notes && <div className="details-notes"><dt>Notes</dt><dd>{item.notes}</dd></div>}</dl>
    {item.source === 'sms' && <section className="sms-original" aria-label="Original SMS"><h3>Original SMS</h3>{loading ? <p role="status">Loading original message…</p> : error ? <div className="api-feedback" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => setRetry(value => value+1)}>Try again</button></div> : sms ? <><dl className="sms-metadata"><div><dt>Sender</dt><dd>{sms.sender || 'Not recorded'}</dd></div><div><dt>Received</dt><dd>{new Intl.DateTimeFormat('en-IN', { dateStyle:'medium', timeStyle:'short' }).format(new Date(sms.receivedAt))}</dd></div><div><dt>Parse status</dt><dd>{sms.parseStatus.replaceAll('_',' ')}</dd></div><div><dt>Parse confidence</dt><dd>{sms.parseConfidence ?? 'Not recorded'}</dd></div></dl><pre>{sms.rawText}</pre></> : <p>The original SMS is unavailable for this record.</p>}</section>}
    <footer className="dialog-footer sms-review-footer"><button className="secondary-button" onClick={onClose} disabled={busy}>Close</button><button className="secondary-button" onClick={onEdit} disabled={busy}>Edit transaction</button>{item.source === 'sms' && item.status === 'Pending' && <><button className="secondary-button" onClick={onIgnore} disabled={busy || !onIgnore}>Ignore</button><button className="primary-button" onClick={onConfirm} disabled={busy || loading || !sms || !onConfirm}>{busy ? 'Updating…' : 'Confirm'}</button></>}</footer>
  </Modal>
}
