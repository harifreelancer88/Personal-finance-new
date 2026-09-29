import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AccountDetails } from '../components/accounts/AccountDetails'
import { AccountForm } from '../components/accounts/AccountForm'
import { AccountList } from '../components/accounts/AccountList'
import { AccountSummary } from '../components/accounts/AccountSummary'
import { PageHeader } from '../components/layout/PageHeader'
import { ConfirmDialog } from '../components/transactions/ConfirmDialog'
import { accounts as mockAccounts } from '../data/mockData'
import type { Account } from '../types/finance'

export function AccountsPage() {
 const {openMenu}=useOutletContext<{openMenu:()=>void}>(); const [accounts,setAccounts]=useState<Account[]>(mockAccounts); const [viewing,setViewing]=useState<Account>(); const [editing,setEditing]=useState<Account|null>(); const [deleting,setDeleting]=useState<Account>()
 const save=(account:Account)=>{setAccounts(old=>old.some(item=>item.id===account.id)?old.map(item=>item.id===account.id?account:item):[account,...old]);setEditing(undefined)}
 return <><PageHeader title="Accounts" eyebrow="Financial overview" onMenu={openMenu}/><main className="page-body accounts-page"><div className="accounts-intro"><div><h2>Accounts</h2><p>Manage your bank accounts, cards and wallets.</p></div><button className="primary-button" onClick={()=>setEditing(null)}><Plus/>Add Account</button></div><AccountSummary accounts={accounts}/><AccountList accounts={accounts} onView={setViewing} onEdit={account=>setEditing(account)} onDelete={setDeleting}/></main><button className="mobile-fab accounts-mobile-add" onClick={()=>setEditing(null)} aria-label="Add account"><Plus/></button>
 {editing !== undefined && <AccountForm initial={editing ?? undefined} onClose={()=>setEditing(undefined)} onSave={save}/>} {viewing && <AccountDetails account={viewing} onClose={()=>setViewing(undefined)} onEdit={()=>{setEditing(viewing);setViewing(undefined)}}/>} {deleting && <ConfirmDialog subject="account" name={deleting.name} onCancel={()=>setDeleting(undefined)} onConfirm={()=>{setAccounts(old=>old.filter(item=>item.id!==deleting.id));setDeleting(undefined)}}/>}</>
}
