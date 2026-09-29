import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { createAccount, deleteAccount, getAccounts, updateAccount, type AccountDto, type AccountInput } from '../api/accounts'
import { AccountDetails } from '../components/accounts/AccountDetails'
import { AccountForm } from '../components/accounts/AccountForm'
import { AccountList } from '../components/accounts/AccountList'
import { AccountSummary } from '../components/accounts/AccountSummary'
import { PageHeader } from '../components/layout/PageHeader'
import { ConfirmDialog } from '../components/transactions/ConfirmDialog'
import type { Account, AccountType } from '../types/finance'

const typeNames: Record<AccountDto['accountType'], AccountType> = { bank:'Bank Account', credit_card:'Credit Card', cash:'Cash', wallet:'Wallet / Prepaid' }
const colors: Record<AccountDto['accountType'], Account['color']> = { bank:'lime', credit_card:'violet', cash:'blue', wallet:'slate' }
function toView(value: AccountDto): Account { return { id:value.id, name:value.name, institution:value.institution, type:typeNames[value.accountType], maskedIdentifier:value.last4 ? `•••• ${value.last4}` : (value.accountType==='cash'?'Cash on hand':'Not provided'), balance:value.currentBalanceMinor/100, openingBalanceMinor:value.openingBalanceMinor, openingBalanceDate:value.openingBalanceDate, color:colors[value.accountType], status:value.isActive?'Active':'Inactive', notes:value.notes??undefined, creditLimit:value.creditLimitMinor===null?undefined:value.creditLimitMinor/100, billingDate:value.billingDay??undefined, dueDate:value.dueDay??undefined } }

export function AccountsPage() {
 const {openMenu}=useOutletContext<{openMenu:()=>void}>(); const [dtos,setDtos]=useState<AccountDto[]>([]); const accounts=useMemo(()=>dtos.map(toView),[dtos]); const [viewingId,setViewingId]=useState<string>(); const [editingId,setEditingId]=useState<string|null>(); const [deletingId,setDeletingId]=useState<string>()
 const [loading,setLoading]=useState(true); const [loadError,setLoadError]=useState<string>(); const [mutationError,setMutationError]=useState<string>(); const [saving,setSaving]=useState(false); const [isDeleting,setIsDeleting]=useState(false)
 const load=async()=>{setLoading(true);try{setDtos(await getAccounts());setLoadError(undefined)}catch(error){setLoadError(error instanceof Error?error.message:'Could not load accounts.')}finally{setLoading(false)}}
 useEffect(()=>{void load()},[])
 const editing=editingId?accounts.find(item=>item.id===editingId):undefined; const viewing=viewingId?accounts.find(item=>item.id===viewingId):undefined; const deleting=deletingId?accounts.find(item=>item.id===deletingId):undefined
 const save=async(value:AccountInput)=>{setSaving(true);setMutationError(undefined);try{const saved=editingId?await updateAccount(editingId,value):await createAccount(value);setDtos(old=>editingId?old.map(item=>item.id===saved.id?saved:item):[saved,...old]);setEditingId(undefined)}catch(error){setMutationError(error instanceof Error?error.message:'Could not save the account.')}finally{setSaving(false)}}
 const confirmDelete=async()=>{if(!deletingId)return;setIsDeleting(true);setMutationError(undefined);try{await deleteAccount(deletingId);setDtos(old=>old.filter(item=>item.id!==deletingId));setDeletingId(undefined)}catch(error){setMutationError(error instanceof Error?error.message:'Could not delete the account.')}finally{setIsDeleting(false)}}
 const add=()=>{setMutationError(undefined);setEditingId(null)}
 return <><PageHeader title="Accounts" eyebrow="Financial overview" onMenu={openMenu}/><main className="page-body accounts-page"><div className="accounts-intro"><div><h2>Accounts</h2><p>Manage your bank accounts, cards and wallets.</p></div><button className="primary-button" onClick={add}><Plus/>Add Account</button></div>
 {loadError&&<div className="api-feedback error" role="alert"><span>{loadError}</span><button className="secondary-button" onClick={()=>void load()}>Try again</button></div>}
 {loading&&!accounts.length?<div className="panel empty-state"><h3>Loading accounts…</h3><p>Your balances will appear in a moment.</p></div>:<><AccountSummary accounts={accounts}/><AccountList accounts={accounts} onAdd={add} onView={account=>setViewingId(account.id)} onEdit={account=>{setMutationError(undefined);setEditingId(account.id)}} onDelete={account=>{setMutationError(undefined);setDeletingId(account.id)}}/></>}</main><button className="mobile-fab accounts-mobile-add" onClick={add} aria-label="Add account"><Plus/></button>
 {editingId!==undefined&&<AccountForm initial={editing} saving={saving} requestError={mutationError} onClose={()=>setEditingId(undefined)} onSave={value=>void save(value)}/>} {viewing&&<AccountDetails account={viewing} onClose={()=>setViewingId(undefined)} onEdit={()=>{setEditingId(viewing.id);setViewingId(undefined)}}/>} {deleting&&<ConfirmDialog subject="account" name={deleting.name} busy={isDeleting} error={mutationError} onCancel={()=>setDeletingId(undefined)} onConfirm={()=>void confirmDelete()}/>}</>
}
