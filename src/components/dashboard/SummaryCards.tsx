import { Landmark, PiggyBank, ReceiptText, Wallet } from 'lucide-react'
import type { DashboardSummary } from '../../api/dashboard'
import { formatMinorCurrency } from '../../lib/format'
const icons = [Wallet, ReceiptText, Landmark, PiggyBank]
export function SummaryCards({ summary }: { summary: DashboardSummary }) {
  const metrics = [{ label:'Balance after card dues', value:summary.totalBalanceMinor, note:'Bank, cash and wallets less card dues' },{ label:'Monthly spending', value:summary.monthlyExpenseMinor, note:'Confirmed expenses less eligible refunds' },{ label:'Monthly income', value:summary.monthlyIncomeMinor, note:'Confirmed income this month' },{ label:'Net cash flow', value:summary.monthlyNetCashFlowMinor, note:'Income less spending; excludes investing and transfers' }]
  return <section className="summary-grid" aria-label="Financial summary">{metrics.map((metric,index)=>{const Icon=icons[index];return <article className={`summary-card ${index===0?'featured':''}`} key={metric.label}><div className="summary-top"><span className="summary-icon"><Icon/></span></div><p>{metric.label}</p><h2 className={metric.value<0?'negative-text':''}>{metric.value<0?'−':''}{formatMinorCurrency(metric.value)}</h2><small>{metric.note}</small></article>})}</section>
}
