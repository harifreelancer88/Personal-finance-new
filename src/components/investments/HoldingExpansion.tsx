import { useEffect, useState } from 'react'
import { apiRequest } from '../../api/client'
import type { Investment } from '../../types/finance'
import { formatCurrency, formatDate } from '../../lib/format'
interface Valuation {
  id: string
  valuationDate: string
  valueMinor: number
  investedMinor: number
  basisKind: string
  source: string
}
export function HoldingExpansion({ item }: { item: Investment }) {
  const [history, setHistory] = useState<Valuation[]>(),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    const c = new AbortController()
    setHistory(undefined)
    setError(false)
    void apiRequest<Valuation[]>(
      `/api/investments/${encodeURIComponent(item.id)}/valuations`,
      { signal: c.signal },
    )
      .then((v) => {
        if (!c.signal.aborted) setHistory(v)
      })
      .catch(() => {
        if (!c.signal.aborted) setError(true)
      })
    return () => c.abort()
  }, [item.id, retry])
  const fields: [string, string | number | undefined][] = [
    ['Basis type', (item.basisKind ?? 'recorded').replaceAll('_', ' ')],
    ['Recorded basis', formatCurrency(item.investedAmount)],
    ['Quantity', item.quantity],
    ['Units', item.units],
    ['Weight (grams)', item.weightGrams],
    ['Start date', item.startDate ? formatDate(item.startDate) : undefined],
    [
      'Monthly contribution',
      item.monthlyContribution === undefined
        ? undefined
        : formatCurrency(item.monthlyContribution),
    ],
  ]
  return (
    <div className="holding-expansion">
      <dl>
        {fields
          .filter(([, v]) => v !== undefined)
          .map(([label, v]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {(item.pendingContributionMinor ?? 0) > 0 && (
        <p>
          Includes {formatCurrency(item.pendingContributionMinor! / 100)}{' '}
          awaiting credit, carried at cost.
        </p>
      )}
      {item.notes && (
        <details>
          <summary>Holding notes</summary>
          <p>{item.notes}</p>
        </details>
      )}
      <h4>Valuation history</h4>
      {error ? (
        <p role="alert">
          Could not load history.{' '}
          <button onClick={() => setRetry((n) => n + 1)}>Try again</button>
        </p>
      ) : !history ? (
        <p role="status">Loading valuation history…</p>
      ) : history.length ? (
        <>
          <ol>
            {history.slice(0, 5).map((v) => (
              <li key={v.id}>
                <strong>
                  {formatDate(v.valuationDate)} ·{' '}
                  {formatCurrency(v.valueMinor / 100)}
                </strong>
                <small>
                  {v.source} · Basis {formatCurrency(v.investedMinor / 100)}
                </small>
              </li>
            ))}
          </ol>
          {history.length > 5 && (
            <details>
              <summary>{history.length - 5} earlier valuations</summary>
              <ol>
                {history.slice(5).map((v) => (
                  <li key={v.id}>
                    {formatDate(v.valuationDate)} ·{' '}
                    {formatCurrency(v.valueMinor / 100)}
                    <small>{v.source}</small>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      ) : (
        <p>No dated valuation history yet. Earlier values are unknown.</p>
      )}
    </div>
  )
}
