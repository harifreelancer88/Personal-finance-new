import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  ClipboardCheck,
  CreditCard,
  Eye,
  EyeOff,
  Menu,
  Plus,
  RefreshCw,
  Star,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { apiRequest } from '../api/client'
import type { AccountDto } from '../api/accounts'
import type { CategoryDto } from '../api/categories'
import type { CashFlowPoint } from '../api/dashboard'
import { getInvestments } from '../api/investments'
import { getTransactionPage, type TransactionPage } from '../api/transactions'
import type { Investment } from '../types/finance'
import { CashFlowChart } from '../components/dashboard/CashFlowChart'
import {
  PreviewAmount,
  PreviewPrivacy,
  PreviewState,
} from '../components/dashboard/preview/PreviewAmount'
import { PreviewOverview } from '../components/dashboard/preview/PreviewOverview'
import { PreviewInvestments } from '../components/dashboard/preview/PreviewInvestments'
import { ActivityDateSelector } from '../components/dashboard/preview/ActivityDateSelector'
import { PreviewMetricCard } from '../components/dashboard/preview/PreviewMetricCard'
import {
  activityPreset,
  activityRangeLabel,
  activityLink,
  validActivityRange,
} from '../lib/dashboard-range'
import {
  monthlyAllocation,
  priorityAccounts,
  todayInIndia,
  type RecordedWorth,
} from '../lib/dashboard-preview'
import '../dashboard-preview.css'

const pinKey = 'personal-finance:dashboard-preview:pins:v1'
const privacyKey = 'personal-finance:dashboard-preview:privacy:v1'
function readPins(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(pinKey) ?? '[]')
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : []
  } catch {
    return []
  }
}
function readHidden() {
  try {
    return localStorage.getItem(privacyKey) === 'true'
  } catch {
    return false
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* Controls still work for this session. */
  }
}
function relativeDate(value: string) {
  const day = value.slice(0, 10),
    today = todayInIndia()
  const yesterday = new Date(Date.parse(today) - 86_400_000)
    .toISOString()
    .slice(0, 10)
  return day === today
    ? 'Today'
    : day === yesterday
      ? 'Yesterday'
      : new Intl.DateTimeFormat('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${day}T00:00:00Z`))
}

function AccountRows({
  accounts,
  pins,
  togglePin,
}: {
  accounts: AccountDto[]
  pins: string[]
  togglePin: (id: string) => void
}) {
  return accounts.map((account) => {
    const card = account.accountType === 'credit_card',
      owed = card && account.currentBalanceMinor <= 0
    const Icon = card
      ? CreditCard
      : account.accountType === 'bank'
        ? Building2
        : Wallet
    const pinned = pins.includes(account.id)
    return (
      <div className="dp-account" key={account.id}>
        <button
          className="dp-pin"
          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${account.name}`}
          aria-pressed={pinned}
          onClick={() => togglePin(account.id)}
        >
          <Star size={16} fill={pinned ? 'currentColor' : 'none'} />
        </button>
        <Link to={`/accounts?search=${encodeURIComponent(account.name)}`}>
          <span className="dp-account-icon">
            <Icon size={17} />
          </span>
          <span className="dp-account-name">
            <strong>{account.name}</strong>
            <small>
              {account.institution || account.accountType}
              {account.last4 ? ` · ${account.last4}` : ''}
            </small>
          </span>
          <span className="dp-account-value">
            <strong>
              <PreviewAmount
                minor={
                  owed
                    ? -account.currentBalanceMinor
                    : account.currentBalanceMinor
                }
              />
            </strong>
            {card && <small>{owed ? 'Amount owed' : 'Credit balance'}</small>}
          </span>
        </Link>
      </div>
    )
  })
}

interface PreviewData {
  accounts?: AccountDto[]
  categories?: CategoryDto[]
  review?: number
  worth?: RecordedWorth
  holdings?: Investment[]
}

export default function DashboardPreviewPage() {
  const { openMenu } = useOutletContext<{ openMenu: () => void }>()
  const [params, setParams] = useSearchParams()
  const today = todayInIndia()
  const requested = validActivityRange(
    params.get('fromDate'),
    params.get('toDate'),
  )
  const range =
    requested && requested.toDate <= today
      ? requested
      : activityPreset('thisMonth', today)
  const { fromDate, toDate } = range
  const rangeKey = `${fromDate}:${toDate}`
  const rangeLabel = activityRangeLabel(range)
  const [refresh, setRefresh] = useState(0)
  const [hidden, setHidden] = useState(readHidden)
  const [pins, setPins] = useState(readPins)
  const [data, setData] = useState<PreviewData>({})
  const [monthly, setMonthly] = useState<{
    key: string
    page: TransactionPage
    points: CashFlowPoint[]
  }>()
  const [loading, setLoading] = useState(true)
  const [monthLoading, setMonthLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [monthError, setMonthError] = useState(false)
  const [updated, setUpdated] = useState<Date>()
  useEffect(() => {
    const controller = new AbortController()
    const signal = controller.signal
    setLoading(true)
    void Promise.allSettled([
      apiRequest<AccountDto[]>('/api/accounts', { signal }),
      apiRequest<CategoryDto[]>('/api/categories', { signal }),
      getTransactionPage(
        { source: 'sms', status: 'pending', limit: 1, offset: 0 },
        signal,
      ),
      apiRequest<RecordedWorth>('/api/net-worth', { signal }),
      getInvestments(signal),
    ]).then(([accounts, categories, review, worth, holdings]) => {
      if (signal.aborted) return
      setData((previous) => ({
        ...previous,
        ...(accounts.status === 'fulfilled'
          ? { accounts: accounts.value }
          : {}),
        ...(categories.status === 'fulfilled'
          ? { categories: categories.value }
          : {}),
        ...(review.status === 'fulfilled'
          ? { review: review.value.total }
          : {}),
        ...(worth.status === 'fulfilled' ? { worth: worth.value } : {}),
        ...(holdings.status === 'fulfilled'
          ? { holdings: holdings.value }
          : {}),
      }))
      setErrors(
        [
          accounts.status === 'rejected' ? 'accounts' : '',
          categories.status === 'rejected' ? 'category names' : '',
          review.status === 'rejected' ? 'review status' : '',
          worth.status === 'rejected' ? 'net worth' : '',
          holdings.status === 'rejected' ? 'investment valuations' : '',
        ].filter(Boolean),
      )
      if (
        [accounts, categories, review, worth, holdings].every(
          (result) => result.status === 'fulfilled',
        )
      )
        setUpdated(new Date())
      setLoading(false)
    })
    return () => controller.abort()
  }, [refresh])
  useEffect(() => {
    const controller = new AbortController()
    setMonthLoading(true)
    setMonthError(false)
    const query = new URLSearchParams({ fromDate, toDate })
    void Promise.all([
      getTransactionPage(
        { fromDate, toDate, status: 'confirmed', limit: 5, offset: 0 },
        controller.signal,
      ),
      apiRequest<CashFlowPoint[]>(`/api/reports/cash-flow?${query}`, {
        signal: controller.signal,
      }),
    ])
      .then(([page, points]) => {
        if (!controller.signal.aborted)
          setMonthly({ key: `${fromDate}:${toDate}`, page, points })
      })
      .catch(() => {
        if (!controller.signal.aborted) setMonthError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setMonthLoading(false)
      })
    return () => controller.abort()
  }, [fromDate, toDate, refresh])
  const page = monthly?.key === rangeKey ? monthly.page : undefined
  const points = monthly?.key === rangeKey ? monthly.points : undefined
  const sorted = useMemo(
    () => priorityAccounts(data.accounts ?? [], pins),
    [data.accounts, pins],
  )
  const cashAccounts = sorted.filter((a) => a.accountType !== 'credit_card'),
    cards = sorted.filter((a) => a.accountType === 'credit_card')
  const allocation = page
    ? monthlyAllocation(
        page.summary.incomeMinor,
        page.summary.expenseMinor,
        page.summary.investedMinor,
      )
    : undefined
  const accountNames = new Map(data.accounts?.map((a) => [a.id, a.name]))
  const categoryNames = new Map(data.categories?.map((c) => [c.id, c.name]))
  const togglePin = (id: string) =>
    setPins((previous) => {
      const next = previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id]
      remember(pinKey, JSON.stringify(next))
      return next
    })
  const toggleHidden = () => {
    const next = !hidden
    setHidden(next)
    remember(privacyKey, String(next))
  }
  return (
    <PreviewPrivacy value={hidden}>
      <div className="dashboard-preview">
        <header className="activity-header dp-header">
          <button
            className="icon-button activity-menu"
            onClick={openMenu}
            aria-label="Open navigation"
          >
            <Menu />
          </button>
          <h1>Dashboard preview</h1>
          <div className="dp-header-actions">
            <button
              className="dp-button dp-privacy-toggle"
              onClick={toggleHidden}
              aria-pressed={hidden}
              aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
            >
              {hidden ? <EyeOff size={17} /> : <Eye size={17} />}
              <span>{hidden ? 'Show amounts' : 'Hide amounts'}</span>
            </button>
            <button
              className="dp-button dp-refresh"
              onClick={() => setRefresh((value) => value + 1)}
              disabled={loading || monthLoading}
              aria-label="Refresh preview"
            >
              <RefreshCw
                size={16}
                className={loading || monthLoading ? 'dp-spinning' : ''}
              />
              <span>Refresh</span>
            </button>
            <Link
              className="dp-button dp-primary dp-add"
              aria-label="Add transaction"
              to="/transactions?new=1"
            >
              <Plus size={17} />
              <span>Add transaction</span>
            </Link>
          </div>
        </header>
        <div className="page-body dp-body">
          {(errors.length > 0 || monthError) && (
            <div className="dp-error" role="alert">
              Could not refresh{' '}
              {[...errors, ...(monthError ? ['period activity'] : [])].join(
                ', ',
              )}
              . Previously loaded values may be out of date.{' '}
              <button
                onClick={() => setRefresh((value) => value + 1)}
                className="dp-button"
              >
                Try again
              </button>
            </div>
          )}
          <PreviewOverview worth={data.worth} loading={loading} />
          <ActivityDateSelector
            key={rangeKey}
            range={range}
            today={today}
            onChange={(next) => {
              const query = new URLSearchParams(params)
              query.set('fromDate', next.fromDate)
              query.set('toDate', next.toDate)
              setParams(query)
            }}
          />
          <section
            className={`dp-attention ${data.review ? 'has-review' : ''}`}
            aria-label="Review status"
          >
            <ClipboardCheck size={21} />
            <div>
              <strong>
                {data.review === undefined
                  ? loading
                    ? 'Checking SMS review queue…'
                    : 'Review status unavailable'
                  : data.review > 0
                    ? `${data.review} SMS ${data.review === 1 ? 'transaction needs' : 'transactions need'} review`
                    : 'Your SMS review queue is clear'}
              </strong>
              <p>Confirm account matching and transaction details.</p>
            </div>
            <Link className="dp-text-link" to="/transactions?tab=review">
              Review queue <ArrowRight size={16} />
            </Link>
          </section>
          <div className="dp-content">
            <section
              className="dp-activity panel"
              aria-label="Selected period overview"
            >
              <section
                className="dp-month"
                aria-labelledby="dp-month-title"
                aria-busy={monthLoading}
              >
                <div className="dp-section-head">
                  <div>
                    <h2 id="dp-month-title">Activity overview</h2>
                    <span>Confirmed transactions · {rangeLabel}</span>
                  </div>
                </div>
                {page && allocation ? (
                  <div className="dp-metrics dp-period-cards">
                    <PreviewMetricCard
                      title="Money in"
                      minor={page.summary.incomeMinor}
                      note="Recorded income"
                      icon={<ArrowDownLeft size={17} />}
                      to={activityLink(range, { type: 'income' })}
                      loading={monthLoading}
                      tone="dp-positive"
                    />
                    <PreviewMetricCard
                      title="Money out"
                      minor={page.summary.expenseMinor}
                      note="Spending after refunds"
                      icon={<ArrowUpRight size={17} />}
                      to={activityLink(range)}
                      loading={monthLoading}
                    />
                    <PreviewMetricCard
                      title="Invested"
                      minor={page.summary.investedMinor}
                      note={
                        hidden
                          ? 'Share of income hidden'
                          : allocation.investedPercent === null
                            ? 'No income for a percentage'
                            : `${allocation.investedPercent.toFixed(1)}% of recorded income`
                      }
                      icon={<TrendingUp size={17} />}
                      to={activityLink(range, { type: 'investment' })}
                      loading={monthLoading}
                    />
                    <PreviewMetricCard
                      title="Income remaining"
                      minor={allocation.remaining}
                      note="After spending & investments"
                      icon={<Wallet size={17} />}
                      loading={monthLoading}
                      tone={
                        !hidden && allocation.remaining < 0 ? 'dp-negative' : ''
                      }
                    />
                  </div>
                ) : (
                  <PreviewState
                    title="period activity"
                    loading={monthLoading}
                  />
                )}
              </section>
              <section className="dp-trend" aria-labelledby="dp-trend-title">
                <div className="dp-section-head">
                  <div>
                    <h2 id="dp-trend-title">Income & spending</h2>
                    <span>{rangeLabel}</span>
                  </div>
                </div>
                {hidden ? (
                  <div className="dp-chart-hidden">
                    <EyeOff size={24} />
                    <strong>Chart hidden</strong>
                    <p>Show amounts to view income and spending.</p>
                  </div>
                ) : points ? (
                  <CashFlowChart
                    key={rangeKey}
                    points={points}
                    showPeriodControls={false}
                    title="Income & spending in selected period"
                  />
                ) : (
                  <PreviewState title="cash flow" loading={monthLoading} />
                )}
                <p className="dp-footnote">
                  Monthly bars include only transactions within the selected
                  dates. Transfers and card repayments are excluded from
                  spending.
                </p>
              </section>
              <section className="dp-recent" aria-labelledby="dp-recent-title">
                <div className="dp-section-head">
                  <div>
                    <h2 id="dp-recent-title">Recent activity</h2>
                    <span>{rangeLabel} · latest confirmed transactions</span>
                  </div>
                  <Link className="dp-text-link" to={activityLink(range)}>
                    View all <ArrowRight size={15} />
                  </Link>
                </div>
                <div className="dp-list-heading">
                  <span>Transaction</span>
                  <span>Amount</span>
                </div>
                {page ? (
                  page.items.length ? (
                    page.items.map((transaction) => {
                      const accountName = (id: string | null) =>
                        accountNames.get(id ?? '') ??
                        (id ? 'Account unavailable' : '')
                      const account = [
                        accountName(transaction.fromAccountId),
                        accountName(transaction.toAccountId),
                      ]
                        .filter(Boolean)
                        .join(' → ')
                      const category =
                        categoryNames.get(transaction.categoryId ?? '') ??
                        (transaction.categoryId
                          ? 'Category unavailable'
                          : 'Uncategorised')
                      const positive =
                        transaction.transactionType === 'income' ||
                        transaction.transactionType === 'refund'
                      return (
                        <Link
                          className="dp-transaction"
                          key={transaction.id}
                          to={activityLink(range, {
                            search: transaction.description,
                          })}
                        >
                          <span
                            className={`dp-transaction-icon ${positive ? 'income' : ''}`}
                          >
                            {transaction.transactionType === 'investment' ? (
                              <TrendingUp size={17} />
                            ) : positive ? (
                              <ArrowDownLeft size={17} />
                            ) : (
                              <ArrowUpRight size={17} />
                            )}
                          </span>
                          <span className="dp-transaction-name">
                            <strong>{transaction.description}</strong>
                            <small>
                              {category} ·{' '}
                              {relativeDate(transaction.transactionDate)}
                            </small>
                            {account && <small>{account}</small>}
                          </span>
                          <span className="dp-transaction-value">
                            <strong className={positive ? 'dp-positive' : ''}>
                              <PreviewAmount
                                minor={transaction.amountMinor}
                                sign={
                                  positive
                                    ? '+'
                                    : transaction.transactionType === 'expense'
                                      ? '−'
                                      : ''
                                }
                              />
                            </strong>
                            <small>{transaction.transactionType}</small>
                          </span>
                        </Link>
                      )
                    })
                  ) : (
                    <div className="dp-empty">
                      No confirmed activity recorded for {rangeLabel}.
                    </div>
                  )
                ) : (
                  <PreviewState
                    title="recent activity"
                    loading={monthLoading}
                  />
                )}
              </section>
            </section>
            <aside className="dp-sidebar" aria-label="Accounts and investments">
              <section
                className="dp-accounts panel"
                aria-labelledby="dp-accounts-title"
              >
                <div className="dp-section-head">
                  <div>
                    <h2 id="dp-accounts-title">Your accounts</h2>
                    <span>Active accounts · pin favourites</span>
                  </div>
                  <Link
                    className="dp-text-link"
                    to="/accounts"
                    aria-label="Manage accounts"
                  >
                    <ArrowRight size={17} />
                  </Link>
                </div>
                {data.accounts ? (
                  <>
                    <div className="dp-list-heading">
                      <span>Bank, cash & wallets</span>
                      <span>Balance</span>
                    </div>
                    {cashAccounts.length ? (
                      <AccountRows
                        accounts={cashAccounts.slice(0, 4)}
                        pins={pins}
                        togglePin={togglePin}
                      />
                    ) : (
                      <p className="dp-empty">
                        No active bank, cash or wallet accounts.
                      </p>
                    )}
                    {cashAccounts.length > 4 && (
                      <details>
                        <summary>
                          {cashAccounts.length - 4} more accounts
                        </summary>
                        <AccountRows
                          accounts={cashAccounts.slice(4)}
                          pins={pins}
                          togglePin={togglePin}
                        />
                      </details>
                    )}
                    <div className="dp-list-heading dp-cards-heading">
                      <span>Credit cards</span>
                      <span>Owed / credit</span>
                    </div>
                    {cards.length ? (
                      <AccountRows
                        accounts={cards.slice(0, 2)}
                        pins={pins}
                        togglePin={togglePin}
                      />
                    ) : (
                      <p className="dp-empty">No active credit cards.</p>
                    )}
                    {cards.length > 2 && (
                      <details>
                        <summary>{cards.length - 2} more credit cards</summary>
                        <AccountRows
                          accounts={cards.slice(2)}
                          pins={pins}
                          togglePin={togglePin}
                        />
                      </details>
                    )}
                    <Link to="/accounts" className="dp-text-link dp-manage">
                      Manage accounts <ArrowRight size={15} />
                    </Link>
                  </>
                ) : (
                  <PreviewState title="accounts" loading={loading} />
                )}
              </section>
              <PreviewInvestments
                holdings={data.holdings}
                asOf={todayInIndia()}
                loading={loading}
              />
            </aside>
          </div>
          <footer className="dp-footer">
            <p role="status">
              {loading || monthLoading
                ? 'Refreshing recorded data…'
                : `Last complete overview refresh: ${updated ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(updated) + ' IST' : 'not yet'}.`}
              {monthError || errors.length
                ? ' Some sections could not refresh.'
                : ''}
            </p>
            <Link to="/" className="dp-text-link">
              Original dashboard <ArrowRight size={14} />
            </Link>
          </footer>
        </div>
      </div>
    </PreviewPrivacy>
  )
}
