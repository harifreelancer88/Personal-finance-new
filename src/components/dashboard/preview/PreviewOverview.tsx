import { CreditCard, Info, TrendingUp, Wallet, Landmark } from 'lucide-react'
import type { RecordedWorth } from '../../../lib/dashboard-preview'
import { PreviewAmount, previewDate } from './PreviewAmount'

import { PreviewMetricCard } from './PreviewMetricCard'

export function PreviewOverview({
  worth,
  loading,
}: {
  worth?: RecordedWorth
  loading: boolean
}) {
  return (
    <section className="dp-overview panel" aria-labelledby="dp-worth-title">
      <div className="dp-section-head dp-position-heading">
        <div>
          <h2 id="dp-worth-title">Latest recorded position</h2>
          <span>
            {worth
              ? `Calculated ${previewDate(worth.asOf)} · holdings use their own valuation dates`
              : 'Recorded assets and liabilities'}
          </span>
        </div>
      </div>
      <div className="dp-position-cards">
        <PreviewMetricCard
          title="Recorded net worth"
          minor={worth?.netWorthMinor}
          note="Recorded assets minus liabilities"
          icon={<Landmark size={18} />}
          loading={loading}
          whole
        />
        <PreviewMetricCard
          title="Bank, cash & wallets"
          minor={worth?.cashMinor}
          note="Recorded account balances"
          icon={<Wallet size={18} />}
          to="/accounts"
          loading={loading}
          whole
        />
        <PreviewMetricCard
          title="Investments"
          minor={worth?.investmentsMinor}
          note="Latest recorded holding values"
          icon={<TrendingUp size={18} />}
          to="/investments"
          loading={loading}
          whole
        />
        <PreviewMetricCard
          title="Card debt"
          minor={worth?.cardDebtMinor}
          note="Deducted from net worth"
          icon={<CreditCard size={18} />}
          to="/accounts"
          loading={loading}
          whole
        />
      </div>
      {worth && (
        <details className="dp-worth-details">
          <summary>
            <Info size={14} /> What is included?
          </summary>
          <div>
            <p>
              Latest recorded balances and investment values, including linked
              investment payments carried at cost. Unrecorded assets or loans
              are not estimated. Summary figures are rounded to whole rupees.
            </p>
            {worth.cardCreditMinor > 0 && (
              <p>
                Also includes credit-card credits of{' '}
                <PreviewAmount minor={worth.cardCreditMinor} />.
              </p>
            )}
            {worth.awaitingIncludedMinor > 0 && (
              <p>
                Linked investment payments awaiting credit:{' '}
                <PreviewAmount minor={worth.awaitingIncludedMinor} />. Included
                at cost, counted once.
              </p>
            )}
            {worth.awaitingPayrollExcludedMinor > 0 && (
              <p>
                Salary EPF/NPS deductions awaiting statement confirmation:{' '}
                <PreviewAmount minor={worth.awaitingPayrollExcludedMinor} />.
                Excluded until reconciled.
              </p>
            )}
            {worth.unverifiedHoldings > 0 && (
              <p>
                {worth.unverifiedHoldings} holdings have no explicit valuation
                date.
              </p>
            )}
          </div>
        </details>
      )}
    </section>
  )
}
