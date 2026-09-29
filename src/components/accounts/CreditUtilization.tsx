import { formatCurrency } from '../../lib/format'

export function CreditUtilization({ outstanding, limit }: { outstanding: number; limit: number }) {
  const used = Math.abs(outstanding)
  const percentage = Math.min(100, Math.round((used / limit) * 100))
  return <div className="credit-utilization">
    <div><span>Credit utilization</span><strong>{percentage}%</strong></div>
    <div className="utilization-track" role="meter" aria-label="Credit utilization" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percentage}%` }} /></div>
    <div className="credit-values"><span><small>Outstanding</small>{formatCurrency(used)}</span><span><small>Available</small>{formatCurrency(Math.max(0, limit - used))}</span><span><small>Limit</small>{formatCurrency(limit)}</span></div>
  </div>
}
