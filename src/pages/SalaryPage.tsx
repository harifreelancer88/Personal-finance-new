import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { Menu, RefreshCw, FileText, ChevronRight } from 'lucide-react'
import { getPayrolls, type PayrollRecord } from '../api/payroll'
import { PayrollPanel, payrollMonthLabel } from '../components/payroll/PayrollPanel'
import { RetirementCredits } from '../components/payroll/RetirementCredits'
import { formatDate, formatMinorCurrency } from '../lib/format'

export function SalaryPage() {
  const {openMenu}=useOutletContext<{openMenu:()=>void}>(), [params,setParams]=useSearchParams(),
    [records,setRecords]=useState<PayrollRecord[]>([]), [loading,setLoading]=useState(true), [error,setError]=useState(''), [reload,setReload]=useState(0)
  const selected=params.get('transaction'), current=records.find(p=>p.transactionId===selected)
  const refresh=useCallback(()=>setReload(n=>n+1),[])
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('')
    getPayrolls(controller.signal).then(items=>{if(!controller.signal.aborted)setRecords(items)})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load salary records.')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[reload])
  const active=records.filter(p=>p.transactionStatus!=='ignored'), awaiting=active.flatMap(p=>p.contributions.filter(c=>!c.creditedDate)),
    pendingTotal=awaiting.filter(c=>c.scheme!=='eps').reduce((sum,c)=>sum+c.amountMinor,0)
  return <>
    <header className="activity-header"><button className="activity-menu" onClick={openMenu} aria-label="Open navigation"><Menu/></button><h1>Salary</h1><div className="wealth-header-actions"><button className="wealth-icon" disabled={loading} onClick={refresh} aria-label="Refresh salary"><RefreshCw className={loading?'spinning':''}/></button><Link className="wealth-add" to="/transactions">Link a payslip</Link></div></header>
    <div className="wealth-page payroll-page">
      <p className="payroll-intro">Your full earnings, linked to take-home salary. Payroll periods stay separate from received and budget accounting dates.</p>
      {error?<p className="wealth-error" role="alert">{error} <button onClick={refresh}>Try again</button></p>:loading?<p className="wealth-empty" role="status">Loading salary records…</p>:<>
        <div className="payroll-summary"><div><span>Saved payslips</span><strong>{records.length}</strong></div><div><span>Awaiting retirement credits</span><strong>{formatMinorCurrency(pendingTotal)}</strong><small>{awaiting.length} allocations · pension excluded from value</small></div></div>
        <p className="payroll-caption">Awaiting credits are reconciliation items, excluded from portfolio and cash totals. Ignored bank transactions are excluded from this queue.</p>
        {!records.length?<section className="wealth-panel wealth-empty"><FileText/><h2>Attach your first payslip</h2><p>Open a Money In transaction, choose View, then Add salary breakdown. Use the existing salary receipt so it is counted once.</p><Link className="wealth-add" to="/transactions">Open Transactions</Link></section>:<div className="payroll-layout">
          <section className="wealth-panel payroll-period-list" aria-label="Payslip periods"><h2>Payroll periods</h2>{records.map(p=>{
            const outstanding=p.contributions.filter(c=>!c.creditedDate).length
            return <button key={p.id} className={`payroll-period ${current?.id===p.id?'selected':''}`} onClick={()=>setParams({transaction:p.transactionId})} aria-pressed={current?.id===p.id}>
              <span><strong>{payrollMonthLabel(p.payrollMonth)}</strong><small>{p.employer}</small><small>{p.transactionStatus==='ignored'?'Ignored transaction':`${outstanding} awaiting credits`} · Budget {payrollMonthLabel(p.accountingDate.slice(0,7))}</small></span><span><strong>{formatMinorCurrency(p.netMinor)}</strong><small>Take-home</small><ChevronRight size={16}/></span>
            </button>
          })}</section>
          <div className="payroll-selected">{current?<>
            <div className="payroll-selected-title"><h2>{payrollMonthLabel(current.payrollMonth)}</h2><p>Received {formatDate(`${current.receivedDate}T12:00:00`)} · Budget date {formatDate(`${current.accountingDate}T12:00:00`)}</p></div>
            <PayrollPanel key={`${current.id}:${current.revision}`} transactionId={current.transactionId} amountMinor={current.netMinor} receivedDate={current.receivedDate} accountingDate={current.accountingDate} onChange={refresh}/>
            <RetirementCredits key={`${current.id}:${current.revision}`} record={current} onChange={refresh}/>
          </>:<section className="wealth-panel wealth-empty"><h2>{selected?'Payslip unavailable':'Choose a payslip'}</h2><p>{selected?'This salary breakdown may have been removed. Select an available payroll period.':'Select a payroll period to review its earnings, deductions and retirement credits.'}</p></section>}</div>
        </div>}
      </>}
    </div>
  </>
}
