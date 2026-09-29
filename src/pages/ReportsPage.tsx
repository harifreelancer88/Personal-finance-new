import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { AccountBreakdown, CategoryBreakdown, IncomeBreakdown } from '../components/reports/Breakdowns'
import { CashFlowReport } from '../components/reports/CashFlowReport'
import { FinancialInsights } from '../components/reports/FinancialInsights'
import { PeriodSelector, type ReportPeriod } from '../components/reports/PeriodSelector'
import { ReportSummary } from '../components/reports/ReportSummary'
import { SpendingTrend } from '../components/reports/SpendingTrend'
import { TopExpenses } from '../components/reports/TopExpenses'
import { PageHeader } from '../components/layout/PageHeader'
import { reportHistory } from '../data/mockData'
const periodMonths:Record<ReportPeriod,number>={'This Month':1,'3 Months':3,'6 Months':6,'1 Year':12,All:reportHistory.length}
const merge=(items:Record<string,number>[])=>items.reduce<Record<string,number>>((all,item)=>{Object.entries(item).forEach(([key,value])=>all[key]=(all[key]??0)+value);return all},{})
export function ReportsPage(){const {openMenu}=useOutletContext<{openMenu:()=>void}>(),[period,setPeriod]=useState<ReportPeriod>('6 Months');const data=useMemo(()=>reportHistory.slice(-periodMonths[period]),[period]);const income=data.reduce((s,d)=>s+d.income,0),expenses=data.reduce((s,d)=>s+d.expenses,0),categories=merge(data.map(d=>d.categories)),accounts=merge(data.map(d=>d.accounts)),incomeSources=merge(data.map(d=>d.incomeSources));return <><PageHeader title="Reports" eyebrow="Financial overview" onMenu={openMenu}/><main className="page-body reports-page"><div className="reports-intro"><div><h2>Reports</h2><p>Understand where your money goes and how your finances are changing</p></div><PeriodSelector value={period} onChange={setPeriod}/></div><ReportSummary income={income} expenses={expenses}/><div className="report-grid report-grid-top"><CashFlowReport data={data}/><CategoryBreakdown data={categories}/></div><div className="report-grid report-grid-middle"><SpendingTrend data={data}/><AccountBreakdown data={accounts}/><IncomeBreakdown data={incomeSources}/></div><TopExpenses/><FinancialInsights data={data} categories={categories}/></main></>}
