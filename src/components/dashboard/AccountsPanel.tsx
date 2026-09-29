import { Building2, CreditCard, MoreHorizontal, Plus } from 'lucide-react'
import { accounts } from '../../data/mockData'
import { formatCurrency } from '../../lib/format'

export function AccountsPanel() {
  return <section className="panel accounts-panel"><div className="section-heading"><div><p className="eyebrow">Connected</p><h2>Accounts</h2></div><button className="round-add" aria-label="Add account"><Plus /></button></div>
    <div className="account-list">{accounts.slice(0, 4).map(account => <article className="account-row" key={account.id}><span className={`account-icon ${account.color}`}>{account.type === 'Credit Card' ? <CreditCard/> : <Building2/>}</span><div><strong>{account.institution}</strong><small>{account.type} · {account.maskedIdentifier}</small></div><div className="account-balance"><strong className={account.balance < 0 ? 'negative' : ''}>{account.balance < 0 ? '−' : ''}{formatCurrency(account.balance)}</strong><small>{account.type === 'Credit Card' ? 'Outstanding' : 'Available'}</small></div><button className="more-button" aria-label={`More options for ${account.name}`}><MoreHorizontal/></button></article>)}</div>
  </section>
}
