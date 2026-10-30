import { displayAmountMinor } from './shadcn-transactions/money'
import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  TrendingUp,
  ArrowUpDown,
  Menu,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  MoreHorizontal,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from '@tanstack/react-table'
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
  type TransactionPage,
} from '../api/transactions'
import {
  readTransactionFilters,
  writeTransactionFilters,
  emptyFilters,
} from '../lib/transaction-filters'
import { monthBounds, validMonthKey } from '../lib/transaction-month'
import { validActivityRange, activityRangeLabel } from '../lib/dashboard-range'
import { todayInIndia } from '../lib/dashboard-preview'
import { formatMinorCurrency } from '../lib/format'
import { previewDate as formatDate } from '../components/dashboard/preview/PreviewAmount'
import { Button } from '../components/shadcn/button'
import { Card, CardContent } from '../components/shadcn/card'
import { Input } from '../components/shadcn/input'
import { Badge } from '../components/shadcn/badge'
import { Checkbox } from '../components/shadcn/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/shadcn/table'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/shadcn/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/shadcn/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/shadcn/dialog'
import { FilterChips, type FilterChip } from '../components/shared/FilterChips'
import { TransactionEditor } from './shadcn-transactions/TransactionEditor'
import { TransactionSheet } from './shadcn-transactions/TransactionSheet'
import './shadcn-transactions/transactions.css'

export default function TransactionsShadcnPage() {
  const { openMenu } = useOutletContext<{ openMenu: () => void }>(),
    [params, setParams] = useSearchParams()
  const filters = useMemo(() => readTransactionFilters(params), [params]),
    review = params.get('tab') === 'review'
  const month = validMonthKey(params.get('month'))
    ? params.get('month')!
    : todayInIndia().slice(0, 7)
  const range =
    validActivityRange(params.get('fromDate'), params.get('toDate')) ??
    monthBounds(month)
  const size = [10, 25, 50, 100].includes(Number(params.get('size')))
    ? Number(params.get('size'))
    : 25
  const p = Number(params.get('p') ?? 0),
    pageIndex = Number.isSafeInteger(p) && p >= 0 ? p : 0
  const sortBy = [
      'date',
      'description',
      'amount',
      'category',
      'account',
    ].includes(params.get('sort') ?? '')
      ? params.get('sort')!
      : 'date',
    sortOrder = params.get('order') === 'asc' ? 'asc' : 'desc'
  const scope = JSON.stringify([
    filters,
    range,
    review,
    sortBy,
    sortOrder,
    size,
  ])
  const [data, setData] = useState<{
      scope: string
      offset: number
      page: TransactionPage
    }>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [refresh, setRefresh] = useState(0),
    [accounts, setAccounts] = useState<AccountDto[]>([]),
    [categories, setCategories] = useState<CategoryDto[]>([]),
    [referencesReady, setReferencesReady] = useState(false),
    [referenceError, setReferenceError] = useState(''),
    [reviewCount, setReviewCount] = useState<number>(),
    [hidden, setHidden] = useState(() => {
      try {
        return (
          localStorage.getItem(
            'personal-finance:transactions-shadcn:privacy:v1',
          ) === 'true'
        )
      } catch {
        return false
      }
    }),
    [selection, setSelection] = useState<{
      scope: string
      ids: RowSelectionState
    }>({ scope: '', ids: {} }),
    [viewing, setViewing] = useState<string>(),
    [editing, setEditing] = useState<TransactionDto | null>(),
    [deleting, setDeleting] = useState<TransactionDto>(),
    [bulk, setBulk] = useState(false),
    [bulkCategory, setBulkCategory] = useState(''),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState(''),
    [dateOpen, setDateOpen] = useState(false),
    [optionSearch, setOptionSearch] = useState('')
  const page =
    data?.scope === scope && data.offset === pageIndex * size
      ? data.page
      : undefined
  const selected = selection.scope === scope ? selection.ids : {},
    ids = Object.keys(selected).filter((id) => selected[id])
  function navigate(next: URLSearchParams, replace = false) {
    next.delete('p')
    setParams(next, { replace })
    setNotice('')
  }
  function changeFilter(key: string, value: string) {
    const next = writeTransactionFilters(params, { ...filters, [key]: value })
    navigate(next, key === 'search')
  }
  useEffect(() => {
    const c = new AbortController()
    setReferencesReady(false)
    setReferenceError('')
    void Promise.all([getAccounts(), getCategories()])
      .then(([a, b]) => {
        if (!c.signal.aborted) {
          setAccounts(a)
          setCategories(b)
          setReferencesReady(true)
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setReferenceError(e.message)
      })
    return () => c.abort()
  }, [refresh])
  useEffect(() => {
    const c = new AbortController()
    setLoading(true)
    setError('')
    const query = {
      fromDate: range.fromDate,
      toDate: range.toDate,
      search: filters.search.trim() || undefined,
      type: filters.type === 'All' ? undefined : filters.type.toLowerCase(),
      categoryId: filters.category === 'All' ? undefined : filters.category,
      accountId: filters.account === 'All' ? undefined : filters.account,
      source: review
        ? 'sms'
        : filters.source === 'All'
          ? undefined
          : filters.source.toLowerCase(),
      status: review
        ? 'pending'
        : filters.status === 'All'
          ? undefined
          : filters.status.toLowerCase(),
      sortBy,
      sortOrder,
      limit: size,
      offset: pageIndex * size,
    }
    void getTransactionPage(query, c.signal)
      .then((value) => {
        if (c.signal.aborted) return
        if (pageIndex > 0 && pageIndex * size >= value.total) {
          const next = new URLSearchParams(params)
          next.set(
            'p',
            String(Math.max(0, Math.floor((value.total - 1) / size))),
          )
          setParams(next, { replace: true })
          return
        }
        setData({ scope, offset: pageIndex * size, page: value })
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message)
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false)
      })
    void getTransactionPage(
      {
        fromDate: range.fromDate,
        toDate: range.toDate,
        status: 'pending',
        source: 'sms',
        limit: 1,
        offset: 0,
      },
      c.signal,
    )
      .then((v) => {
        if (!c.signal.aborted) setReviewCount(v.total)
      })
      .catch(() => {
        if (!c.signal.aborted) setReviewCount(undefined)
      })
    return () => c.abort()
  }, [scope, pageIndex, refresh]) // Scope contains all request filters.
  const accountName = (i: TransactionDto) =>
    [i.fromAccountId, i.toAccountId]
      .filter(Boolean)
      .map(
        (id) =>
          accounts.find((a) => a.id === id)?.name ?? 'Account unavailable',
      )
      .join(' → ') || 'Not recorded'
  const categoryName = (i: TransactionDto) =>
    categories.find((c) => c.id === i.categoryId)?.name ??
    (i.categoryId ? 'Category unavailable' : 'Uncategorised')
  const money = (minor: number) => displayAmountMinor(minor, hidden)
  function togglePrivacy() {
    const value = !hidden
    setHidden(value)
    try {
      localStorage.setItem(
        'personal-finance:transactions-shadcn:privacy:v1',
        String(value),
      )
    } catch {
      /* Session preference remains available. */
    }
  }
  async function status(id: string, value: 'confirmed' | 'ignored') {
    await updateTransactionStatus(id, value)
    setRefresh((n) => n + 1)
    setNotice('Transaction updated.')
  }
  const columns: ColumnDef<TransactionDto>[] = [
    {
      id: 'select',
      header: () => (
        <Checkbox
          aria-label="Select this page"
          disabled={loading || busy || !page?.items.length}
          checked={
            page?.items.length
              ? page.items.every((i) => selected[i.id])
                ? true
                : page.items.some((i) => selected[i.id])
                  ? 'indeterminate'
                  : false
              : false
          }
          onCheckedChange={(checked) => {
            const next = { ...selected }
            for (const i of page?.items ?? [])
              if (checked) next[i.id] = true
              else delete next[i.id]
            if (Object.keys(next).length > 100) {
              setNotice('Select up to 100 transactions.')
              return
            }
            setSelection({ scope, ids: next })
          }}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select ${row.original.description}`}
          checked={!!selected[row.original.id]}
          disabled={
            loading || busy || (!selected[row.original.id] && ids.length >= 100)
          }
          onCheckedChange={(v) => {
            const next = { ...selected }
            if (v) next[row.original.id] = true
            else delete next[row.original.id]
            setSelection({ scope, ids: next })
          }}
        />
      ),
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: 'Transaction',
      cell: ({ row }) => {
        const i = row.original,
          effective =
            i.transactionType === 'income'
              ? (i.accountingDate ?? i.transactionDate)
              : i.transactionDate
        return (
          <button
            className="st-transaction-name"
            onClick={() => setViewing(i.id)}
          >
            <span className={`st-avatar ${i.transactionType}`}>
              {i.description.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{i.description}</strong>
              <small>
                {formatDate(effective)}
                {i.accountingDate && i.accountingDate !== i.transactionDate
                  ? ` · received ${formatDate(i.transactionDate)}`
                  : ''}
              </small>
            </span>
          </button>
        )
      },
    },
    {
      id: 'category',
      header: 'Category',
      cell: ({ row }) => (
        <span>
          {categoryName(row.original)}
          {row.original.categoryOrigin === 'ai' && (
            <small className="st-muted">AI categorised</small>
          )}
        </span>
      ),
    },
    {
      id: 'account',
      header: 'Account',
      cell: ({ row }) => (
        <Badge variant="outline" className="st-account">
          {accountName(row.original)}
        </Badge>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <span className={`st-type ${row.original.transactionType}`}>
          {row.original.transactionType}
        </span>
      ),
    },
    {
      id: 'amount',
      accessorKey: 'amountMinor',
      header: 'Amount',
      cell: ({ row }) => (
        <strong className={`st-amount ${row.original.transactionType}`}>
          {hidden
            ? '••••••'
            : `${['income', 'refund'].includes(row.original.transactionType) ? '+' : row.original.transactionType === 'transfer' ? '' : '−'}${formatMinorCurrency(row.original.amountMinor)}`}
        </strong>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={`st-status ${row.original.status}`}
        >
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${row.original.description}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="st-theme">
            <DropdownMenuItem onSelect={() => setViewing(row.original.id)}>
              View details
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!referencesReady}
              onSelect={() => {
                setActionError('')
                setEditing(row.original)
              }}
            >
              Edit transaction
            </DropdownMenuItem>
            <DropdownMenuItem
              className="st-danger"
              onSelect={() => {
                setActionError('')
                setDeleting(row.original)
              }}
            >
              Delete transaction
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]
  const table = useReactTable({
    data: page?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    getRowId: (i) => i.id,
  })
  const chips: FilterChip[] = []
  for (const key of [
    'search',
    'type',
    'category',
    'account',
    'source',
    'status',
  ] as const) {
    if (
      (review && (key === 'source' || key === 'status')) ||
      !filters[key] ||
      filters[key] === 'All'
    )
      continue
    const value =
      key === 'category'
        ? (categories.find((c) => c.id === filters[key])?.name ??
          'Unavailable category')
        : key === 'account'
          ? (accounts.find((a) => a.id === filters[key])?.name ??
            'Unavailable account')
          : filters[key]
    chips.push({
      key,
      label: `${key}: ${value}`,
      remove: () => changeFilter(key, key === 'search' ? '' : 'All'),
    })
  }
  function switchTab(value: boolean) {
    const next = writeTransactionFilters(params, {
      ...filters,
      status: 'All',
      source: 'All',
    })
    if (value) next.set('tab', 'review')
    else next.delete('tab')
    navigate(next)
  }
  return (
    <div className="st-theme st-page">
      <header className="st-header">
        <div>
          <Button
            variant="ghost"
            size="icon"
            onClick={openMenu}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <h1>
            Transactions <Badge variant="secondary">shadcn</Badge>
          </h1>
        </div>
        <div>
          <Button
            variant="outline"
            size="icon"
            aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
            onClick={togglePrivacy}
          >
            {hidden ? <EyeOff /> : <Eye />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh transactions"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            <RefreshCw />
          </Button>
          <Button
            disabled={!referencesReady}
            onClick={() => {
              setActionError('')
              setEditing(null)
            }}
          >
            <Plus />
            Add transaction
          </Button>
        </div>
      </header>
      <div className="st-body">
        {(error || referenceError) && (
          <div role="alert" className="st-error">
            {error || referenceError}{' '}
            <Button variant="outline" onClick={() => setRefresh((n) => n + 1)}>
              Try again
            </Button>
          </div>
        )}
        {notice && (
          <p role="status" className="st-notice">
            {notice}
          </p>
        )}
        <div className="st-period">
          <div>
            <strong>{activityRangeLabel(range)}</strong>
            <small>
              {review
                ? 'Pending SMS review'
                : 'Confirmed totals for all matching records'}{' '}
              · transfers excluded from spending
            </small>
          </div>
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline">Change dates</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="st-theme">
              <label>
                Month
                <Input
                  type="month"
                  value={month}
                  min="1900-01"
                  onChange={(e) => {
                    if (!validMonthKey(e.target.value)) return
                    const next = new URLSearchParams(params)
                    next.set('month', e.target.value)
                    next.delete('fromDate')
                    next.delete('toDate')
                    navigate(next)
                    setDateOpen(false)
                  }}
                />
              </label>
              <form
                key={JSON.stringify(range)}
                onSubmit={(e) => {
                  e.preventDefault()
                  const form = new FormData(e.currentTarget),
                    r = validActivityRange(
                      String(form.get('from')),
                      String(form.get('to')),
                    )
                  if (!r) {
                    setNotice('Choose valid dates in order, within 10 years.')
                    return
                  }
                  const next = new URLSearchParams(params)
                  next.set('fromDate', r.fromDate)
                  next.set('toDate', r.toDate)
                  navigate(next)
                  setDateOpen(false)
                }}
              >
                <label>
                  From
                  <Input
                    name="from"
                    type="date"
                    required
                    defaultValue={range.fromDate}
                  />
                </label>
                <label>
                  To
                  <Input
                    name="to"
                    type="date"
                    required
                    defaultValue={range.toDate}
                  />
                </label>
                <Button type="submit">Apply dates</Button>
              </form>
            </PopoverContent>
          </Popover>
        </div>
        <div className="st-metrics">
          {[
            {
              title: 'Money In',
              value: page?.summary.incomeMinor,
              Icon: ArrowDownLeft,
              kind: 'income',
              note: 'Recorded income',
            },
            {
              title: 'Money Out',
              value: page?.summary.expenseMinor,
              Icon: ArrowUpRight,
              kind: 'expense',
              note: 'After qualified refunds',
            },
            {
              title: 'Net cash flow',
              value: page?.summary.netCashFlowMinor,
              Icon: ArrowLeftRight,
              kind: 'neutral',
              note: 'Money In minus Money Out',
            },
            {
              title: 'Invested',
              value: page?.summary.investedMinor,
              Icon: TrendingUp,
              kind: 'investment',
              note: hidden
                ? 'Share hidden'
                : page && page.summary.incomeMinor > 0
                  ? `${((page.summary.investedMinor / page.summary.incomeMinor) * 100).toFixed(1)}% of Money In`
                  : 'No income percentage',
            },
          ].map(({ title, value, Icon, kind, note }) => (
            <Card key={title}>
              <CardContent className="st-metric">
                <div>
                  <span>{title}</span>
                  <Icon className={`st-metric-icon ${kind}`} />
                </div>
                <strong className={kind}>
                  {loading
                    ? '…'
                    : value === undefined
                      ? 'Unavailable'
                      : money(value)}
                </strong>
                <small>{note}</small>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="st-table-card">
          <div className="st-table-toolbar">
            <div>
              <h2>Transactions</h2>
              <div
                className="st-tabs"
                role="group"
                aria-label="Transaction view"
              >
                <Button
                  variant={review ? 'ghost' : 'secondary'}
                  size="sm"
                  onClick={() => switchTab(false)}
                >
                  All activity
                </Button>
                <Button
                  variant={review ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => switchTab(true)}
                >
                  Needs review {reviewCount === undefined ? '…' : reviewCount}
                </Button>
              </div>
            </div>
            <div className="st-search-filter">
              <label className="st-search">
                <Search size={15} />
                <Input
                  type="search"
                  aria-label="Search transactions"
                  placeholder="Search transactions…"
                  value={filters.search}
                  onChange={(e) => changeFilter('search', e.target.value)}
                />
              </label>
              <Popover
                onOpenChange={(open) => {
                  if (!open) setOptionSearch('')
                }}
              >
                <PopoverTrigger asChild>
                  <Button variant="outline">
                    <SlidersHorizontal size={15} />
                    Filter
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="st-theme st-filter-grid">
                  <label>
                    Find account or category
                    <Input
                      type="search"
                      value={optionSearch}
                      onChange={(e) => setOptionSearch(e.target.value)}
                      placeholder="Search filter options…"
                    />
                  </label>
                  {(
                    [
                      {
                        key: 'type',
                        label: 'Type',
                        options: [
                          'Expense',
                          'Income',
                          'Transfer',
                          'Investment',
                          'Refund',
                        ].map((v) => ({ value: v, label: v })),
                      },
                      {
                        key: 'category',
                        label: 'Category',
                        options: categories.map((c) => ({
                          value: c.id,
                          label: c.name,
                        })),
                      },
                      {
                        key: 'account',
                        label: 'Account',
                        options: accounts.map((a) => ({
                          value: a.id,
                          label: a.name,
                        })),
                      },
                      ...(review
                        ? []
                        : [
                            {
                              key: 'source',
                              label: 'Source',
                              options: ['SMS', 'Manual', 'Import'].map((v) => ({
                                value: v,
                                label: v,
                              })),
                            },
                            {
                              key: 'status',
                              label: 'Status',
                              options: ['Pending', 'Confirmed', 'Ignored'].map(
                                (v) => ({ value: v, label: v }),
                              ),
                            },
                          ]),
                    ] as {
                      key: keyof typeof filters
                      label: string
                      options: { value: string; label: string }[]
                    }[]
                  ).map((field) => (
                    <label key={field.key}>
                      {field.label}
                      <select
                        value={filters[field.key]}
                        onChange={(e) =>
                          changeFilter(field.key, e.target.value)
                        }
                      >
                        <option value="All">All</option>
                        {field.options
                          .filter(
                            (o) =>
                              !['category', 'account'].includes(field.key) ||
                              !optionSearch ||
                              o.label
                                .toLowerCase()
                                .includes(optionSearch.toLowerCase()),
                          )
                          .map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <FilterChips
            chips={chips}
            clear={() =>
              navigate(writeTransactionFilters(params, emptyFilters))
            }
            hint="Selected dates stay unchanged."
          />
          {ids.length > 0 && (
            <div className="st-selection" role="status">
              <strong>{ids.length} selected</strong>
              <Button
                size="sm"
                variant="outline"
                disabled={!referencesReady}
                onClick={() => {
                  setActionError('')
                  setBulkCategory('')
                  setBulk(true)
                }}
              >
                Assign category
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelection({ scope, ids: {} })}
              >
                Clear selection
              </Button>
            </div>
          )}
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((g) => (
                <TableRow key={g.id}>
                  {g.headers.map((h) => {
                    const sortable = [
                        'description',
                        'category',
                        'account',
                        'amount',
                      ].includes(h.column.id),
                      active = sortBy === h.column.id
                    return (
                      <TableHead
                        key={h.id}
                        className={`st-col-${h.column.id}`}
                        aria-sort={
                          sortable
                            ? active
                              ? sortOrder === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : 'none'
                            : undefined
                        }
                      >
                        {sortable ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            title={
                              h.column.id === 'amount'
                                ? 'Sort by amount size in paise'
                                : undefined
                            }
                            onClick={() => {
                              const next = new URLSearchParams(params)
                              next.set('sort', h.column.id)
                              next.set(
                                'order',
                                active && sortOrder === 'asc' ? 'desc' : 'asc',
                              )
                              navigate(next)
                            }}
                          >
                            {flexRender(
                              h.column.columnDef.header,
                              h.getContext(),
                            )}
                            <ArrowUpDown size={13} />
                          </Button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <p className="st-empty" role="status">
                      Loading transactions…
                    </p>
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <p className="st-empty">
                      Transactions unavailable. Try again above.
                    </p>
                  </TableCell>
                </TableRow>
              ) : !page?.items.length ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <p className="st-empty">
                      {review
                        ? 'Your SMS review queue is clear for these filters.'
                        : 'No matching transactions. Adjust your filters or dates.'}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={selected[row.id] ? 'selected' : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={`st-col-${cell.column.id}`}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <footer className="st-pagination">
            <span role="status">
              {page?.total
                ? `${pageIndex * size + 1}–${Math.min((pageIndex + 1) * size, page.total)} of ${page.total} transactions`
                : loading
                  ? 'Loading…'
                  : '0 transactions'}
            </span>
            <label>
              Per page
              <select
                value={size}
                onChange={(e) => {
                  const next = new URLSearchParams(params)
                  next.set('size', e.target.value)
                  navigate(next)
                }}
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="st-order">
              Order
              <select
                value={sortBy === 'date' ? sortOrder : 'custom'}
                onChange={(e) => {
                  const next = new URLSearchParams(params)
                  next.set('sort', 'date')
                  next.set('order', e.target.value)
                  navigate(next)
                }}
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
                {sortBy !== 'date' && (
                  <option value="custom">Column sorting</option>
                )}
              </select>
            </label>
            <div>
              <Button
                size="icon"
                variant="outline"
                aria-label="Previous page"
                disabled={loading || pageIndex === 0}
                onClick={() => {
                  const next = new URLSearchParams(params)
                  next.set('p', String(pageIndex - 1))
                  setParams(next)
                }}
              >
                <ChevronLeft />
              </Button>
              <span>
                {pageIndex + 1} /{' '}
                {Math.max(1, Math.ceil((page?.total ?? 0) / size))}
              </span>
              <Button
                size="icon"
                variant="outline"
                aria-label="Next page"
                disabled={
                  loading || !page || (pageIndex + 1) * size >= page.total
                }
                onClick={() => {
                  const next = new URLSearchParams(params)
                  next.set('p', String(pageIndex + 1))
                  setParams(next)
                }}
              >
                <ChevronRight />
              </Button>
            </div>
          </footer>
        </Card>
        <p className="st-footnote">
          Amounts retain paise. Totals cover all matching confirmed records, not
          just this page. Sorting Amount compares payment size; transfers do not
          count as spending.
        </p>
      </div>
      {viewing && (
        <TransactionSheet
          key={viewing}
          id={viewing}
          accounts={accounts}
          categories={categories}
          hidden={hidden}
          togglePrivacy={togglePrivacy}
          close={() => setViewing(undefined)}
          edit={(item) => {
            setViewing(undefined)
            setActionError('')
            setEditing(item)
          }}
          status={status}
        />
      )}
      {editing !== undefined && (
        <TransactionEditor
          key={editing?.id ?? 'new'}
          item={editing}
          accounts={accounts}
          categories={categories}
          close={() => setEditing(undefined)}
          save={async (value) => {
            if (editing) await updateTransaction(editing.id, value)
            else await createTransaction(value)
            setRefresh((n) => n + 1)
            setNotice('Transaction saved.')
          }}
        />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(undefined)
        }}
      >
        <DialogContent className="st-theme">
          <DialogHeader>
            <DialogTitle>Delete transaction?</DialogTitle>
            <DialogDescription>
              {deleting?.description}. This removes the recorded transaction.
              Linked payments and protected records retain their server
              safeguards.
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <p role="alert" className="st-error">
              {actionError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(undefined)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!deleting) return
                setBusy(true)
                setActionError('')
                try {
                  await removeTransaction(deleting.id)
                  setDeleting(undefined)
                  setRefresh((n) => n + 1)
                  setSelection({ scope, ids: {} })
                  setNotice('Transaction deleted.')
                } catch (e) {
                  setActionError(
                    e instanceof Error
                      ? e.message
                      : 'Could not delete transaction.',
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Deleting…' : 'Delete transaction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={bulk}
        onOpenChange={(open) => {
          if (!busy) setBulk(open)
        }}
      >
        <DialogContent className="st-theme">
          <DialogHeader>
            <DialogTitle>Assign category</DialogTitle>
            <DialogDescription>
              Apply one category to {ids.length} selected records. Their amounts
              and account balances stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <label>
            Category
            <select
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
            >
              <option value="">Choose category</option>
              {categories
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          {actionError && (
            <p role="alert" className="st-error">
              {actionError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setBulk(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy || !bulkCategory || !ids.length}
              onClick={async () => {
                setBusy(true)
                setActionError('')
                try {
                  await assignTransactionCategory(ids, bulkCategory)
                  setBulk(false)
                  setSelection({ scope, ids: {} })
                  setRefresh((n) => n + 1)
                  setNotice('Categories updated.')
                } catch (e) {
                  setActionError(
                    e instanceof Error
                      ? e.message
                      : 'Could not update categories.',
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Saving…' : 'Assign category'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
