import { Banknote, ChevronDown, CreditCard, Landmark, WalletCards, Archive } from 'lucide-react'
import { useState } from 'react'
import { accountMinor } from '../../lib/account-overview'
import { formatMinorCurrency } from '../../lib/format'
import type { Account, AccountType } from '../../types/finance'
import { AccountCard } from './AccountCard'
const groups: {name:string; type:AccountType; icon:typeof Landmark}[] = [{name:'Bank accounts',type:'Bank Account',icon:Landmark},{name:'Credit cards',type:'Credit Card',icon:CreditCard},{name:'Wallets',type:'Wallet / Prepaid',icon:WalletCards},{name:'Cash',type:'Cash',icon:Banknote}]
export function AccountList({ accounts, onView, onEdit, onDelete, onAdd, filtered = false }: { accounts:Account[]; onView:(account:Account)=>void; onEdit:(account:Account)=>void; onDelete:(account:Account)=>void; onAdd:()=>void; filtered?:boolean }) {
  const [collapsed,setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (name:string) => setCollapsed(old => { const next = new Set(old); if (next.has(name)) next.delete(name); else next.add(name); return next })
  const sections = groups.map(group => ({...group,accounts:accounts.filter(account => account.type === group.type && account.status !== 'Inactive')}))
  const inactive = accounts.filter(account => account.status === 'Inactive')
  const sectionsWithInactive = [...sections, {name:'Inactive accounts',type:'Cash' as AccountType,icon:Archive,accounts:inactive}]
  if (!accounts.length) return <section className="panel empty-state"><h3>{filtered ? 'No matching accounts' : 'No accounts yet'}</h3><p>{filtered ? 'Try another search or account type.' : 'Add a bank account, credit card, cash balance or wallet to get started.'}</p>{!filtered && <button className="primary-button empty-state-action" onClick={onAdd}>Add account</button>}</section>
  return <div className="account-groups">{sectionsWithInactive.filter(group => group.accounts.length).map(({name,type,icon:Icon,accounts:rows}) => {
    const isInactive = name === 'Inactive accounts'
    const total = rows.reduce((sum,account) => sum + (type === 'Credit Card' ? Math.max(0,-accountMinor(account)) : accountMinor(account)),0)
    const closed = collapsed.has(name)
    const panelId = `account-group-${name.replaceAll(' ','-').toLowerCase()}`
    return <section key={name} className="account-group panel"><h2><button className="account-group-heading" aria-expanded={!closed} aria-controls={panelId} onClick={() => toggle(name)}><Icon/><span>{name}</span><span className={`account-group-total ${type === 'Credit Card' ? 'owed-text' : total < 0 ? 'negative-text' : 'positive-text'}`}>{isInactive ? `${rows.length} ${rows.length === 1 ? 'account' : 'accounts'}` : `${total < 0 ? '−' : ''}${formatMinorCurrency(total)}${type === 'Credit Card' ? ' owed' : ''}`}</span><ChevronDown className={closed ? 'collapsed' : ''}/></button></h2><div id={panelId} hidden={closed}>{rows.map(account => <AccountCard key={account.id} account={account} onView={() => onView(account)} onEdit={() => onEdit(account)} onDelete={() => onDelete(account)}/>)}</div></section>
  })}</div>
}
