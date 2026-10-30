import { parseAmountMinor } from './money'
import { useState, type FormEvent } from 'react'
import type { AccountDto } from '../../api/accounts'
import type { CategoryDto } from '../../api/categories'
import type { TransactionDto, TransactionInput } from '../../api/transactions'
import { todayInIndia } from '../../lib/dashboard-preview'
import { Button } from '../../components/shadcn/button'
import { Input } from '../../components/shadcn/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/shadcn/dialog'
export function TransactionEditor({
  item,
  accounts,
  categories,
  close,
  save,
}: {
  item: TransactionDto | null
  accounts: AccountDto[]
  categories: CategoryDto[]
  close: () => void
  save: (value: TransactionInput) => Promise<void>
}) {
  const [type, setType] = useState(item?.transactionType ?? 'expense'),
    [date, setDate] = useState(item?.transactionDate ?? todayInIndia()),
    [accounting, setAccounting] = useState(item?.accountingDate ?? ''),
    [description, setDescription] = useState(item?.description ?? ''),
    [amount, setAmount] = useState(
      item ? (item.amountMinor / 100).toFixed(2) : '',
    ),
    [from, setFrom] = useState(
      item?.fromAccountId ?? accounts.find((a) => a.isActive)?.id ?? '',
    ),
    [to, setTo] = useState(
      item?.toAccountId ?? accounts.find((a) => a.isActive)?.id ?? '',
    ),
    [category, setCategory] = useState(item?.categoryId ?? ''),
    [notes, setNotes] = useState(item?.notes ?? ''),
    [original, setOriginal] = useState(item?.originalTransactionId ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const minor = parseAmountMinor(amount)
    if (minor === null) {
      setError(
        'Enter a positive amount with at most two decimals, within the supported limit.',
      )
      return
    }
    setBusy(true)
    try {
      await save({
        transactionType: type,
        description: description.trim(),
        amountMinor: minor,
        categoryId: category || null,
        fromAccountId: ['expense', 'investment', 'transfer'].includes(type)
          ? from
          : null,
        toAccountId: ['income', 'refund', 'transfer'].includes(type)
          ? to
          : null,
        transactionDate: date,
        accountingDate: type === 'income' ? accounting || null : null,
        notes: notes || null,
        originalTransactionId: type === 'refund' ? original || null : null,
      } as TransactionInput)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save transaction.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close()
      }}
    >
      <DialogContent className="st-theme st-editor">
        <DialogHeader>
          <DialogTitle>
            {item ? 'Edit transaction' : 'Add transaction'}
          </DialogTitle>
          <DialogDescription>
            Save a record to your Personal Finance app.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <fieldset disabled={busy} className="st-fields">
            <label>
              Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                {['expense', 'income', 'investment', 'transfer', 'refund'].map(
                  (t) => (
                    <option key={t}>{t}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Amount ₹
              <Input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="st-wide">
              Description
              <Input
                required
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              Transaction date
              <Input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            {type === 'income' && (
              <label>
                Accounting date
                <Input
                  type="date"
                  value={accounting}
                  onChange={(e) => setAccounting(e.target.value)}
                />
              </label>
            )}
            {['expense', 'investment', 'transfer'].includes(type) && (
              <label>
                From account
                <select
                  required
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                >
                  <option value="">Choose account</option>
                  {accounts
                    .filter((a) => a.isActive || a.id === item?.fromAccountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {['income', 'refund', 'transfer'].includes(type) && (
              <label>
                To account
                <select
                  required
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                >
                  <option value="">Choose account</option>
                  {accounts
                    .filter((a) => a.isActive || a.id === item?.toAccountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Uncategorised</option>
                {categories
                  .filter((c) => c.isActive || c.id === item?.categoryId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            {type === 'refund' && (
              <label>
                Original expense ID
                <Input
                  value={original}
                  onChange={(e) => setOriginal(e.target.value)}
                />
              </label>
            )}
            <label className="st-wide">
              Notes
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </fieldset>
          {error && (
            <p role="alert" className="st-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button disabled={busy}>
              {busy ? 'Saving…' : 'Save transaction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
