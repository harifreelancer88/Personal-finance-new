import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ListChecks, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { getAccounts, type AccountDto } from '../api/accounts'
import { getCategories, type CategoryDto } from '../api/categories'
import { createTransaction, getTransactionPage, removeTransaction, updateTransaction, updateTransactionStatus, type TransactionDto, type TransactionInput, type TransactionPage, type TransactionQuery } from '../api/transactions'
import { PageHeader } from '../components/layout/PageHeader'
import { ConfirmDialog } from '../components/transactions/ConfirmDialog'
import { TransactionDetails } from '../components/transactions/TransactionDetails'
import { emptyFilters, TransactionFilters, type FilterState } from '../components/transactions/TransactionFilters'
import { TransactionForm } from '../components/transactions/TransactionForm'
import { TransactionTable } from '../components/transactions/TransactionTable'
import { formatMinorCurrency, formatDate } from '../lib/format'
import type { Transaction } from '../types/finance'

const PAGE_SIZE = 25, REVIEW_SIZE = 5
const titleCase = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
function queryFor(filters: FilterState): TransactionQuery {
  const query: TransactionQuery = { search: filters.search.trim() || undefined }
  if (filters.type !== 'All') query.type = filters.type.toLowerCase()
  if (filters.category !== 'All') query.categoryId = filters.category
  if (filters.account !== 'All') query.accountId = filters.account
  if (filters.source !== 'All') query.source = filters.source.toLowerCase()
  if (filters.status !== 'All') query.status = filters.status.toLowerCase()
  if (filters.range !== 'All') {
    const today = new Date(), start = new Date(today)
    start.setDate(start.getDate()-Number(filters.range)+1)
    query.fromDate = dateKey(start); query.toDate = dateKey(today)
  }
  return query
}
function toView(dto: TransactionDto, accounts: AccountDto[], categories: CategoryDto[]): Transaction {
  const from = accounts.find(item => item.id === dto.fromAccountId)?.name, to = accounts.find(item => item.id === dto.toAccountId)?.name
  const account = dto.transactionType === 'transfer' ? `${from ?? 'Choose source'} → ${to ?? 'Choose destination'}` : (from ?? to ?? 'Choose account')
  return { id:dto.id, date:`${dto.transactionDate}T12:00:00`, description:dto.description, merchant:dto.notes ?? '', category:categories.find(item => item.id === dto.categoryId)?.name ?? (dto.transactionType === 'transfer' ? 'Transfer' : 'Uncategorised'), account, type:titleCase(dto.transactionType) as Transaction['type'], amount:dto.amountMinor/100, amountMinor:dto.amountMinor, status:titleCase(dto.status) as Transaction['status'], source:dto.source, notes:dto.notes ?? undefined, fromAccount:from, toAccount:to, fromAccountId:dto.fromAccountId, toAccountId:dto.toAccountId, categoryId:dto.categoryId, originalTransactionId:dto.originalTransactionId }
}
export function TransactionsPage() {
  const { openMenu } = useOutletContext<{ openMenu: () => void }>()
  const [accounts,setAccounts] = useState<AccountDto[]>([]), [categories,setCategories] = useState<CategoryDto[]>([])
  const [referenceReady,setReferenceReady] = useState(false), [referenceError,setReferenceError] = useState<string>()
  const [filters,setFilters] = useState<FilterState>(emptyFilters), [offset,setOffset] = useState(0), [reviewOffset,setReviewOffset] = useState(0)
  const [page,setPage] = useState<TransactionPage>(), [reviewPage,setReviewPage] = useState<TransactionPage>()
  const [loading,setLoading] = useState(true), [loadError,setLoadError] = useState<string>(), [refresh,setRefresh] = useState(0)
  const [form,setForm] = useState<{ mode:'add'|'edit'; item?:Transaction }>(), [viewing,setViewing] = useState<Transaction>(), [deleting,setDeleting] = useState<Transaction>()
  const [mutationError,setMutationError] = useState<string>(), [saving,setSaving] = useState(false), [isDeleting,setIsDeleting] = useState(false)
  const [statusBusy,setStatusBusy] = useState<string>(), statusLock = useRef(false)
  useEffect(() => {
    let active = true
    Promise.all([getAccounts(),getCategories()]).then(([nextAccounts,nextCategories]) => {
      if (active) { setAccounts(nextAccounts); setCategories(nextCategories); setReferenceReady(true); setReferenceError(undefined) }
    }).catch(error => { if (active) setReferenceError(error instanceof Error ? error.message : 'Could not load accounts and categories.') })
    return () => { active = false }
  },[refresh])
  const query = useMemo(() => queryFor(filters),[filters])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setLoadError(undefined)
    Promise.all([getTransactionPage({...query,limit:PAGE_SIZE,offset},controller.signal),getTransactionPage({source:'sms',status:'pending',limit:REVIEW_SIZE,offset:reviewOffset},controller.signal)])
      .then(([nextPage,nextReview]) => {
        if (controller.signal.aborted) return
        if (offset > 0 && offset >= nextPage.total) { setOffset(Math.max(0,Math.floor((nextPage.total-1)/PAGE_SIZE)*PAGE_SIZE)); return }
        if (reviewOffset > 0 && reviewOffset >= nextReview.total) { setReviewOffset(Math.max(0,Math.floor((nextReview.total-1)/REVIEW_SIZE)*REVIEW_SIZE)); return }
        setPage(nextPage); setReviewPage(nextReview)
      }).catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load transactions.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  },[query,offset,reviewOffset,refresh])
  const items = useMemo(() => page?.items.map(item => toView(item,accounts,categories)) ?? [],[page,accounts,categories])
  const pendingSms = useMemo(() => reviewPage?.items.map(item => toView(item,accounts,categories)) ?? [],[reviewPage,accounts,categories])
  const refreshData = () => setRefresh(value => value+1)
  const changeFilters = (next:FilterState) => { setFilters(next); setOffset(0); setPage(undefined); setLoading(true) }
  const save = async (value:TransactionInput) => {
    setSaving(true); setMutationError(undefined)
    try { if (form?.item) await updateTransaction(form.item.id,value); else await createTransaction(value); setForm(undefined); refreshData() }
    catch (error) { setMutationError(error instanceof Error ? error.message : 'Could not save the transaction.') }
    finally { setSaving(false) }
  }
  const confirmDelete = async () => {
    if (!deleting) return
    setIsDeleting(true); setMutationError(undefined)
    try { await removeTransaction(deleting.id); setDeleting(undefined); refreshData() }
    catch (error) { setMutationError(error instanceof Error ? error.message : 'Could not delete the transaction.') }
    finally { setIsDeleting(false) }
  }
  const changeStatus = async (item:Transaction,status:'confirmed'|'ignored') => {
    if (statusLock.current) return
    statusLock.current = true; setStatusBusy(item.id); setMutationError(undefined)
    try { await updateTransactionStatus(item.id,status); setViewing(undefined); refreshData() }
    catch (error) { setMutationError(error instanceof Error ? error.message : 'Could not update the transaction.'); if (status === 'confirmed') { setViewing(undefined); setForm({mode:'edit',item}) } }
    finally { statusLock.current = false; setStatusBusy(undefined) }
  }
  const edit = (item:Transaction) => { setMutationError(undefined); setForm({mode:'edit',item}) }
  const total = page?.total ?? 0, summary = page?.summary, ready = referenceReady && !referenceError
  return <><PageHeader title="Transactions" eyebrow="Money movement" onMenu={openMenu}/><main className="page-body transactions-page">
    <div className="transaction-intro"><div><h2>Transactions</h2><p>Track and manage your financial activity across every account.</p></div><button className="primary-button" disabled={!ready} onClick={() => { setMutationError(undefined); setForm({mode:'add'}) }}><Plus/><span>Add transaction</span></button></div>
    {(loadError || referenceError) && <div className="api-feedback error" role="alert"><span>{loadError ?? referenceError}{page ? ' Previously loaded data is shown.' : ''}</span><button className="secondary-button" onClick={refreshData}>Try again</button></div>}
    {mutationError && !form && !deleting && <div className="api-feedback error" role="alert"><span>{mutationError}</span></div>}
    {reviewPage && reviewPage.total > 0 && <section className="needs-review panel" aria-label="SMS review queue"><div><h3>Needs review <span className="review-count">{reviewPage.total}</span></h3><p>Check the original SMS and account details before confirming. This queue includes all pending SMS transactions.</p></div><div className="review-list">{pendingSms.map(item => <article key={item.id}><div><strong>{item.description}</strong><small>{formatDate(item.date)} · {item.account} · {item.category}</small></div><strong className="review-amount">{formatMinorCurrency(item.amountMinor!)}</strong><div className="review-actions"><button className="secondary-button" onClick={() => { setMutationError(undefined); setViewing(item) }}>Review SMS</button><button className="secondary-button" disabled={!ready || !!statusBusy} onClick={() => edit(item)}>Edit</button><button className="primary-button" disabled={!ready || !!statusBusy || loading} onClick={() => void changeStatus(item,'confirmed')}>{statusBusy === item.id ? 'Updating…' : 'Confirm'}</button><button className="secondary-button" disabled={!!statusBusy || loading} onClick={() => void changeStatus(item,'ignored')}>Ignore</button></div></article>)}</div><div className="review-pagination"><span>Showing {reviewOffset+1}–{Math.min(reviewOffset+REVIEW_SIZE,reviewPage.total)} of {reviewPage.total}</span><button className="secondary-button" disabled={loading || reviewOffset===0} onClick={() => setReviewOffset(value => Math.max(0,value-REVIEW_SIZE))}>Previous</button><button className="secondary-button" disabled={loading || reviewOffset+REVIEW_SIZE>=reviewPage.total} onClick={() => setReviewOffset(value => value+REVIEW_SIZE)}>Next</button></div></section>}
    {summary && <><section className="transaction-summary" aria-label="Transaction summary"><article><span className="summary-mini-icon income"><ArrowDownLeft/></span><div><p>Income</p><strong>{formatMinorCurrency(summary.incomeMinor)}</strong></div></article><article><span className="summary-mini-icon expense"><ArrowUpRight/></span><div><p>Spending</p><strong>{formatMinorCurrency(summary.expenseMinor)}</strong></div></article><article><span className="summary-mini-icon flow"><ArrowLeftRight/></span><div><p>Net cash flow</p><strong className={summary.netCashFlowMinor >= 0 ? 'positive-text' : 'negative-text'}>{summary.netCashFlowMinor >= 0 ? '+' : '−'}{formatMinorCurrency(summary.netCashFlowMinor)}</strong></div></article><article><span className="summary-mini-icon count"><ListChecks/></span><div><p>Matching records</p><strong>{total}</strong></div></article></section><p className="summary-explanation">Money totals cover all matching confirmed records, across every page. Eligible refunds reduce spending; investments and transfers are excluded. Pending and ignored records affect only the record count.</p></>}
    <section className="transactions-panel panel" aria-busy={loading}><div className="transactions-panel-head"><div><h3>All activity</h3><p role="status">{loading ? 'Loading transactions…' : page ? `${total} ${total === 1 ? 'transaction' : 'transactions'} found` : 'Transactions unavailable'}</p></div></div><TransactionFilters value={filters} onChange={changeFilters} categories={categories} accounts={accounts}/>
      {loading ? <div className="empty-state"><h3>Loading transactions…</h3><p>Your activity will appear in a moment.</p></div> : !page ? <div className="empty-state"><h3>Transactions unavailable</h3><p>Use Try again above to reload your activity.</p></div> : <TransactionTable items={items} onView={item => { setMutationError(undefined); setViewing(item) }} onEdit={edit} onDelete={item => { setMutationError(undefined); setDeleting(item) }} onConfirm={item => void changeStatus(item,'confirmed')} onIgnore={item => void changeStatus(item,'ignored')} statusBusy={!!statusBusy}/>}
      {page && <footer className="table-footer pagination"><span>{total ? `Showing ${offset+1}–${Math.min(offset+PAGE_SIZE,total)} of ${total} transactions` : 'No matching transactions'}</span><div><button disabled={loading || offset===0} onClick={() => { setOffset(value => Math.max(0,value-PAGE_SIZE)); setPage(undefined) }}>Previous</button><button disabled={loading || offset+PAGE_SIZE>=total} onClick={() => { setOffset(value => value+PAGE_SIZE); setPage(undefined) }}>Next</button></div></footer>}
    </section></main>
    {form && <TransactionForm initial={form.item} accounts={accounts} categories={categories} saving={saving} requestError={mutationError} onClose={() => setForm(undefined)} onSave={save}/>}
    {viewing && <TransactionDetails item={viewing} onClose={() => setViewing(undefined)} onEdit={() => { edit(viewing); setViewing(undefined) }} busy={!!statusBusy || loading} onConfirm={() => void changeStatus(viewing,'confirmed')} onIgnore={() => void changeStatus(viewing,'ignored')}/>}
    {deleting && <ConfirmDialog name={deleting.description} busy={isDeleting} error={mutationError} onCancel={() => setDeleting(undefined)} onConfirm={() => void confirmDelete()}/>}
  </>
}
