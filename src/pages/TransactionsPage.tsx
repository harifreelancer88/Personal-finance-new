import {
  Menu,
  Plus,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { getAccounts, type AccountDto } from '../api/accounts'
import { getCategories, type CategoryDto } from '../api/categories'
import {
  assignTransactionCategory,
  createTransaction,
  getTransactionPage,
  removeTransaction,
  updateTransaction,
  updateTransactionStatus,
  type TransactionDto,
  type TransactionInput,
  type TransactionPage,
  type TransactionQuery,
} from '../api/transactions'
import { Modal } from '../components/transactions/Modal'
import {
  currentMonthKey,
  validMonthKey,
  monthBounds,
  shiftMonth,
  monthLabel,
} from '../lib/transaction-month'
import { ConfirmDialog } from '../components/transactions/ConfirmDialog'
import { TransactionDetails } from '../components/transactions/TransactionDetails'
import {
  emptyFilters,
  TransactionFilters,
  type FilterState,
} from '../components/transactions/TransactionFilters'
import { TransactionForm } from '../components/transactions/TransactionForm'
import { TransactionTable } from '../components/transactions/TransactionTable'
import { formatMinorCurrency, formatDate } from '../lib/format'
import type { Transaction } from '../types/finance'

const PAGE_SIZE = 25,
  REVIEW_SIZE = 5
const titleCase = (value: string) =>
  `${value[0].toUpperCase()}${value.slice(1)}`
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
function queryFor(filters: FilterState): TransactionQuery {
  const query: TransactionQuery = { search: filters.search.trim() || undefined }
  if (filters.type !== 'All') query.type = filters.type.toLowerCase()
  if (filters.category !== 'All') query.categoryId = filters.category
  if (filters.account !== 'All') query.accountId = filters.account
  if (filters.source !== 'All') query.source = filters.source.toLowerCase()
  if (filters.status !== 'All') query.status = filters.status.toLowerCase()
  if (filters.range !== 'All') {
    const today = new Date(),
      start = new Date(today)
    start.setDate(start.getDate() - Number(filters.range) + 1)
    query.fromDate = dateKey(start)
    query.toDate = dateKey(today)
  }
  return query
}
function toView(
  dto: TransactionDto,
  accounts: AccountDto[],
  categories: CategoryDto[],
): Transaction {
  const from = accounts.find((item) => item.id === dto.fromAccountId)?.name,
    to = accounts.find((item) => item.id === dto.toAccountId)?.name
  const accountLabel = (id: string | null) => {
    const item = accounts.find((account) => account.id === id)
    return item
      ? item.last4
        ? `${item.institution || item.name} · ${item.last4}`
        : item.name
      : undefined
  }
  const fromLabel = accountLabel(dto.fromAccountId),
    toLabel = accountLabel(dto.toAccountId)
  const account =
    dto.transactionType === 'transfer'
      ? `${fromLabel ?? 'Choose source'} → ${toLabel ?? 'Choose destination'}`
      : (fromLabel ?? toLabel ?? 'Choose account')
  return {
    id: dto.id,
    date: `${dto.transactionDate}T12:00:00`,
    accountingDate: dto.accountingDate,
    description: dto.description,
    merchant: '',
    category:
      categories.find((item) => item.id === dto.categoryId)?.name ??
      (dto.transactionType === 'transfer' ? 'Transfer' : 'Uncategorised'),
    account,
    type: titleCase(dto.transactionType) as Transaction['type'],
    amount: dto.amountMinor / 100,
    amountMinor: dto.amountMinor,
    status: titleCase(dto.status) as Transaction['status'],
    source: dto.source,
    notes: dto.notes ?? undefined,
    fromAccount: from,
    toAccount: to,
    fromAccountId: dto.fromAccountId,
    toAccountId: dto.toAccountId,
    categoryId: dto.categoryId,
    originalTransactionId: dto.originalTransactionId,
  }
}
export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawMonth = searchParams.get('month'),
    month = validMonthKey(rawMonth) ? rawMonth : currentMonthKey()
  const bounds = useMemo(() => monthBounds(month), [month])
  const [monthSummary, setMonthSummary] = useState<TransactionPage['summary']>()
  const [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState<string[]>([])
  const [categoryDialog, setCategoryDialog] = useState(false),
    [bulkCategory, setBulkCategory] = useState(''),
    [bulkSaving, setBulkSaving] = useState(false),
    [bulkError, setBulkError] = useState<string>(),
    [bulkNotice, setBulkNotice] = useState('')
  const touch = useRef<{ x: number; y: number } | undefined>(undefined)
  const resetSelection = () => {
    setSelected([])
    setSelecting(false)
    setBulkNotice('')
  }
  const changeMonth = (nextMonth: string) => {
    if (!validMonthKey(nextMonth)) return
    const next = new URLSearchParams(searchParams)
    next.set('month', nextMonth)
    setSearchParams(next)
    setOffset(0)
    setReviewOffset(0)
    setPage(undefined)
    setReviewPage(undefined)
    setMonthSummary(undefined)
    resetSelection()
    setLoading(true)
  }
  const { openMenu } = useOutletContext<{ openMenu: () => void }>()
  const [accounts, setAccounts] = useState<AccountDto[]>([]),
    [categories, setCategories] = useState<CategoryDto[]>([])
  const [referenceReady, setReferenceReady] = useState(false),
    [referenceError, setReferenceError] = useState<string>()
  const reviewActive = searchParams.get('tab') === 'review'
  const setReviewActive = (review: boolean) => {
    resetSelection()
    const next = new URLSearchParams(searchParams)
    if (review) next.set('tab', 'review')
    else next.delete('tab')
    setSearchParams(next, { replace: true })
  }
  const [filters, setFilters] = useState<FilterState>(() => ({
      ...emptyFilters,
      search: searchParams.get('search') ?? '',
    })),
    [offset, setOffset] = useState(0),
    [reviewOffset, setReviewOffset] = useState(0)
  const [page, setPage] = useState<TransactionPage>(),
    [reviewPage, setReviewPage] = useState<TransactionPage>()
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState<string>(),
    [refresh, setRefresh] = useState(0)
  const [form, setForm] = useState<{
      mode: 'add' | 'edit'
      item?: Transaction
    }>(),
    [viewing, setViewing] = useState<Transaction>(),
    [deleting, setDeleting] = useState<Transaction>()
  const [mutationError, setMutationError] = useState<string>(),
    [saving, setSaving] = useState(false),
    [isDeleting, setIsDeleting] = useState(false)
  const [statusBusy, setStatusBusy] = useState<string>(),
    statusLock = useRef(false)
  useEffect(() => {
    let active = true
    Promise.all([getAccounts(), getCategories()])
      .then(([nextAccounts, nextCategories]) => {
        if (active) {
          setAccounts(nextAccounts)
          setCategories(nextCategories)
          setReferenceReady(true)
          setReferenceError(undefined)
        }
      })
      .catch((error) => {
        if (active)
          setReferenceError(
            error instanceof Error
              ? error.message
              : 'Could not load accounts and categories.',
          )
      })
    return () => {
      active = false
    }
  }, [refresh])
  const query = useMemo(
    () => ({ ...queryFor(filters), ...bounds }),
    [filters, bounds],
  )
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError(undefined)
    Promise.all([
      getTransactionPage(
        { ...query, limit: PAGE_SIZE, offset },
        controller.signal,
      ),
      getTransactionPage(
        {
          ...bounds,
          source: 'sms',
          status: 'pending',
          limit: REVIEW_SIZE,
          offset: reviewOffset,
        },
        controller.signal,
      ),
      getTransactionPage({ ...bounds, limit: 1, offset: 0 }, controller.signal),
    ])
      .then(([nextPage, nextReview, nextMonth]) => {
        if (controller.signal.aborted) return
        if (offset > 0 && offset >= nextPage.total) {
          setOffset(
            Math.max(
              0,
              Math.floor((nextPage.total - 1) / PAGE_SIZE) * PAGE_SIZE,
            ),
          )
          return
        }
        if (reviewOffset > 0 && reviewOffset >= nextReview.total) {
          setReviewOffset(
            Math.max(
              0,
              Math.floor((nextReview.total - 1) / REVIEW_SIZE) * REVIEW_SIZE,
            ),
          )
          return
        }
        setPage(nextPage)
        setReviewPage(nextReview)
        setMonthSummary(nextMonth.summary)
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Could not load transactions.',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [query, bounds, offset, reviewOffset, refresh])
  const items = useMemo(
    () => page?.items.map((item) => toView(item, accounts, categories)) ?? [],
    [page, accounts, categories],
  )
  const pendingSms = useMemo(
    () =>
      reviewPage?.items.map((item) => toView(item, accounts, categories)) ?? [],
    [reviewPage, accounts, categories],
  )
  const refreshData = () => setRefresh((value) => value + 1)
  const changeFilters = (next: FilterState) => {
    resetSelection()
    setFilters(next)
    setOffset(0)
    setPage(undefined)
    setLoading(true)
  }
  const save = async (value: TransactionInput) => {
    setSaving(true)
    setMutationError(undefined)
    try {
      if (form?.item) await updateTransaction(form.item.id, value)
      else await createTransaction(value)
      setForm(undefined)
      refreshData()
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : 'Could not save the transaction.',
      )
    } finally {
      setSaving(false)
    }
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setIsDeleting(true)
    setMutationError(undefined)
    try {
      await removeTransaction(deleting.id)
      setSelected((old) => old.filter((id) => id !== deleting.id))
      setDeleting(undefined)
      refreshData()
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : 'Could not delete the transaction.',
      )
    } finally {
      setIsDeleting(false)
    }
  }
  const changeStatus = async (
    item: Transaction,
    status: 'confirmed' | 'ignored',
  ) => {
    if (statusLock.current) return
    statusLock.current = true
    setStatusBusy(item.id)
    setMutationError(undefined)
    try {
      await updateTransactionStatus(item.id, status)
      setViewing(undefined)
      refreshData()
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : 'Could not update the transaction.',
      )
      if (status === 'confirmed') {
        setViewing(undefined)
        setForm({ mode: 'edit', item })
      }
    } finally {
      statusLock.current = false
      setStatusBusy(undefined)
    }
  }
  const edit = (item: Transaction) => {
    setMutationError(undefined)
    setForm({ mode: 'edit', item })
  }
  const toggleSelection = (id: string) => {
    setBulkNotice('')
    setSelected((old) =>
      old.includes(id)
        ? old.filter((value) => value !== id)
        : old.length < 100
          ? [...old, id]
          : old,
    )
  }
  const selectPage = () => {
    const ids = items.map((i) => i.id)
    setSelected((old) =>
      ids.every((id) => old.includes(id))
        ? old.filter((id) => !ids.includes(id))
        : [...new Set([...old, ...ids])].slice(0, 100),
    )
  }
  const assignCategory = async () => {
    setBulkSaving(true)
    setBulkError(undefined)
    try {
      const result = await assignTransactionCategory(
        selected,
        bulkCategory || null,
      )
      setCategoryDialog(false)
      setSelected([])
      setSelecting(false)
      setBulkNotice(
        `Category updated for ${result.updatedCount} ${result.updatedCount === 1 ? 'transaction' : 'transactions'}.`,
      )
      refreshData()
    } catch (e) {
      setBulkError(
        e instanceof Error ? e.message : 'Could not assign category.',
      )
    } finally {
      setBulkSaving(false)
    }
  }
  // Browser back/forward may change the month independently of the arrow controls.
  useEffect(() => {
    setSelected([])
    setSelecting(false)
    setOffset(0)
    setReviewOffset(0)
    setMonthSummary(undefined)
  }, [month])
  const total = page?.total ?? 0,
    summary = monthSummary,
    ready = referenceReady && !referenceError
  useEffect(() => {
    if (ready && searchParams.get('new') === '1') {
      setMutationError(undefined)
      setForm({ mode: 'add' })
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, [ready, searchParams, setSearchParams])
  return (
    <>
      <header className="activity-header">
        <button
          className="icon-button activity-menu"
          onClick={openMenu}
          aria-label="Open navigation"
        >
          <Menu />
        </button>
        <h1>Transactions</h1>
        <button
          className="icon-button activity-refresh"
          onClick={refreshData}
          disabled={loading}
          aria-label="Refresh transactions"
        >
          <RefreshCw />
        </button>
        <button
          className="primary-button activity-add"
          disabled={!ready}
          onClick={() => {
            setMutationError(undefined)
            setForm({ mode: 'add' })
          }}
          aria-label="Add transaction"
        >
          <Plus />
          <span>Add transaction</span>
        </button>
      </header>
      <div className="page-body transactions-page">
        {(loadError || referenceError) && (
          <div className="api-feedback error" role="alert">
            <span>
              {loadError ?? referenceError}
              {page ? ' Previously loaded data is shown.' : ''}
            </span>
            <button className="secondary-button" onClick={refreshData}>
              Try again
            </button>
          </div>
        )}
        {mutationError && !form && !deleting && (
          <div className="api-feedback error" role="alert">
            <span>{mutationError}</span>
          </div>
        )}
        <div
          className="transaction-month-navigation"
          aria-label="Transaction month"
          onTouchStart={(event) => {
            const point = event.touches[0]
            touch.current = { x: point.clientX, y: point.clientY }
          }}
          onTouchEnd={(event) => {
            const start = touch.current,
              point = event.changedTouches[0]
            touch.current = undefined
            if (
              start &&
              Math.abs(point.clientX - start.x) > 60 &&
              Math.abs(point.clientX - start.x) >
                Math.abs(point.clientY - start.y) * 2
            )
              changeMonth(shiftMonth(month, point.clientX < start.x ? 1 : -1))
          }}
        >
          <button
            className="month-arrow"
            aria-label="Previous month"
            disabled={bulkSaving}
            onClick={() => changeMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft />
          </button>
          <time dateTime={month} aria-live="polite">
            {monthLabel(month)}
          </time>
          <button
            className="month-arrow"
            aria-label="Next month"
            disabled={bulkSaving}
            onClick={() => changeMonth(shiftMonth(month, 1))}
          >
            <ChevronRight />
          </button>
          {month !== currentMonthKey() && (
            <button
              className="month-today"
              onClick={() => changeMonth(currentMonthKey())}
            >
              This month
            </button>
          )}
        </div>
        {summary && !loading && (
          <section
            className="transaction-summary"
            aria-label="Confirmed totals for the selected month, excluding transfers and investments"
          >
            <article>
              <p>Money Out</p>
              <strong>{formatMinorCurrency(summary.expenseMinor)}</strong>
            </article>
            <article>
              <p>Money In</p>
              <strong className="positive-text">
                {formatMinorCurrency(summary.incomeMinor)}
              </strong>
            </article>
            <article className="net-flow">
              <p>Net cash flow</p>
              <strong
                className={
                  summary.netCashFlowMinor >= 0
                    ? 'positive-text'
                    : 'negative-text'
                }
              >
                {summary.netCashFlowMinor < 0 ? '−' : ''}
                {formatMinorCurrency(summary.netCashFlowMinor)}
              </strong>
            </article>
          </section>
        )}
        {bulkNotice && (
          <p className="category-save-notice" role="status">
            {bulkNotice}
          </p>
        )}
        <TransactionFilters
          value={filters}
          onChange={changeFilters}
          categories={categories}
          accounts={accounts}
          monthScoped
        />
        <div
          className="activity-tabs"
          role="tablist"
          aria-label="Transaction activity"
          onKeyDown={(event) => {
            if (
              ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
            ) {
              event.preventDefault()
              const review =
                event.key === 'End' || (event.key !== 'Home' && !reviewActive)
              setReviewActive(review)
              document
                .getElementById(review ? 'review-tab' : 'all-activity-tab')
                ?.focus()
            }
          }}
        >
          <button
            id="all-activity-tab"
            role="tab"
            tabIndex={reviewActive ? -1 : 0}
            aria-selected={!reviewActive}
            aria-controls="all-activity"
            onClick={() => setReviewActive(false)}
          >
            All activity
          </button>
          <button
            id="review-tab"
            role="tab"
            tabIndex={reviewActive ? 0 : -1}
            aria-selected={reviewActive}
            aria-controls="review-activity"
            onClick={() => setReviewActive(true)}
          >
            Needs review <span>{reviewPage?.total ?? '…'}</span>
          </button>
        </div>
        <div
          id="review-activity"
          role="tabpanel"
          aria-labelledby="review-tab"
          hidden={!reviewActive}
        >
          {reviewActive && reviewPage && reviewPage.total > 0 && (
            <section
              className="needs-review panel"
              aria-label="SMS review queue"
            >
              <div>
                <h3>
                  Needs review{' '}
                  <span className="review-count">{reviewPage.total}</span>
                </h3>
                <p>
                  Check the original SMS and account details before confirming.
                  This queue includes pending SMS transactions for the selected
                  month.
                </p>
              </div>
              <div className="review-list">
                {pendingSms.map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{item.description}</strong>
                      <small>
                        {formatDate(item.date)} · {item.account} ·{' '}
                        {item.category}
                      </small>
                    </div>
                    <strong className="review-amount">
                      {formatMinorCurrency(item.amountMinor!)}
                    </strong>
                    <div className="review-actions">
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setMutationError(undefined)
                          setViewing(item)
                        }}
                      >
                        Review SMS
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!ready || !!statusBusy}
                        onClick={() => edit(item)}
                      >
                        Edit
                      </button>
                      <button
                        className="primary-button"
                        disabled={!ready || !!statusBusy || loading}
                        onClick={() => void changeStatus(item, 'confirmed')}
                      >
                        {statusBusy === item.id ? 'Updating…' : 'Confirm'}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!!statusBusy || loading}
                        onClick={() => void changeStatus(item, 'ignored')}
                      >
                        Ignore
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="review-pagination">
                <span>
                  Showing {reviewOffset + 1}–
                  {Math.min(reviewOffset + REVIEW_SIZE, reviewPage.total)} of{' '}
                  {reviewPage.total}
                </span>
                <button
                  className="secondary-button"
                  disabled={loading || reviewOffset === 0}
                  onClick={() =>
                    setReviewOffset((value) => Math.max(0, value - REVIEW_SIZE))
                  }
                >
                  Previous
                </button>
                <button
                  className="secondary-button"
                  disabled={
                    loading || reviewOffset + REVIEW_SIZE >= reviewPage.total
                  }
                  onClick={() =>
                    setReviewOffset((value) => value + REVIEW_SIZE)
                  }
                >
                  Next
                </button>
              </div>
            </section>
          )}
          {reviewActive && (!reviewPage || reviewPage.total === 0) && (
            <section className="panel empty-state">
              <h3>
                {loading
                  ? 'Loading review queue…'
                  : loadError
                    ? 'Review queue unavailable'
                    : 'You’re all caught up'}
              </h3>
              <p>
                {loading
                  ? 'Checking your SMS transactions.'
                  : loadError
                    ? 'Use Try again above to reload the review queue.'
                    : 'No SMS transactions need review.'}
              </p>
            </section>
          )}
        </div>
        {!reviewActive && (
          <div className="transaction-selection-toolbar">
            <button
              className="secondary-button selection-toggle"
              disabled={loading || !ready || bulkSaving}
              onClick={() => {
                setSelecting(!selecting)
                setSelected([])
                setBulkNotice('')
              }}
            >
              <CheckSquare />
              {selecting ? 'Done' : 'Select transactions'}
            </button>
            {selecting && (
              <>
                <label className="select-page">
                  <input
                    type="checkbox"
                    checked={
                      items.length > 0 &&
                      items.every((i) => selected.includes(i.id))
                    }
                    disabled={loading || !items.length || bulkSaving}
                    onChange={selectPage}
                  />
                  <span>Select this page</span>
                </label>
                <span className="selection-count" role="status">
                  {selected.length} selected
                  {selected.length === 100 ? ' (limit 100)' : ''}
                </span>
                <button
                  className="primary-button assign-category"
                  disabled={!selected.length || loading || bulkSaving}
                  onClick={() => {
                    setBulkCategory('')
                    setBulkError(undefined)
                    setCategoryDialog(true)
                  }}
                >
                  Assign category
                </button>
              </>
            )}
          </div>
        )}
        <section
          id="all-activity"
          role="tabpanel"
          aria-labelledby="all-activity-tab"
          className="transactions-panel panel"
          hidden={reviewActive}
          aria-busy={loading}
        >
          {loading ? (
            <div className="empty-state">
              <h3>Loading transactions…</h3>
              <p>Your activity will appear in a moment.</p>
            </div>
          ) : !page ? (
            <div className="empty-state">
              <h3>Transactions unavailable</h3>
              <p>Use Try again above to reload your activity.</p>
            </div>
          ) : (
            <TransactionTable
              items={items}
              onView={(item) => {
                setMutationError(undefined)
                setViewing(item)
              }}
              onEdit={edit}
              onDelete={(item) => {
                setMutationError(undefined)
                setDeleting(item)
              }}
              onConfirm={(item) => void changeStatus(item, 'confirmed')}
              onIgnore={(item) => void changeStatus(item, 'ignored')}
              statusBusy={!!statusBusy || bulkSaving}
              selecting={selecting}
              selectedIds={selected}
              onSelect={toggleSelection}
            />
          )}
          {page && (
            <footer className="table-footer pagination">
              <span>
                {total
                  ? total <= PAGE_SIZE
                    ? `${total} ${total === 1 ? 'transaction' : 'transactions'}`
                    : `Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total} transactions`
                  : 'No matching transactions'}
              </span>
              {total > PAGE_SIZE && (
                <div>
                  <button
                    disabled={loading || offset === 0}
                    onClick={() => {
                      setOffset((value) => Math.max(0, value - PAGE_SIZE))
                      setPage(undefined)
                    }}
                  >
                    Previous
                  </button>
                  <button
                    disabled={loading || offset + PAGE_SIZE >= total}
                    onClick={() => {
                      setOffset((value) => value + PAGE_SIZE)
                      setPage(undefined)
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
            </footer>
          )}
        </section>
      </div>
      {form && (
        <TransactionForm
          initial={form.item}
          accounts={accounts}
          categories={categories}
          saving={saving}
          requestError={mutationError}
          onClose={() => setForm(undefined)}
          onSave={save}
        />
      )}
      {viewing && (
        <TransactionDetails
          item={viewing}
          onClose={() => setViewing(undefined)}
          onEdit={() => {
            edit(viewing)
            setViewing(undefined)
          }}
          busy={!!statusBusy || loading}
          onConfirm={() => void changeStatus(viewing, 'confirmed')}
          onIgnore={() => void changeStatus(viewing, 'ignored')}
        />
      )}
      {categoryDialog && (
        <Modal
          title="Assign category"
          description={`Update ${selected.length} selected ${selected.length === 1 ? 'transaction' : 'transactions'}. Amounts, accounts and statuses stay the same.`}
          onClose={() => {
            if (!bulkSaving) setCategoryDialog(false)
          }}
          size="small"
        >
          <div className="bulk-category-form">
            {bulkError && (
              <p className="api-feedback error" role="alert">
                {bulkError}
              </p>
            )}
            <label>
              <span>Category</span>
              <select
                aria-label="Assign category"
                value={bulkCategory}
                disabled={bulkSaving}
                onChange={(event) => setBulkCategory(event.target.value)}
              >
                <option value="">Uncategorised</option>
                {categories
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <footer className="dialog-footer">
            <button
              className="secondary-button"
              disabled={bulkSaving}
              onClick={() => setCategoryDialog(false)}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={bulkSaving}
              onClick={() => void assignCategory()}
            >
              {bulkSaving ? 'Saving…' : 'Apply category'}
            </button>
          </footer>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          name={deleting.description}
          busy={isDeleting}
          error={mutationError}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </>
  )
}
