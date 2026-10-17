import { CreditCard, Info, TrendingUp, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { RecordedWorth } from '../../../lib/dashboard-preview'
import { PreviewAmount, previewDate, PreviewState } from './PreviewAmount'

export function PreviewOverview({ worth, loading }: { worth?: RecordedWorth; loading: boolean }) {
  return <section className="dp-overview panel" aria-labelledby="dp-worth-title">
    <div className="dp-overview-main">
      <h2 id="dp-worth-title">Recorded net worth</h2>
      {worth ? <><strong className="dp-worth"><PreviewAmount minor={worth.netWorthMinor} whole /></strong><p>Recorded assets minus liabilities</p><small>Calculated {previewDate(worth.asOf)} · holdings use their own valuation dates</small></> : <PreviewState title="net worth" loading={loading} />}
    </div>
    {worth && <dl className="dp-overview-parts">
      <div><dt><Wallet size={18} /><span>Bank, cash & wallets</span></dt><dd><PreviewAmount minor={worth.cashMinor} whole /></dd><small>Recorded account balances</small></div>
      <div><dt><TrendingUp size={18} /><Link to="/investments">Investments</Link></dt><dd><PreviewAmount minor={worth.investmentsMinor} whole /></dd><small>Latest recorded holding values</small></div>
      <div><dt><CreditCard size={18} /><span>Card debt</span></dt><dd><PreviewAmount minor={worth.cardDebtMinor} whole /></dd><small>Deducted from net worth</small></div>
    </dl>}
    {worth && <details className="dp-worth-details"><summary><Info size={14} /> What is included?</summary><div>
      <p>Latest recorded balances and investment values, including linked investment payments carried at cost. Unrecorded assets or loans are not estimated. Summary figures are rounded to whole rupees.</p>
      {worth.cardCreditMinor > 0 && <p>Also includes credit-card credits of <PreviewAmount minor={worth.cardCreditMinor} />.</p>}
      {worth.awaitingIncludedMinor > 0 && <p>Linked investment payments awaiting credit: <PreviewAmount minor={worth.awaitingIncludedMinor} />. Included at cost, counted once.</p>}
      {worth.awaitingPayrollExcludedMinor > 0 && <p>Salary EPF/NPS deductions awaiting statement confirmation: <PreviewAmount minor={worth.awaitingPayrollExcludedMinor} />. Excluded until reconciled.</p>}
      {worth.unverifiedHoldings > 0 && <p>{worth.unverifiedHoldings} holdings have no explicit valuation date.</p>}
    </div></details>}
  </section>
}
