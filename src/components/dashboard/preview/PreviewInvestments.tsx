import { ArrowRight, Clock3, Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Investment } from '../../../types/finance'
import { previewInvestmentGroups, previewValuations, valuationFreshness } from '../../../lib/dashboard-preview'
import { PreviewAmount, previewDate, PreviewState } from './PreviewAmount'

export function PreviewInvestments({ holdings, asOf, loading }: { holdings?: Investment[]; asOf: string; loading: boolean }) {
  const freshness = holdings ? previewValuations(holdings, asOf) : undefined
  return <section className="dp-investments panel" aria-labelledby="dp-investments-title">
    <div className="dp-section-head"><div><h2 id="dp-investments-title">Investments</h2><span>{holdings ? `${holdings.length} holdings · recorded values` : 'Recorded holding values'}</span></div><Link className="dp-text-link" to="/investments" aria-label="View all investments"><ArrowRight size={17} /></Link></div>
    {holdings ? holdings.length ? <>
      <div className="dp-list-heading"><span>Asset class</span><span>Value</span></div>
      {previewInvestmentGroups(holdings).map(group => <Link className="dp-investment-group" to="/investments" key={group.type}><span><strong>{group.type}</strong><small>{group.count} {group.count === 1 ? 'holding' : 'holdings'}</small></span><strong><PreviewAmount minor={group.valueMinor} whole /></strong></Link>)}
      <div className={`dp-valuation-note${freshness && (freshness.undated || freshness.older) ? ' dp-valuation-warning' : ''}`}><Clock3 size={16} /><div><strong>Valuation dates</strong>
        {freshness?.oldest && <p>{freshness.oldest === freshness.latest ? previewDate(freshness.oldest) : `${previewDate(freshness.oldest)} – ${previewDate(freshness.latest!)}`}</p>}
        {!!freshness?.undated && <p>{freshness.undated} {freshness.undated === 1 ? 'holding needs a valuation date' : 'holdings need valuation dates'}.</p>}
        {!!freshness?.older && <p>{freshness.older} {freshness.older === 1 ? 'valuation is' : 'valuations are'} over 90 days old.</p>}
        <Link to="/investments" className="dp-text-link">Review valuations <ArrowRight size={13} /></Link>
      </div></div>
      <details className="dp-holding-dates"><summary>Dates for each holding</summary>{holdings.map(holding => <div className="dp-holding-date" key={holding.id}><span>{holding.name}</span><small>{valuationFreshness(holding.valuationDate, asOf) === 'undated' ? 'Date needed' : previewDate(holding.valuationDate!)}{valuationFreshness(holding.valuationDate, asOf) === 'older' ? ' · over 90 days' : ''}</small></div>)}</details>
      <p className="dp-footnote"><Info size={13} /> These are saved valuations, not live market quotes.</p>
    </> : <div className="dp-empty">No investments recorded yet. <Link to="/investments">Add a holding</Link></div> : <PreviewState title="investments" loading={loading} />}
  </section>
}
