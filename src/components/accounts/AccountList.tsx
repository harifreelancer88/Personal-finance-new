import type { Account } from '../../types/finance'
import { AccountCard } from './AccountCard'

export function AccountList({ accounts, onView, onEdit, onDelete, onAdd }: { accounts: Account[]; onView: (account: Account) => void; onEdit: (account: Account) => void; onDelete: (account: Account) => void; onAdd: () => void }) {
  return <section><div className="accounts-section-heading"><div><p className="eyebrow">Your money</p><h2>All accounts</h2></div><span>{accounts.length} connected</span></div>{accounts.length ? <div className="accounts-grid">{accounts.map(account => <AccountCard key={account.id} account={account} onView={() => onView(account)} onEdit={() => onEdit(account)} onDelete={() => onDelete(account)}/>)}</div> : <div className="panel empty-state"><h3>No accounts yet</h3><p>Add your first bank account, credit card, cash balance or wallet to get started.</p><button className="primary-button empty-state-action" onClick={onAdd}>Add Account</button></div>}</section>
}
