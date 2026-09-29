import { useState, type FormEvent } from 'react'
import type { AccountDto } from '../../api/accounts'
import type { CategoryDto } from '../../api/categories'
import type { TransactionInput } from '../../api/transactions'
import type { Transaction, TransactionType } from '../../types/finance'
import { Modal } from './Modal'

const types: TransactionType[] = ['Expense', 'Income', 'Transfer', 'Investment', 'Refund']
const today = () => new Date().toISOString().slice(0, 10)
const typeKey = (value: TransactionType) => value.toLowerCase() as TransactionInput['transactionType']

interface Props { initial?: Transaction; accounts: AccountDto[]; categories: CategoryDto[]; saving: boolean; requestError?: string; onClose: () => void; onSave: (value: TransactionInput) => Promise<void> }

export function TransactionForm({ initial, accounts, categories, saving, requestError, onClose, onSave }: Props) {
  const [type, setType] = useState<TransactionType>(initial?.type ?? 'Expense')
  const [date, setDate] = useState(initial?.date.slice(0, 10) ?? today())
  const [description, setDescription] = useState(initial?.description ?? '')
  const [amount, setAmount] = useState(initial ? (Math.abs(initial.amountMinor ?? initial.amount * 100) / 100).toFixed(2) : '')
  const [accountId, setAccountId] = useState(initial?.fromAccountId ?? initial?.toAccountId ?? accounts[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [fromAccountId, setFrom] = useState(initial?.fromAccountId ?? accounts[0]?.id ?? '')
  const [toAccountId, setTo] = useState(initial?.toAccountId ?? accounts.find(item => item.id !== (initial?.fromAccountId ?? accounts[0]?.id))?.id ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const activeAccounts = accounts.filter(item => item.isActive)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next: Record<string, string> = {}
    const amountMinor = Math.round(Number(amount) * 100)
    if (!description.trim()) next.description = 'Enter a description.'
    if (!amount || !Number.isInteger(amountMinor) || amountMinor <= 0) next.amount = 'Enter an amount greater than zero with at most two decimal places.'
    if (!date) next.date = 'Choose a date.'
    if (!activeAccounts.length) next.account = 'No accounts are available yet. Add an account before creating this transaction.'
    if (type === 'Transfer' && fromAccountId === toAccountId) next.transfer = 'From and to accounts must be different.'
    if (type === 'Transfer' && (!fromAccountId || !toAccountId)) next.transfer = 'Choose both a source and destination account.'
    if (type !== 'Transfer' && !accountId) next.account = 'Choose an account.'
    setErrors(next)
    if (Object.keys(next).length) return
    const key = typeKey(type)
    await onSave({ transactionType: key, description: description.trim(), amountMinor, categoryId: key === 'transfer' ? null : categoryId || null, fromAccountId: key === 'expense' || key === 'investment' ? accountId : key === 'transfer' ? fromAccountId : null, toAccountId: key === 'income' || key === 'refund' ? accountId : key === 'transfer' ? toAccountId : null, transactionDate: date, notes: notes.trim() || null })
  }

  const accountSelect = (label: string, value: string, set: (value: string) => void) => <label><span>{label}</span><select value={value} onChange={event => set(event.target.value)} disabled={!activeAccounts.length}>{!activeAccounts.length && <option value="">No accounts available</option>}{activeAccounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
  const accountLabel = type === 'Income' || type === 'Refund' ? 'Destination account' : type === 'Investment' ? 'From account' : 'Account'
  return <Modal title={initial ? 'Edit transaction' : 'Add transaction'} description={initial ? 'Update this transaction’s details.' : 'Record a new item in your activity.'} onClose={onClose}><form className="transaction-form" onSubmit={submit} noValidate><div className="form-grid">
    <label><span>Transaction type</span><select value={type} onChange={event => setType(event.target.value as TransactionType)}>{types.map(item => <option key={item}>{item}</option>)}</select></label>
    <label><span>Date</span><input type="date" value={date} onChange={event => setDate(event.target.value)}/>{errors.date && <small className="field-error">{errors.date}</small>}</label>
    <label className="full"><span>Description</span><input value={description} onChange={event => setDescription(event.target.value)} placeholder="e.g. Weekly groceries"/>{errors.description && <small className="field-error">{errors.description}</small>}</label>
    <label><span>Amount (₹)</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00"/>{errors.amount && <small className="field-error">{errors.amount}</small>}</label>
    {type === 'Transfer' ? <>{accountSelect('From account', fromAccountId, setFrom)}{accountSelect('To account', toAccountId, setTo)}</> : <>{accountSelect(accountLabel, accountId, setAccountId)}<label><span>Category</span><select value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">Uncategorised</option>{categories.filter(item => item.isActive).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}
    {(errors.account || errors.transfer) && <small className="field-error full">{errors.account ?? errors.transfer}</small>}
    <label className="full"><span>Notes <em>Optional</em></span><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Add any helpful context" rows={3}/></label>
    {requestError && <div className="api-feedback error full" role="alert">{requestError}</div>}
  </div><footer className="dialog-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || !activeAccounts.length}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Add transaction'}</button></footer></form></Modal>
}
