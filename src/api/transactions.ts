import { apiRequest } from './client'

export type ApiTransactionType = 'expense' | 'income' | 'transfer' | 'investment' | 'refund'
export interface TransactionDto { id: string; transactionType: ApiTransactionType; description: string; amountMinor: number; categoryId: string | null; fromAccountId: string | null; toAccountId: string | null; transactionDate: string; notes: string | null; source: 'sms' | 'manual' | string; originalTransactionId: string | null; status: 'pending' | 'confirmed' | 'ignored'; createdAt: string; updatedAt: string }
export interface TransactionInput { transactionType: ApiTransactionType; description: string; amountMinor: number; categoryId: string | null; fromAccountId: string | null; toAccountId: string | null; transactionDate: string; notes: string | null }
export const getTransactions = (filters?: { accountId?: string; limit?: number; status?: TransactionDto['status'] }) => {
  const query = new URLSearchParams()
  if (filters?.accountId) query.set('accountId', filters.accountId)
  if (filters?.limit) query.set('limit', String(filters.limit))
  if (filters?.status) query.set('status', filters.status)
  return apiRequest<TransactionDto[]>(`/api/transactions${query.size ? `?${query}` : ''}`)
}
export const getTransaction = (id: string) => apiRequest<TransactionDto>(`/api/transactions/${encodeURIComponent(id)}`)
export const createTransaction = (value: TransactionInput) => apiRequest<TransactionDto>('/api/transactions', { method: 'POST', body: JSON.stringify(value) })
export const updateTransaction = (id: string, value: TransactionInput) => apiRequest<TransactionDto>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(value) })
export const updateTransactionStatus = (id: string, status: TransactionDto['status']) => apiRequest<TransactionDto>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) })
export const removeTransaction = (id: string) => apiRequest<{ id: string }>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' })
