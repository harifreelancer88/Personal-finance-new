import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import {
  activityPreset,
  activityRangeLabel,
  validActivityRange,
  type ActivityRange,
  type ActivityPreset,
} from '../../../lib/dashboard-range'
const presets: { value: ActivityPreset; label: string }[] = [
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'financialYear', label: 'Financial year to date' },
  { value: '3Months', label: 'Last 3 months' },
  { value: '6Months', label: 'Last 6 months' },
]
export function ActivityDateSelector({
  range,
  today,
  onChange,
}: {
  range: ActivityRange
  today: string
  onChange: (range: ActivityRange) => void
}) {
  const [editing, setEditing] = useState(false)
  const [from, setFrom] = useState(range.fromDate),
    [to, setTo] = useState(range.toDate)
  const [error, setError] = useState('')
  const current =
    presets.find((p) => {
      const r = activityPreset(p.value, today)
      return r.fromDate === range.fromDate && r.toDate === range.toDate
    })?.value ?? 'custom'
  return (
    <section
      className="dp-date-selector"
      aria-label="Dashboard activity period"
    >
      <div className="dp-date-heading">
        <CalendarDays size={18} aria-hidden="true" />
        <div>
          <strong>Activity period</strong>
          <span>{activityRangeLabel(range)}</span>
        </div>
      </div>
      <div className="dp-date-actions">
        <label className="dp-sr-only" htmlFor="dp-range-preset">
          Choose activity period
        </label>
        <select
          id="dp-range-preset"
          value={editing ? 'custom' : current}
          onChange={(e) => {
            setError('')
            if (e.target.value === 'custom') {
              setFrom(range.fromDate)
              setTo(range.toDate)
              setEditing(true)
            } else {
              setEditing(false)
              onChange(activityPreset(e.target.value as ActivityPreset, today))
            }
          }}
        >
          {presets.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom dates</option>
        </select>
        {!editing && current === 'custom' && (
          <button
            className="dp-button"
            onClick={() => {
              setFrom(range.fromDate)
              setTo(range.toDate)
              setEditing(true)
            }}
          >
            Edit dates
          </button>
        )}
      </div>
      {editing && (
        <form
          className="dp-date-form"
          onSubmit={(e) => {
            e.preventDefault()
            const next = validActivityRange(from, to)
            if (!next || to > today) {
              setError(
                'Choose valid dates in order, ending today or earlier, within 10 years.',
              )
              return
            }
            onChange(next)
            setEditing(false)
            setError('')
          }}
        >
          <label>
            From
            <input
              type="date"
              min="1900-01-01"
              max={to || today}
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              min={from || '1900-01-01'}
              max={today}
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button className="dp-button dp-primary" type="submit">
            Apply dates
          </button>
          <button
            className="dp-button"
            type="button"
            onClick={() => {
              setEditing(false)
              setError('')
            }}
          >
            Cancel
          </button>
          {error && (
            <p className="dp-date-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      <p>
        Filters activity totals, the chart and recent transactions. Balance
        cards show latest recorded values.
      </p>
    </section>
  )
}
