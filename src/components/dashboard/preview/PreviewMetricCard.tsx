import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PreviewAmount, PreviewState } from './PreviewAmount'
export function PreviewMetricCard({
  title,
  minor,
  note,
  icon,
  to,
  loading,
  whole = false,
  tone = '',
}: {
  title: string
  minor?: number
  note: string
  icon: ReactNode
  to?: string
  loading: boolean
  whole?: boolean
  tone?: string
}) {
  const content = (
    <>
      <div className="dp-stat-heading">
        <span>{title}</span>
        <span aria-hidden="true">{icon}</span>
      </div>
      {minor === undefined ? (
        <PreviewState title={title.toLowerCase()} loading={loading} />
      ) : (
        <strong className={`dp-stat-value ${tone}`}>
          <PreviewAmount minor={minor} whole={whole} />
        </strong>
      )}
      <div className="dp-stat-note">
        <small>{note}</small>
        {to && <ArrowUpRight size={15} aria-hidden="true" />}
      </div>
    </>
  )
  return to ? (
    <Link className="dp-stat-card" to={to}>
      {content}
    </Link>
  ) : (
    <article className="dp-stat-card">{content}</article>
  )
}
