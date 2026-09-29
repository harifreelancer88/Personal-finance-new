import type { TransactionType } from '../../types/finance'

export function TypeBadge({ type }: { type: TransactionType }) { return <span className={`type-badge ${type.toLowerCase()}`}>{type}</span> }
