import { Menu, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { getReports, type ReportPeriod, type ReportsData } from '../api/reports'
import { AccountBreakdown, CategoryBreakdown, IncomeBreakdown } from '../components/reports/Breakdowns'
import { CashFlowReport } from '../components/reports/CashFlowReport'
import { FinancialInsights } from '../components/reports/FinancialInsights'
import { PeriodSelector } from '../components/reports/PeriodSelector'
import { ReportSummary } from '../components/reports/ReportSummary'
import { SpendingTrend } from '../components/reports/SpendingTrend'
import { TopExpenses } from '../components/reports/TopExpenses'
import { CashFlowChart } from '../components/dashboard/CashFlowChart'
import { formatDate } from '../lib/format'
type View='cash'|'spending'|'income'
const tabs:{value:View;label:string}[]=[{value:'cash',label:'Cash flow'},{value:'spending',label:'Spending'},{value:'income',label:'Income'}]
export function ReportsPage() {
 const {openMenu}=useOutletContext<{openMenu:()=>void}>()
 const [period,setPeriod]=useState<ReportPeriod>('thisMonth'),[view,setView]=useState<View>('cash'),[data,setData]=useState<ReportsData>(),[loading,setLoading]=useState(true),[error,setError]=useState<string>()
 const controller=useRef<AbortController>(undefined)
 const load=useCallback(async()=>{controller.current?.abort();const current=new AbortController();controller.current=current;setLoading(true);try{const next=await getReports(period,current.signal);if(!current.signal.aborted){setData(next);setError(undefined)}}catch(cause){if(!current.signal.aborted)setError(cause instanceof Error?cause.message:'Could not load reports.')}finally{if(!current.signal.aborted)setLoading(false)}},[period])
 useEffect(()=>{void load();return()=>controller.current?.abort()},[load])
 const changePeriod=(next:ReportPeriod)=>{if(next===period)return;controller.current?.abort();setData(undefined);setError(undefined);setLoading(true);setPeriod(next)}
 return <><header className="activity-header"><button className="icon-button activity-menu" onClick={openMenu} aria-label="Open navigation"><Menu/></button><h1>Reports</h1><button className="icon-button reports-refresh" onClick={()=>void load()} disabled={loading} aria-label="Refresh reports"><RefreshCw/></button></header><div className="page-body reports-page"><div className="report-toolbar"><div className="activity-tabs" role="tablist" aria-label="Report views" onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const index=tabs.findIndex(tab=>tab.value===view);const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;setView(tabs[next].value);document.getElementById(`report-tab-${tabs[next].value}`)?.focus()}}}>{tabs.map(tab=><button key={tab.value} id={`report-tab-${tab.value}`} role="tab" aria-selected={view===tab.value} tabIndex={view===tab.value?0:-1} aria-controls="report-content" onClick={()=>setView(tab.value)}>{tab.label}</button>)}</div><PeriodSelector value={period} onChange={changePeriod}/></div>
 {error&&<div className="api-feedback error" role="alert"><span>{error}{data?' Previously loaded figures for this period are shown.':''}</span><button className="secondary-button" onClick={()=>void load()}>Try again</button></div>}
 {loading&&<p className="reports-status" role="status">{data?'Refreshing report…':'Loading reports…'}</p>}
 {data&&<><p className="report-date-range">{formatDate(`${data.summary.periodStart}T12:00:00`)} – {formatDate(`${data.summary.periodEnd}T12:00:00`)}</p><ReportSummary summary={data.summary}/><div id="report-content" role="tabpanel" aria-labelledby={`report-tab-${view}`} aria-busy={loading}>
 {view==='cash'&&<div className="reports-main-grid"><CashFlowReport data={data.cashFlow}/><CategoryBreakdown data={data.categories}/></div>}
 {view==='spending'&&<><div className="reports-main-grid"><SpendingTrend data={data.cashFlow}/><CategoryBreakdown data={data.categories}/></div><AccountBreakdown data={data.accounts}/><TopExpenses expenses={data.topExpenses}/></>}
 {view==='income'&&<div className="reports-main-grid"><CashFlowChart points={data.cashFlow} showPeriodControls={false} series="income" title="Income by month"/><IncomeBreakdown data={data.income}/></div>}
 <FinancialInsights insights={data.insights}/></div><p className="report-footnote">Confirmed activity only. Eligible refunds reduce spending; transfers and investments are excluded.</p></>}
 {!loading&&!data&&error&&<section className="panel empty-state"><h2>Reports unavailable</h2><p>Try again to load the selected period.</p></section>}
 </div></>
}
