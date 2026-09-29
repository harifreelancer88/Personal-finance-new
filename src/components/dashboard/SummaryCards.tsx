import { ArrowDownRight, ArrowUpRight, Landmark, PiggyBank, ReceiptText, Wallet } from 'lucide-react'
import { summaryMetrics } from '../../data/mockData'
import { formatCurrency } from '../../lib/format'

const icons = [Wallet, ReceiptText, Landmark, PiggyBank]

export function SummaryCards() {
  return <section className="summary-grid" aria-label="Financial summary">{summaryMetrics.map((metric, index) => {
    const Icon = icons[index]; const ChangeIcon = metric.direction === 'up' ? ArrowUpRight : ArrowDownRight
    return <article className={`summary-card ${index === 0 ? 'featured' : ''}`} key={metric.label}>
      <div className="summary-top"><span className="summary-icon"><Icon /></span><span className={`change ${metric.direction}`}><ChangeIcon size={14}/>{metric.change}</span></div>
      <p>{metric.label}</p><h2>{formatCurrency(metric.value)}</h2><small>Compared with last month</small>
    </article>
  })}</section>
}
