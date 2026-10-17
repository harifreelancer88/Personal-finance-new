import { createContext, useContext } from 'react'
import { formatSignedCurrency, formatWholeSignedCurrency } from '../../../lib/format'

export const PreviewPrivacy = createContext(false)

export function PreviewAmount({ minor, whole = false, sign = '' }: { minor: number; whole?: boolean; sign?: string }) {
  const hidden = useContext(PreviewPrivacy)
  // Do not put the original number in title, aria-label, data attributes or
  // hidden markup: hiding amounts must also work for assistive technology.
  if (hidden) return <span className="dp-hidden-amount" aria-label="Amount hidden">••••••</span>
  return <>{sign}{whole ? formatWholeSignedCurrency(minor / 100) : formatSignedCurrency(minor / 100)}</>
}

export function PreviewState({ title, loading }: { title: string; loading: boolean }) {
  return <div className={`dp-empty${loading ? ' dp-loading' : ''}`} role="status">{loading ? `Loading ${title}…` : `${title} unavailable. Refresh to try again.`}</div>
}

export function previewDate(date: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}
