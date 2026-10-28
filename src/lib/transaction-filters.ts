import type { TransactionType } from '../types/finance'
export type FilterState = {
  search: string
  type: 'All' | TransactionType
  category: string
  account: string
  range: 'All' | '7' | '30' | '90'
  source: 'All' | 'SMS' | 'Manual' | 'Import'
  status: 'All' | 'Pending' | 'Confirmed' | 'Ignored'
}
export const emptyFilters: FilterState = {
  search: '',
  type: 'All',
  category: 'All',
  account: 'All',
  range: 'All',
  source: 'All',
  status: 'All',
}
const title = (value: string) => value[0].toUpperCase() + value.slice(1)
export function readTransactionFilters(params: URLSearchParams): FilterState {
  const type = params.get('type') ?? '',
    source = params.get('source') ?? '',
    status = params.get('status') ?? ''
  return {
    ...emptyFilters,
    search: params.get('search') ?? '',
    type: ['expense', 'income', 'transfer', 'investment', 'refund'].includes(
      type,
    )
      ? (title(type) as FilterState['type'])
      : 'All',
    category: params.get('categoryId') || 'All',
    account: params.get('accountId') || 'All',
    source: ['sms', 'manual', 'import'].includes(source)
      ? ((source === 'sms' ? 'SMS' : title(source)) as FilterState['source'])
      : 'All',
    status: ['pending', 'confirmed', 'ignored'].includes(status)
      ? (title(status) as FilterState['status'])
      : 'All',
  }
}
export function writeTransactionFilters(
  params: URLSearchParams,
  filters: FilterState,
) {
  const next = new URLSearchParams(params)
  for (const key of [
    'search',
    'type',
    'categoryId',
    'accountId',
    'source',
    'status',
  ])
    next.delete(key)
  if (filters.search) next.set('search', filters.search)
  for (const key of ['type', 'source', 'status'] as const)
    if (filters[key] !== 'All') next.set(key, filters[key].toLowerCase())
  if (filters.category !== 'All') next.set('categoryId', filters.category)
  if (filters.account !== 'All') next.set('accountId', filters.account)
  return next
}
