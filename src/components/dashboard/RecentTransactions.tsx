import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AccountDto } from '../../api/accounts'
import type { TransactionDto } from '../../api/transactions'
import { formatDate, formatMinorCurrency } from '../../lib/format'
import type { TransactionType } from '../../types/finance'
import { TransactionIcon } from '../transactions/TransactionIcon'
const titleCase=(value:string)=>`${value[0].toUpperCase()}${value.slice(1)}` as TransactionType
export function RecentTransactions({transactions,accounts}:{transactions:TransactionDto[];accounts:AccountDto[]}) {
  const name=(id:string|null)=>{const account=accounts.find(item=>item.id===id);return account ? `${account.institution||account.name}${account.last4?` · ${account.last4}`:''}` : id ? 'Account unavailable' : 'Unmapped account'}
  return <section className="panel dashboard-recent"><div className="dashboard-panel-heading"><h2>Recent transactions</h2><Link className="dashboard-view-all" to="/transactions">View all <ArrowRight/></Link></div>{!transactions.length?<div className="dashboard-empty"><h3>No confirmed transactions</h3><p>Your latest confirmed activity will appear here.</p></div>:<div className="dashboard-recent-list">{transactions.map(item=>{const positive=item.transactionType==='income'||item.transactionType==='refund';const transfer=item.transactionType==='transfer';const account=transfer?`${name(item.fromAccountId)} → ${name(item.toAccountId)}`:name(item.fromAccountId??item.toAccountId);return <Link to={`/transactions?search=${encodeURIComponent(item.description)}`} className="dashboard-recent-row" key={item.id}><TransactionIcon type={titleCase(item.transactionType)}/><div><strong>{item.description}</strong><small>{formatDate(`${item.transactionDate}T12:00:00`)} · {account}</small></div><strong className={`amount ${positive?'positive':transfer?'neutral':''}`}>{positive?'+':transfer?'':'−'}{formatMinorCurrency(item.amountMinor)}</strong></Link>})}</div>}</section>
}
