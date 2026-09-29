import { Ban, Check, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Transaction } from '../../types/finance'

export function TransactionActions({ transaction, onView, onEdit, onDelete, onConfirm, onIgnore }: { transaction: Transaction; onView: () => void; onEdit: () => void; onDelete: () => void; onConfirm?: () => void; onIgnore?: () => void }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close) }, [])
  const act = (fn: () => void) => { setOpen(false); fn() }
  return <div className="action-menu" ref={ref}><button className="action-trigger" aria-label={`Actions for ${transaction.description}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal /></button>{open && <div className="action-popover" role="menu"><button role="menuitem" onClick={() => act(onView)}><Eye />{transaction.source === 'sms' ? 'Review' : 'View'}</button><button role="menuitem" onClick={() => act(onEdit)}><Pencil />Edit</button>{transaction.source === 'sms' && transaction.status === 'Pending' && <><button role="menuitem" onClick={() => onConfirm && act(onConfirm)}><Check />Confirm</button><button role="menuitem" onClick={() => onIgnore && act(onIgnore)}><Ban />Ignore</button></>}{transaction.source === 'manual' && <button role="menuitem" className="danger" onClick={() => act(onDelete)}><Trash2 />Delete</button>}</div>}</div>
}
