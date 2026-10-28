import { useContext, useEffect, useId, useRef, useState } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiRequest } from '../../../api/client'
import {
  getTransaction,
  type TransactionDetailsDto,
} from '../../../api/transactions'
import type { AccountDto } from '../../../api/accounts'
import type { CategoryDto } from '../../../api/categories'
import { activityLink, type ActivityRange } from '../../../lib/dashboard-range'
import { PreviewAmount, PreviewPrivacy, previewDate } from './PreviewAmount'

type Split = {
  category_id: string
  category_name: string
  amount_minor: number
}
type Props = {
  id: string
  accounts: AccountDto[]
  categories: CategoryDto[]
  range: ActivityRange
  onClose: () => void
  togglePrivacy: () => void
}

// Read-only content: editing continues in Transactions, using its existing guards.
export function PreviewTransactionContent({
  item,
  splits,
  splitError,
  accounts,
  categories,
}: {
  item: TransactionDetailsDto
  splits?: Split[]
  splitError?: boolean
  accounts: AccountDto[]
  categories: CategoryDto[]
}) {
  const hidden = useContext(PreviewPrivacy)
  const account = (id: string | null) =>
    accounts.find((a) => a.id === id)?.name ??
    (id ? 'Account unavailable' : 'Not recorded')
  const category =
    categories.find((c) => c.id === item.categoryId)?.name ??
    (item.categoryId ? 'Category unavailable' : 'Uncategorised')
  const positive = ['income', 'refund'].includes(item.transactionType)
  const totalSplit =
    splits?.reduce((sum, split) => sum + split.amount_minor, 0) ?? 0
  const canSplit = ['expense', 'income'].includes(item.transactionType)
  return (
    <>
      <div className="dp-detail-hero">
        <span>
          {item.transactionType} · {item.status}
        </span>
        <h3>{item.description}</h3>
        <strong className={positive ? 'dp-positive' : ''}>
          <PreviewAmount
            minor={item.amountMinor}
            sign={
              positive ? '+' : item.transactionType === 'transfer' ? '' : '−'
            }
          />
        </strong>
      </div>
      <dl className="dp-detail-list">
        <div>
          <dt>Transaction date</dt>
          <dd>{previewDate(item.transactionDate)}</dd>
        </div>
        {item.transactionType === 'income' && (
          <div>
            <dt>Accounting date</dt>
            <dd>{previewDate(item.accountingDate ?? item.transactionDate)}</dd>
          </div>
        )}
        <div>
          <dt>Category</dt>
          <dd>
            {category}
            {item.categoryOrigin === 'ai' ? ' · AI categorised' : ''}
          </dd>
        </div>
        {item.fromAccountId && (
          <div>
            <dt>From account</dt>
            <dd>{account(item.fromAccountId)}</dd>
          </div>
        )}
        {item.toAccountId && (
          <div>
            <dt>To account</dt>
            <dd>{account(item.toAccountId)}</dd>
          </div>
        )}
        <div>
          <dt>Source</dt>
          <dd>{item.source}</dd>
        </div>
      </dl>
      {item.notes && (
        <section className="dp-detail-section">
          <h3>Notes</h3>
          <p>
            {hidden ? 'Notes hidden while amounts are hidden.' : item.notes}
          </p>
        </section>
      )}
      {canSplit && (
        <section
          className="dp-detail-section"
          aria-label="Category allocations"
        >
          <h3>Category allocations</h3>
          {splitError ? (
            <p role="status">
              Allocations could not load. Try again to refresh them.
            </p>
          ) : !splits ? (
            <p role="status">Loading allocations…</p>
          ) : splits.length === 0 ? (
            <p>No category splits recorded.</p>
          ) : totalSplit > item.amountMinor ? (
            <p role="alert">Allocation totals need review in Transactions.</p>
          ) : (
            <>
              <dl className="dp-detail-list">
                {splits.map((split) => (
                  <div key={split.category_id}>
                    <dt>{split.category_name}</dt>
                    <dd>
                      <PreviewAmount minor={split.amount_minor} />
                    </dd>
                  </div>
                ))}
                {totalSplit < item.amountMinor && (
                  <div>
                    <dt>{category} · remainder</dt>
                    <dd>
                      <PreviewAmount minor={item.amountMinor - totalSplit} />
                    </dd>
                  </div>
                )}
                <div className="dp-allocation-total">
                  <dt>Total payment</dt>
                  <dd>
                    <PreviewAmount minor={item.amountMinor} />
                  </dd>
                </div>
              </dl>
              <p>
                These allocations divide the same payment; they are not
                additional transactions.
              </p>
            </>
          )}
        </section>
      )}
      {item.source === 'sms' && (
        <section className="dp-detail-section" aria-label="Original SMS">
          <h3>Original SMS</h3>
          {hidden ? (
            <p>Original message hidden while amounts are hidden.</p>
          ) : item.sms ? (
            <>
              <dl className="dp-detail-list">
                <div>
                  <dt>Sender</dt>
                  <dd>{item.sms.sender || 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Received</dt>
                  <dd>
                    {new Intl.DateTimeFormat('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Kolkata',
                    }).format(new Date(item.sms.receivedAt))}{' '}
                    IST
                  </dd>
                </div>
              </dl>
              <pre>{item.sms.rawText}</pre>
            </>
          ) : (
            <p>The original SMS is unavailable for this record.</p>
          )}
        </section>
      )}
      <details className="dp-detail-section">
        <summary>Record information</summary>
        <p>Transaction ID: {item.id}</p>
        {item.originalTransactionId && (
          <p>Original transaction ID: {item.originalTransactionId}</p>
        )}
      </details>
    </>
  )
}

export default function PreviewTransactionPanel({
  id,
  accounts,
  categories,
  range,
  onClose,
  togglePrivacy,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId(),
    descriptionId = useId()
  const hidden = useContext(PreviewPrivacy)
  const [item, setItem] = useState<TransactionDetailsDto>()
  const [splits, setSplits] = useState<Split[]>()
  const [error, setError] = useState(false),
    [splitError, setSplitError] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const element = dialog.current
    const previousOverflow = document.body.style.overflow
    element?.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      element?.close()
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController(),
      signal = controller.signal
    setItem(undefined)
    setSplits(undefined)
    setError(false)
    setSplitError(false)
    void getTransaction(id, signal)
      .then((value) => {
        if (!signal.aborted) setItem(value)
      })
      .catch(() => {
        if (!signal.aborted) setError(true)
      })
    void apiRequest<Split[]>(
      `/api/transactions/${encodeURIComponent(id)}/splits`,
      { signal },
    )
      .then((value) => {
        if (!signal.aborted) setSplits(value)
      })
      .catch(() => {
        if (!signal.aborted) setSplitError(true)
      })
    return () => controller.abort()
  }, [id, retry])
  return (
    <dialog
      ref={dialog}
      className="dp-detail-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose()
      }}
    >
      <div className="dp-detail-shell">
        <header className="dp-detail-header">
          <div>
            <h2 id={titleId}>Transaction details</h2>
            <p id={descriptionId}>
              Inspect this record without leaving your dashboard.
            </p>
          </div>
          <button
            autoFocus
            className="dp-button"
            aria-label="Close transaction details"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        <div className="dp-detail-body">
          <button
            className="dp-button dp-detail-privacy"
            aria-pressed={hidden}
            onClick={togglePrivacy}
          >
            {hidden ? <EyeOff size={16} /> : <Eye size={16} />}{' '}
            {hidden ? 'Show amounts' : 'Hide amounts'}
          </button>
          {error ? (
            <div className="dp-detail-error" role="alert">
              <h3>Could not load this transaction</h3>
              <p>
                It may have been removed, or the connection may be unavailable.
              </p>
              <button
                className="dp-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : item ? (
            <PreviewTransactionContent
              item={item}
              splits={splits}
              splitError={splitError}
              accounts={accounts}
              categories={categories}
            />
          ) : (
            <p role="status">Loading transaction details…</p>
          )}
          {item &&
            splitError &&
            ['expense', 'income'].includes(item.transactionType) && (
              <button
                className="dp-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry allocations
              </button>
            )}
        </div>
        <footer className="dp-detail-footer">
          <button className="dp-button" onClick={onClose}>
            Close
          </button>
          {item && (
            <Link
              className="dp-button dp-primary"
              to={activityLink(range, { search: item.description })}
            >
              Manage in Transactions
            </Link>
          )}
        </footer>
      </div>
    </dialog>
  )
}
