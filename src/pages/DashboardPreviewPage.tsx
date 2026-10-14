import { useEffect, useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Building2, ChevronLeft, ChevronRight, ClipboardCheck, CreditCard, Menu, Plus, RefreshCw, Star, TrendingUp, Wallet } from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'
import { apiRequest } from '../api/client'
import type { AccountDto } from '../api/accounts'
import type { CategoryDto } from '../api/categories'
import type { CashFlowPoint } from '../api/dashboard'
import { getTransactionPage, type TransactionPage } from '../api/transactions'
import { CashFlowChart } from '../components/dashboard/CashFlowChart'
import { formatMinorCurrency, formatSignedCurrency } from '../lib/format'
import { currentMonthKey, monthBounds, monthLabel, shiftMonth, validMonthKey } from '../lib/transaction-month'
import { monthlyAllocation, previewBalances, previewMonths, priorityAccounts } from '../lib/dashboard-preview'
import '../dashboard-preview.css'

const pinKey = 'personal-finance:dashboard-preview:pins:v1'
function readPins(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(pinKey) ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [] } catch { return [] }
}
function relativeDate(value: string) {
  const day = value.slice(0, 10)
  const today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  const key = (date: Date) => `${currentMonthKey(date)}-${String(date.getDate()).padStart(2, '0')}`
  return day === key(today) ? 'Today' : day === key(yesterday) ? 'Yesterday' : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}
function State({ title, loading }: { title: string; loading: boolean }) { return <div className="dp-empty" role="status">{loading ? `Loading ${title}…` : `${title} unavailable. Refresh to try again.`}</div> }

export default function DashboardPreviewPage() {
  const { openMenu } = useOutletContext<{ openMenu: () => void }>()
  const [month, setMonth] = useState(currentMonthKey)
  const [refresh, setRefresh] = useState(0)
  const [period, setPeriod] = useState<3 | 6>(3)
  const [pins, setPins] = useState(readPins)
  const [data, setData] = useState<{ accounts?: AccountDto[]; categories?: CategoryDto[]; history?: CashFlowPoint[]; review?: number }>({})
  const [monthly, setMonthly] = useState<{ month: string; page: TransactionPage }>()
  const [loading, setLoading] = useState(true)
  const [monthLoading, setMonthLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [monthError, setMonthError] = useState(false)
  const [updated, setUpdated] = useState<Date>()
  useEffect(() => {
    const controller = new AbortController(); const signal = controller.signal
    setLoading(true)
    void Promise.allSettled([
      apiRequest<AccountDto[]>('/api/accounts', { signal }),
      apiRequest<CategoryDto[]>('/api/categories', { signal }),
      apiRequest<CashFlowPoint[]>('/api/reports/cash-flow?period=all', { signal }),
      getTransactionPage({ source: 'sms', status: 'pending', limit: 1, offset: 0 }, signal),
    ]).then(([accounts, categories, history, review]) => {
      if (signal.aborted) return
      setData(previous => ({ ...previous, ...(accounts.status === 'fulfilled' ? { accounts: accounts.value } : {}), ...(categories.status === 'fulfilled' ? { categories: categories.value } : {}), ...(history.status === 'fulfilled' ? { history: history.value } : {}), ...(review.status === 'fulfilled' ? { review: review.value.total } : {}) }))
      setErrors([accounts.status === 'rejected' ? 'balances and accounts' : '', categories.status === 'rejected' ? 'category names' : '', history.status === 'rejected' ? 'cash flow' : '', review.status === 'rejected' ? 'review status' : ''].filter(Boolean))
      if ([accounts, categories, history, review].every(result => result.status === 'fulfilled')) setUpdated(new Date())
      setLoading(false)
    })
    return () => controller.abort()
  }, [refresh])
  useEffect(() => {
    const controller = new AbortController(); setMonthLoading(true); setMonthError(false)
    void getTransactionPage({ ...monthBounds(month), status: 'confirmed', limit: 5, offset: 0 }, controller.signal).then(page => {
      if (!controller.signal.aborted) setMonthly({ month, page })
    }).catch(() => { if (!controller.signal.aborted) setMonthError(true) }).finally(() => { if (!controller.signal.aborted) setMonthLoading(false) })
    return () => controller.abort()
  }, [month, refresh])
  const page = monthly?.month === month ? monthly.page : undefined
  const balances = data.accounts ? previewBalances(data.accounts) : undefined
  const sorted = useMemo(() => priorityAccounts(data.accounts ?? [], pins), [data.accounts, pins])
  const cashAccounts = sorted.filter(a => a.accountType !== 'credit_card'), cards = sorted.filter(a => a.accountType === 'credit_card')
  const points = useMemo(() => previewMonths(data.history ?? [], month, period), [data.history, month, period])
  const allocation = page ? monthlyAllocation(page.summary.incomeMinor, page.summary.expenseMinor, page.summary.investedMinor) : undefined
  const togglePin = (id: string) => { setPins(previous => { const next = previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]; try { localStorage.setItem(pinKey, JSON.stringify(next)) } catch { /* Pinning still works for this session. */ } return next }) }
  const accountRows = (accounts: AccountDto[]) => accounts.map(account => {
    const card = account.accountType === 'credit_card', owed = card && account.currentBalanceMinor <= 0
    const Icon = card ? CreditCard : account.accountType === 'bank' ? Building2 : Wallet
    return <div className="dp-account" key={account.id}><Link to={`/accounts?search=${encodeURIComponent(account.name)}`}><span className="dp-account-icon"><Icon size={18}/></span><span className="dp-account-name"><strong>{account.name}</strong><small>{account.institution || account.accountType}{account.last4 ? ` · ${account.last4}` : ''}</small></span><span className="dp-account-value"><strong>{formatSignedCurrency((owed ? -account.currentBalanceMinor : account.currentBalanceMinor) / 100)}</strong>{card && <small>{owed ? 'Amount owed' : 'Credit balance'}</small>}</span></Link><button aria-label={`${pins.includes(account.id) ? 'Unpin' : 'Pin'} ${account.name}`} aria-pressed={pins.includes(account.id)} onClick={() => togglePin(account.id)}><Star size={17} fill={pins.includes(account.id) ? 'currentColor' : 'none'}/></button></div>
  })
  return <div className="dashboard-preview">
    <header className="activity-header"><button className="icon-button activity-menu" onClick={openMenu} aria-label="Open navigation"><Menu/></button><h1>Dashboard preview</h1><button className="icon-button activity-refresh" onClick={() => setRefresh(value => value + 1)} disabled={loading || monthLoading} aria-label="Refresh preview"><RefreshCw/></button><Link className="secondary-button dp-add" aria-label="Add transaction" to="/transactions?new=1"><Plus size={18}/><span>Add transaction</span></Link></header>
    <div className="page-body dp-body">
      <div className="dp-intro"><div><span className="dp-eyebrow">YOUR HOUSEHOLD OVERVIEW</span><h2>A clearer picture of your money.</h2><p>Current balances, monthly activity and what needs your attention.</p></div><Link to="/" className="dp-text-link">Original dashboard <ArrowRight size={16}/></Link></div>
      {(errors.length > 0 || monthError) && <div className="api-feedback error" role="alert">Could not refresh {[...errors, ...(monthError ? ['monthly activity'] : [])].join(', ')}. Previously loaded data may be out of date. <button onClick={() => setRefresh(value => value + 1)} className="secondary-button">Try again</button></div>}
      <section className="dp-balance panel" aria-labelledby="dp-balances"><div className="dp-section-head"><h2 id="dp-balances">Recorded balances</h2><span>Current · all active household accounts</span></div>{balances ? <div className="dp-balance-grid"><div className="dp-bank"><span><Building2 size={17}/>Bank balances</span><strong>{formatSignedCurrency(balances.bank / 100)}</strong><small>Based on recorded transactions</small></div><div><span><Wallet size={17}/>Cash & wallets</span><strong>{formatSignedCurrency(balances.cash / 100)}</strong><small>Includes clearing accounts</small></div><div><span><CreditCard size={17}/>Card amounts owed</span><strong>{formatMinorCurrency(balances.owed)}</strong><small>Recorded debt · credit balances excluded</small></div></div> : <State title="balances" loading={loading}/>}<p className="dp-footnote">These are recorded balances, not a bank sync or an amount reserved for upcoming bills.</p></section>
      <section className="dp-month" aria-labelledby="dp-month-title"><div className="dp-section-head"><div><h2 id="dp-month-title">Monthly activity</h2><span>Confirmed transactions · {monthLabel(month)}</span></div><div className="dp-month-picker"><button aria-label="Previous month" disabled={month <= '1900-01'} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={19}/></button><input type="month" aria-label="Activity month" value={month} min="1900-01" max={currentMonthKey()} onChange={event => { if (validMonthKey(event.target.value) && event.target.value <= currentMonthKey()) setMonth(event.target.value) }}/><button aria-label="Next month" disabled={month >= currentMonthKey()} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={19}/></button></div></div>{page && allocation ? <div className="dp-metrics" aria-busy={monthLoading}><Link to={`/transactions?month=${month}`} className="dp-metric"><span><ArrowDownLeft size={17}/>Money in</span><strong>{formatMinorCurrency(page.summary.incomeMinor)}</strong><small>Income recorded this month</small></Link><Link to={`/transactions?month=${month}`} className="dp-metric"><span><ArrowUpRight size={17}/>Money out</span><strong>{formatSignedCurrency(page.summary.expenseMinor / 100)}</strong><small>Spending after refunds</small></Link><Link to={`/transactions?month=${month}`} className="dp-metric dp-invested"><span><TrendingUp size={17}/>Invested {allocation.investedPercent !== null && <em>({allocation.investedPercent.toFixed(1)}%)</em>}</span><strong>{formatMinorCurrency(page.summary.investedMinor)}</strong><small>{allocation.investedPercent === null ? 'No income recorded for a percentage' : 'Percentage of money in'} · excluded from spending</small></Link><div className="dp-metric"><span>Income remaining</span><strong className={allocation.remaining < 0 ? 'dp-negative' : ''}>{formatSignedCurrency(allocation.remaining / 100)}</strong><small>Income minus spending and investments</small></div></div> : <State title="monthly activity" loading={monthLoading}/>}</section>
      <section className={`dp-attention ${data.review ? 'has-review' : ''}`} aria-label="Review status"><ClipboardCheck size={24}/><div><strong>{data.review === undefined ? 'Review status unavailable' : data.review > 0 ? `${data.review} SMS ${data.review === 1 ? 'transaction needs' : 'transactions need'} review` : 'Your SMS review queue is clear'}</strong><p>All months · confirm account matching and transaction details.</p></div><Link className={data.review ? 'primary-button' : 'secondary-button'} to="/transactions?tab=review">Review queue <ArrowRight size={16}/></Link></section>
      <div className="dp-content">
        <section className="dp-recent panel"><div className="dp-section-head"><div><h2>Recent activity</h2><span>{monthLabel(month)} · latest confirmed transactions</span></div><Link className="dp-text-link" to={`/transactions?month=${month}`}>View all <ArrowRight size={16}/></Link></div>{page ? page.items.length ? <div>{page.items.map(transaction => {
          const accountName = (id: string | null) => data.accounts?.find(a => a.id === id)?.name ?? (id ? 'Account unavailable' : '')
          const account = [accountName(transaction.fromAccountId), accountName(transaction.toAccountId)].filter(Boolean).join(' → ')
          const category = data.categories?.find(c => c.id === transaction.categoryId)?.name ?? (transaction.categoryId ? 'Category unavailable' : 'Uncategorised')
          const positive = transaction.transactionType === 'income' || transaction.transactionType === 'refund'
          return <Link className="dp-transaction" key={transaction.id} to={`/transactions?month=${month}&search=${encodeURIComponent(transaction.description)}`}><span className={`dp-transaction-icon ${positive ? 'income' : ''}`}>{transaction.transactionType === 'investment' ? <TrendingUp size={18}/> : positive ? <ArrowDownLeft size={18}/> : <ArrowUpRight size={18}/>}</span><span className="dp-transaction-name"><strong>{transaction.description}</strong><small>{category} · {relativeDate(transaction.transactionDate)}</small>{account && <small>{account}</small>}</span><span className="dp-transaction-value"><strong className={positive ? 'dp-positive' : ''}>{positive ? '+' : transaction.transactionType === 'expense' ? '−' : ''}{formatMinorCurrency(transaction.amountMinor)}</strong><small>{transaction.transactionType}</small></span></Link>
        })}</div> : <div className="dp-empty">No confirmed activity recorded for {monthLabel(month)}.</div> : <State title="recent activity" loading={monthLoading}/>}</section>
        <section className="dp-trend"><div className="dp-section-head"><div><h2>Income & spending trend</h2><span>Total over {period} months · {monthLabel(points[0].month)}–{monthLabel(month)}</span></div><div className="dp-period" role="group" aria-label="Trend period">{([3, 6] as const).map(value => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{value} months</button>)}</div></div>{data.history ? <CashFlowChart key={`${month}-${period}`} points={points} showPeriodControls={false} title={`Total over ${period} months`}/> : <State title="cash flow" loading={loading}/>}<p className="dp-footnote">Inspect a bar for that month’s values. Top cards stay on {monthLabel(month)}. Zero bars mean no recorded income or spending.</p></section>
        <section className="dp-accounts panel"><div className="dp-section-head"><div><h2>Your accounts</h2><span>Pin favourites · larger balances first</span></div><Link className="dp-text-link" to="/accounts">Manage <ArrowRight size={16}/></Link></div>{data.accounts ? <><h3>Bank, cash & wallets</h3>{cashAccounts.length ? accountRows(cashAccounts.slice(0, 5)) : <p className="dp-empty">No active bank, cash or wallet accounts.</p>}{cashAccounts.length > 5 && <details><summary>{cashAccounts.length - 5} more accounts</summary>{accountRows(cashAccounts.slice(5))}</details>}<h3>Credit cards</h3>{cards.length ? accountRows(cards.slice(0, 3)) : <p className="dp-empty">No active credit cards.</p>}{cards.length > 3 && <details><summary>{cards.length - 3} more credit cards</summary>{accountRows(cards.slice(3))}</details>}</> : <State title="accounts" loading={loading}/>}</section>
      </div>
      <p className="dp-footer" role="status">{loading || monthLoading ? 'Refreshing recorded data…' : `Overview fetched ${updated ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' }).format(updated) : 'not yet'}.${monthError || errors.length ? ' Some sections could not refresh.' : ''}`} · Preview version</p>
    </div>
  </div>
}
