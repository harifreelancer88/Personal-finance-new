import { useEffect, useState } from 'react'
import {
  getTransaction,
  type TransactionDetailsDto,
} from '../../api/transactions'
import { apiRequest } from '../../api/client'
import type { AccountDto } from '../../api/accounts'
import type { CategoryDto } from '../../api/categories'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '../../components/shadcn/sheet'
import { Button } from '../../components/shadcn/button'
import { PreviewTransactionContent } from '../../components/dashboard/preview/PreviewTransactionPanel'
import { PreviewPrivacy } from '../../components/dashboard/preview/PreviewAmount'
export function TransactionSheet({
  id,
  accounts,
  categories,
  hidden,
  togglePrivacy,
  close,
  edit,
  status,
}: {
  id: string
  accounts: AccountDto[]
  categories: CategoryDto[]
  hidden: boolean
  togglePrivacy: () => void
  close: () => void
  edit: (item: TransactionDetailsDto) => void
  status: (id: string, value: 'confirmed' | 'ignored') => Promise<void>
}) {
  const [item, setItem] = useState<TransactionDetailsDto>(),
    [splits, setSplits] =
      useState<
        { category_id: string; category_name: string; amount_minor: number }[]
      >(),
    [error, setError] = useState(''),
    [splitError, setSplitError] = useState(false),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    const c = new AbortController()
    setItem(undefined)
    setError('')
    setSplitError(false)
    setSplits(undefined)
    void getTransaction(id, c.signal)
      .then((v) => {
        if (!c.signal.aborted) setItem(v)
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message)
      })
    void apiRequest<NonNullable<typeof splits>>(
      `/api/transactions/${encodeURIComponent(id)}/splits`,
      { signal: c.signal },
    )
      .then((v) => {
        if (!c.signal.aborted) setSplits(v)
      })
      .catch(() => {
        if (!c.signal.aborted) setSplitError(true)
      })
    return () => c.abort()
  }, [id, retry])
  async function act(value: 'confirmed' | 'ignored') {
    setBusy(true)
    setError('')
    try {
      await status(id, value)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update record.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) close()
      }}
    >
      <SheetContent className="st-theme st-sheet">
        <SheetHeader>
          <SheetTitle>Transaction details</SheetTitle>
          <SheetDescription>
            Review the recorded details and source message.
          </SheetDescription>
        </SheetHeader>
        <div className="st-sheet-body">
          <Button variant="outline" onClick={togglePrivacy}>
            {hidden ? 'Show amounts' : 'Hide amounts'}
          </Button>
          {error && (
            <div role="alert" className="st-error">
              {error}{' '}
              <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
                Retry
              </Button>
            </div>
          )}
          {item ? (
            <PreviewPrivacy value={hidden}>
              <PreviewTransactionContent
                item={item}
                splits={splits}
                splitError={splitError}
                accounts={accounts}
                categories={categories}
              />
            </PreviewPrivacy>
          ) : (
            !error && <p role="status">Loading transaction…</p>
          )}
          {splitError && (
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
              Retry allocations
            </Button>
          )}
        </div>
        <SheetFooter>
          {item && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => edit(item)}
              >
                Edit transaction
              </Button>
              {item.status === 'pending' && (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void act('ignored')}
                  >
                    Ignore
                  </Button>
                  <Button
                    disabled={busy || (item.source === 'sms' && !item.sms)}
                    onClick={() => void act('confirmed')}
                  >
                    {busy ? 'Updating…' : 'Confirm transaction'}
                  </Button>
                </>
              )}
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
