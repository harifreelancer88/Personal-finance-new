import { Landmark, PiggyBank, ReceiptText, Wallet } from 'lucide-react'
import type { DashboardSummary } from '../../api/dashboard'
import { formatMinorCurrency } from '../../lib/format'
const icons = [Wallet, ReceiptText, Landmark, PiggyBank]
export function SummaryCards({ summary }: { summary: DashboardSummary }) {
  const metrics = [{ label:'Total Balance', value:summary.totalBalanceMinor, note:'Available after card liabilities' },{ label:'Monthly Spending', value:summary.monthlyExpenseMinor, note:'Confirmed expenses this month' },{ label:'Monthly Income', value:summary.monthlyIncomeMinor, note:'Confirmed income this month' },{ label:'Net Cash Flow', value:summary.monthlyNetCashFlowMinor, note:'Income less spending this month' }]
  return <section className="summary-grid" aria-label="Financial summary">{metrics.map((metric,index)=>{const Icon=icons[index];return <article className={`summary-card ${index===0?'featured':''}`} key={metric.label}><div className="summary-top"><span className="summary-icon"><Icon/></span></div><p>{metric.label}</p><h2 className={metric.value<0?'negative-text':''}>{metric.value<0?'−':''}{formatMinorCurrency(metric.value)}</h2><small>{metric.note}</small></article>})}</section>
}
