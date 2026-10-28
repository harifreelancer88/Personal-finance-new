import { X } from 'lucide-react'
export interface FilterChip {
  key: string
  label: string
  remove: () => void
}
export function FilterChips({
  chips,
  clear,
  hint,
}: {
  chips: FilterChip[]
  clear: () => void
  hint?: string
}) {
  if (!chips.length) return null
  return (
    <div className="active-filter-bar">
      <ul className="active-filter-chips" aria-label="Active filters">
        {chips.map((chip) => (
          <li key={chip.key}>
            <button
              type="button"
              aria-label={`Remove ${chip.label} filter`}
              onClick={chip.remove}
            >
              <span>{chip.label}</span>
              <X size={13} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="clear-filters" onClick={clear}>
        Clear filters
      </button>
      {hint && <small>{hint}</small>}
    </div>
  )
}
