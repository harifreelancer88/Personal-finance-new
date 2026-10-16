export interface Allocation {
  categoryId: string | null
  categoryName: string
  amountMinor: number
}
export interface SplitRow {
  transaction_id: string
  category_id: string
  category_name: string
  amount_minor: number
}
export function allocations(
  t: {
    id: string
    amount_minor: number
    category_id: string | null
    category_name: string | null
  },
  splits: SplitRow[],
): Allocation[] {
  const children = splits.filter((s) => s.transaction_id === t.id),
    used = children.reduce((n, s) => n + s.amount_minor, 0)
  return [
    {
      categoryId: t.category_id,
      categoryName: t.category_name ?? 'Uncategorized',
      amountMinor: t.amount_minor - used,
    },
    ...children.map((s) => ({
      categoryId: s.category_id,
      categoryName: s.category_name,
      amountMinor: s.amount_minor,
    })),
  ].filter((a) => a.amountMinor > 0)
}
// Allocate a whole-payment refund in exact paise; a category-specific refund targets that category.
export function refundAllocations(
  amount: number,
  original: Allocation[],
  categoryId: string | null,
): Allocation[] {
  const target = original.find((a) => a.categoryId === categoryId)
  if (target && categoryId) return [{ ...target, amountMinor: -amount }]
  const total = original.reduce((n, a) => n + a.amountMinor, 0)
  if (!total) return []
  let left = amount
  return original.map((a, i) => {
    const value =
      i === original.length - 1
        ? left
        : Number((BigInt(amount) * BigInt(a.amountMinor)) / BigInt(total))
    left -= value
    return { ...a, amountMinor: -value }
  })
}
