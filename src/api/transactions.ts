import { apiRequest } from './client'

export type ApiTransactionType = 'expense' | 'income' | 'transfer' | 'investment' | 'refund'
export interface TransactionDto { id: string; transactionType: ApiTransactionType; description: string; amountMinor: number; categoryId: string | null; fromAccountId: string | null; toAccountId: string | null; transactionDate: string; notes: string | null; source: 'sms' | 'manual' | string; originalTransactionId: string | null; status: 'pending' | 'confirmed' | 'ignored'; createdAt: string; updatedAt: string }
export interface SmsDetails { sender: string | null; rawText: string; receivedAt: string; parseStatus: string; parseConfidence: number | string | null }
export interface TransactionDetailsDto extends TransactionDto { sms?: SmsDetails | null }
export interface TransactionQuery { search?: string; type?: string; categoryId?: string; accountId?: string; fromDate?: string; toDate?: string; source?: string; status?: string; limit?: number; offset?: number }
export interface TransactionPage { items: TransactionDto[]; total: number; summary: { incomeMinor: number; expenseMinor: number; netCashFlowMinor: number; confirmedCount: number } }
export function getTransactionPage(filters: TransactionQuery, signal?: AbortSignal) {
  const query = new URLSearchParams({ paginated: 'true' })
  for (const [key,value] of Object.entries(filters)) if (value !== undefined && value !== '') query.set(key,String(value))
  return apiRequest<TransactionPage>(`/api/transactions?${query}`, { signal })
}
export interface TransactionInput { transactionType: ApiTransactionType; description: string; amountMinor: number; categoryId: string | null; fromAccountId: string | null; toAccountId: string | null; transactionDate: string; notes: string | null }
export const getTransactions = (filters?: { accountId?: string; limit?: number; status?: TransactionDto['status'] }) => {
  const query = new URLSearchParams()
  if (filters?.accountId) query.set('accountId', filters.accountId)
  if (filters?.limit) query.set('limit', String(filters.limit))
  if (filters?.status) query.set('status', filters.status)
  return apiRequest<TransactionDto[]>(`/api/transactions${query.size ? `?${query}` : ''}`)
}
export const getTransaction = (id: string, signal?: AbortSignal) => apiRequest<TransactionDetailsDto>(`/api/transactions/${encodeURIComponent(id)}`, { signal })
export const createTransaction = (value: TransactionInput) => apiRequest<TransactionDto>('/api/transactions', { method: 'POST', body: JSON.stringify(value) })
export const updateTransaction = (id: string, value: TransactionInput) => apiRequest<TransactionDto>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(value) })
export const updateTransactionStatus = (id: string, status: TransactionDto['status']) => apiRequest<TransactionDto>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) })
export const removeTransaction = (id: string) => apiRequest<{ id: string }>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' })
