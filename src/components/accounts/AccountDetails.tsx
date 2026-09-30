import { CalendarDays, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getTransactions, type TransactionDto } from '../../api/transactions'
import { formatCurrency, formatSignedCurrency, formatDate } from '../../lib/format'
import type { Account } from '../../types/finance'
import { Modal } from '../transactions/Modal'
import { TransactionIcon } from '../transactions/TransactionIcon'
import { AccountIcon } from './AccountIcon'
import { CreditUtilization } from './CreditUtilization'

const titleCase=(value:string)=>`${value[0].toUpperCase()}${value.slice(1)}` as 'Expense'|'Income'|'Transfer'|'Investment'|'Refund'
export function AccountDetails({ account, onClose, onEdit }: { account: Account; onClose: () => void; onEdit: () => void }) {
 const [recent,setRecent]=useState<TransactionDto[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState<string>()
 const displayedBalance=account.type==='Credit Card'?Math.max(0,-account.balance):account.balance
 useEffect(()=>{let active=true;getTransactions({accountId:account.id,limit:5}).then(items=>{if(active)setRecent(items)}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Could not load recent transactions.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[account.id])
 return <Modal title={account.name} description={`${account.institution || 'No institution'} · ${account.maskedIdentifier}`} onClose={onClose}>
   <div className="account-details-hero"><AccountIcon account={account} large/><div><span>{account.type === 'Credit Card' ? 'Current outstanding' : 'Available balance'}</span><strong>{formatSignedCurrency(displayedBalance)}</strong></div></div>
   {account.type === 'Credit Card' && account.creditLimit !== undefined && <div className="details-credit"><CreditUtilization outstanding={displayedBalance} limit={account.creditLimit}/></div>}
   <dl className="details-list account-info"><div><dt>Institution</dt><dd>{account.institution||'—'}</dd></div><div><dt>Account type</dt><dd>{account.type}</dd></div><div><dt>Identifier</dt><dd>{account.maskedIdentifier}</dd></div><div><dt>Status</dt><dd>{account.status ?? 'Active'}</dd></div>{account.openingBalanceDate&&<div><dt>Opening balance date</dt><dd><CalendarDays/> {formatDate(`${account.openingBalanceDate}T12:00:00`)}</dd></div>}{account.type === 'Credit Card' && <><div><dt>Billing day</dt><dd>{account.billingDate??'—'}</dd></div><div><dt>Payment due day</dt><dd>{account.dueDate??'—'}</dd></div></>}{account.notes && <div className="details-notes"><dt>Notes</dt><dd>{account.notes}</dd></div>}</dl>
   <section className="details-transactions"><h3>Recent transactions</h3>{loading?<p className="no-activity">Loading recent transactions…</p>:error?<p className="no-activity">{error}</p>:recent.length?recent.map(item=>{const incoming=item.toAccountId===account.id;return <div className="details-transaction" key={item.id}><TransactionIcon type={titleCase(item.transactionType)}/><div><strong>{item.description}</strong><small>{formatDate(`${item.transactionDate}T12:00:00`)} · {titleCase(item.transactionType)}</small></div><span className={incoming?'positive-text':'negative-text'}>{incoming?'+':'−'}{formatCurrency(item.amountMinor/100)}</span></div>}):<p className="no-activity">No recent transactions for this account.</p>}</section>
   <footer className="dialog-footer"><button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" onClick={onEdit}><Pencil/>Edit account</button></footer>
 </Modal>
}
