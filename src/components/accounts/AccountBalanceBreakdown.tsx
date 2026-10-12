import { Banknote, CreditCard, Landmark, WalletCards } from 'lucide-react'
import { accountOverview } from '../../lib/account-overview'
import { formatMinorCurrency } from '../../lib/format'
import type { Account } from '../../types/finance'
const types = [{type:'Bank Account',name:'Bank accounts',icon:Landmark},{type:'Credit Card',name:'Credit cards',icon:CreditCard},{type:'Wallet / Prepaid',name:'Wallets',icon:WalletCards},{type:'Cash',name:'Cash accounts',icon:Banknote}]
export function AccountBalanceBreakdown({accounts}:{accounts:Account[]}) {
  const {active,positiveMinor,owedMinor} = accountOverview(accounts)
  const combined = positiveMinor + owedMinor
  return <aside className="account-breakdown panel" aria-label="Active account summary"><h2>Summary</h2><div className="balance-breakdown-item"><p>Total positive balances</p><strong className="positive-text">{formatMinorCurrency(positiveMinor)}</strong><div className="balance-comparison-track" aria-hidden="true"><span className="balance-positive-bar" style={{width:`${combined ? positiveMinor / combined * 100 : 0}%`}}/></div></div><div className="balance-breakdown-item"><p>Total amount owed</p><strong className="owed-text">{formatMinorCurrency(owedMinor)}</strong><div className="balance-comparison-track" aria-hidden="true"><span className="balance-owed-bar" style={{width:`${combined ? owedMinor / combined * 100 : 0}%`}}/></div></div><div className="active-account-count"><span>Active accounts</span><strong>{active.length}</strong></div><dl className="account-type-counts">{types.map(({type,name,icon:Icon}) => <div key={type}><dt><Icon/>{name}</dt><dd>{active.filter(account => account.type === type).length}</dd></div>)}</dl></aside>
}
