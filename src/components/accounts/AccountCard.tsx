import { Eye, Pencil, Trash2 } from 'lucide-react'
import { formatSignedCurrency } from '../../lib/format'
import type { Account } from '../../types/finance'
import { AccountIcon } from './AccountIcon'
import { CreditUtilization } from './CreditUtilization'

export function AccountCard({ account, onView, onEdit, onDelete }: { account: Account; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const outstanding = account.type === 'Credit Card'
  const displayedBalance = outstanding ? Math.max(0, -account.balance) : account.balance
  return <article className={`account-card ${account.color}`} onClick={onView}>
    <div className="account-card-head"><AccountIcon account={account}/><div><h3>{account.name}</h3><p>{account.institution}</p></div><span className="account-status">{account.status ?? 'Active'}</span></div>
    <div className="account-meta"><span>{account.type}</span><span>{account.maskedIdentifier}</span></div>
    <div className="account-card-balance"><small>{outstanding ? 'Current outstanding' : 'Available balance'}</small><strong className={displayedBalance < 0 || (outstanding && displayedBalance > 0) ? 'negative-text' : ''}>{formatSignedCurrency(displayedBalance)}</strong></div>
    {outstanding && account.creditLimit && <CreditUtilization outstanding={displayedBalance} limit={account.creditLimit}/>}
    <footer className="account-card-actions" onClick={event => event.stopPropagation()}><button onClick={onView}><Eye/>View</button><button onClick={onEdit}><Pencil/>Edit</button><button className="danger-link" onClick={onDelete}><Trash2/>Delete</button></footer>
  </article>
}
