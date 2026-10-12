import { ArrowUpRight, ChartNoAxesColumnIncreasing, ShoppingBag } from 'lucide-react'
import type { DashboardSummary } from '../../api/dashboard'
import { formatMinorCurrency } from '../../lib/format'
export function SummaryCards({ summary }: { summary: DashboardSummary }) {
  const metrics = [{label:'Spending',value:summary.monthlyExpenseMinor,icon:ShoppingBag,tone:'spending'},{label:'Income',value:summary.monthlyIncomeMinor,icon:ArrowUpRight,tone:'income'},{label:'Net cash flow',value:summary.monthlyNetCashFlowMinor,icon:ChartNoAxesColumnIncreasing,tone:'flow'}]
  return <section className={`dashboard-summary ${metrics.some(metric=>formatMinorCurrency(metric.value).length+(metric.tone==='flow'&&metric.value!==0?1:0)>=9)?'wide-values':''}`} aria-label="Confirmed monthly totals; eligible refunds reduce spending, transfers and investments are excluded">{metrics.map(({label,value,icon:Icon,tone}) => <article key={label}><span className={`dashboard-metric-icon ${tone}`}><Icon/></span><div><p>{label}</p><strong className={tone === 'flow' ? value < 0 ? 'negative-text' : 'positive-text' : ''}>{value < 0 ? '−' : tone === 'flow' && value > 0 ? '+' : ''}{formatMinorCurrency(value)}</strong></div></article>)}</section>
}
