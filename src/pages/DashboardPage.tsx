import { NetWorth } from '../components/dashboard/NetWorth'
import { ClipboardList, Menu, Plus, RefreshCw, ArrowRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { getAccounts, type AccountDto } from '../api/accounts'
import { getDashboardCashFlow, getDashboardSummary, type CashFlowPoint, type DashboardSummary } from '../api/dashboard'
import { getTransactionPage, getTransactions, type TransactionDto } from '../api/transactions'
import { AccountsPanel } from '../components/dashboard/AccountsPanel'
import { CashFlowChart } from '../components/dashboard/CashFlowChart'
import { RecentTransactions } from '../components/dashboard/RecentTransactions'
import { SummaryCards } from '../components/dashboard/SummaryCards'
interface DashboardData { summary:DashboardSummary; cashFlow:CashFlowPoint[]; accounts:AccountDto[]; transactions:TransactionDto[]; reviewCount:number }
const titles:Record<keyof DashboardData,string>={summary:'Monthly totals',cashFlow:'Cash flow',accounts:'Accounts',transactions:'Recent transactions',reviewCount:'SMS review status'}
function PanelState({title,loading}:{title:string;loading:boolean}) {return <section className="panel dashboard-empty" role="status"><h2>{loading?`Loading ${title.toLowerCase()}…`:`${title} unavailable`}</h2><p>{loading?'Your recorded activity will appear in a moment.':'Use Try again above to reload this section.'}</p></section>}
export function DashboardPage() {
  const {openMenu}=useOutletContext<{openMenu:()=>void}>()
  const [data,setData]=useState<Partial<DashboardData>>({})
  const [loading,setLoading]=useState(true)
  const [errors,setErrors]=useState<Partial<Record<keyof DashboardData,string>>>({})
  const version=useRef(0)
  const load=useCallback(async()=>{
    const current=++version.current;setLoading(true)
    const [summary,cashFlow,accounts,transactions,review]=await Promise.allSettled([getDashboardSummary(),getDashboardCashFlow(),getAccounts(),getTransactions({limit:5,status:'confirmed'}),getTransactionPage({source:'sms',status:'pending',limit:1,offset:0})])
    if(current!==version.current)return
    setData(previous=>({...previous,...(summary.status==='fulfilled'?{summary:summary.value}:{}),...(cashFlow.status==='fulfilled'?{cashFlow:cashFlow.value}:{}),...(accounts.status==='fulfilled'?{accounts:accounts.value}:{}),...(transactions.status==='fulfilled'?{transactions:transactions.value}:{}),...(review.status==='fulfilled'?{reviewCount:review.value.total}:{})}))
    const next:Partial<Record<keyof DashboardData,string>>={}
    for(const [key,result] of [['summary',summary],['cashFlow',cashFlow],['accounts',accounts],['transactions',transactions],['reviewCount',review]] as const)if(result.status==='rejected')next[key]=result.reason instanceof Error?result.reason.message:'Could not load this section.'
    setErrors(next);setLoading(false)
  },[])
  useEffect(()=>{void load();return()=>{version.current++}},[load])
  const latestMonth=data.cashFlow?.at(-1)?.month
  const month=new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}).format(latestMonth?new Date(`${latestMonth}-01T00:00:00Z`):new Date())
  const failed=Object.keys(errors) as (keyof DashboardData)[]
  return <><header className="activity-header"><button className="icon-button activity-menu" onClick={openMenu} aria-label="Open navigation"><Menu/></button><h1>Dashboard</h1><button className="icon-button activity-refresh" onClick={()=>void load()} disabled={loading} aria-label="Refresh dashboard"><RefreshCw/></button><Link className="primary-button activity-add" to="/transactions?new=1" aria-label="Add transaction"><Plus/><span>Add transaction</span></Link></header><div className="page-body dashboard-page"><p className="dashboard-period">{month}</p>{failed.length>0&&<div className="api-feedback error" role="alert"><span>Could not load {failed.map(key=>titles[key].toLowerCase()).join(', ')}. Previously loaded figures remain visible where available.</span><button className="secondary-button" onClick={()=>void load()} disabled={loading}>Try again</button></div>}
    {data.summary?<SummaryCards summary={data.summary}/>:<PanelState title="Monthly totals" loading={loading}/>}
    <NetWorth refreshKey={loading?0:version.current}/>
    {data.reviewCount!==undefined&&data.reviewCount>0&&<div className="dashboard-review-banner"><ClipboardList/><span>{data.reviewCount} {data.reviewCount===1?'transaction needs':'transactions need'} review</span><Link to="/transactions?tab=review">Review <ArrowRight/></Link></div>}
    <div className="dashboard-content"><div className="dashboard-primary-column">{data.cashFlow?<CashFlowChart points={data.cashFlow}/>:<PanelState title="Cash flow" loading={loading}/>} {data.transactions?<RecentTransactions transactions={data.transactions} accounts={data.accounts??[]}/>:<PanelState title="Recent transactions" loading={loading}/>}</div><div className="dashboard-secondary-column">{data.accounts?<AccountsPanel accounts={data.accounts}/>:<PanelState title="Accounts" loading={loading}/>}</div></div>
  </div></>
}
