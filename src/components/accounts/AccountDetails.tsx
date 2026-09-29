import { ArrowDownLeft, ArrowUpRight, CalendarDays, Pencil } from 'lucide-react'
import { transactions } from '../../data/mockData'
import { formatCurrency, formatDate } from '../../lib/format'
import type { Account } from '../../types/finance'
import { Modal } from '../transactions/Modal'
import { TransactionIcon } from '../transactions/TransactionIcon'
import { AccountIcon } from './AccountIcon'
import { CreditUtilization } from './CreditUtilization'

export function AccountDetails({ account, onClose, onEdit }: { account: Account; onClose: () => void; onEdit: () => void }) {
 const recent = transactions.filter(t => t.account.includes(account.institution) || t.fromAccount === account.institution || t.toAccount === account.institution).slice(0,5)
 const incoming = recent.filter(t => t.amount > 0).reduce((sum,t) => sum + t.amount, 0); const spent = recent.filter(t => t.amount < 0).reduce((sum,t) => sum + Math.abs(t.amount), 0)
 return <Modal title={account.name} description={`${account.institution} · ${account.maskedIdentifier}`} onClose={onClose}>
   <div className="account-details-hero"><AccountIcon account={account} large/><div><span>{account.type === 'Credit Card' ? 'Current outstanding' : 'Available balance'}</span><strong>{account.type === 'Credit Card' ? '−' : ''}{formatCurrency(account.balance)}</strong></div></div>
   {account.type === 'Credit Card' && account.creditLimit && <div className="details-credit"><CreditUtilization outstanding={account.balance} limit={account.creditLimit}/></div>}
   <div className="account-stats"><div><ArrowDownLeft/><span>Recent incoming<strong>{formatCurrency(incoming)}</strong></span></div><div><ArrowUpRight/><span>Recent spending<strong>{formatCurrency(spent)}</strong></span></div></div>
   <dl className="details-list account-info"><div><dt>Institution</dt><dd>{account.institution}</dd></div><div><dt>Account type</dt><dd>{account.type}</dd></div><div><dt>Identifier</dt><dd>{account.maskedIdentifier}</dd></div><div><dt>Status</dt><dd>{account.status ?? 'Active'}</dd></div>{account.type === 'Credit Card' && <><div><dt>Billing date</dt><dd><CalendarDays/> {account.billingDate}th of every month</dd></div><div><dt>Payment due</dt><dd><CalendarDays/> {account.dueDate}th of every month</dd></div></>}{account.notes && <div className="details-notes"><dt>Notes</dt><dd>{account.notes}</dd></div>}</dl>
   <section className="details-transactions"><h3>Recent transactions</h3>{recent.length ? recent.map(item => <div className="details-transaction" key={item.id}><TransactionIcon type={item.type}/><div><strong>{item.description}</strong><small>{formatDate(item.date)} · {item.category}</small></div><span className={item.amount > 0 ? 'positive-text' : 'negative-text'}>{item.amount > 0 ? '+' : '−'}{formatCurrency(item.amount)}</span></div>) : <p className="no-activity">No recent transactions for this account.</p>}</section>
   <footer className="dialog-footer"><button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" onClick={onEdit}><Pencil/>Edit account</button></footer>
 </Modal>
}
