import { formatMinorCurrency } from '../../lib/format'
import { displayAccountBalance } from '../../lib/account-overview'
import type { Account } from '../../types/finance'
import { AccountIcon } from './AccountIcon'
import { AccountActions } from './AccountActions'
export function AccountCard({ account, onView, onEdit, onDelete }: { account:Account; onView:()=>void; onEdit:()=>void; onDelete:()=>void }) {
  const balance = displayAccountBalance(account)
  return <article className="account-list-row"><button className="account-row-main" onClick={onView} aria-label={`View ${account.name}`}><AccountIcon account={account}/><span className="account-row-name"><strong>{account.name}</strong><small>{account.institution || account.type} · {account.maskedIdentifier}{account.status === 'Inactive' && ' · Inactive'}</small></span><span className="account-row-value"><strong className={balance.minor < 0 ? 'negative-text' : ''}>{balance.minor < 0 ? '−' : ''}{formatMinorCurrency(balance.minor)}</strong><small>{balance.label}</small></span></button><AccountActions name={account.name} onView={onView} onEdit={onEdit} onDelete={onDelete}/></article>
}
