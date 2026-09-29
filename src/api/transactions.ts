import { apiRequest } from './client'

export type ApiTransactionType = 'expense' | 'income' | 'transfer' | 'investment' | 'refund'
export interface TransactionDto { id: string; transactionType: ApiTransactionType; description: string; amountMinor: number; categoryId: string | null; fromAccountId: string | null; toAccountId: string | null; transactionDate: string; notes: string | null; source: string; originalTransactionId: string | null; status: 'pending' | 'confirmed' | 'ignored'; createdAt: string; updatedAt: string }
export interface TransactionInput { transactionType: ApiTransactionType; description: string; amountMinor: number; categoryId: string | null; fromAccountId: string | null; toAccountId: string | null; transactionDate: string; notes: string | null }
export const getTransactions = () => apiRequest<TransactionDto[]>('/api/transactions')
export const getTransaction = (id: string) => apiRequest<TransactionDto>(`/api/transactions/${encodeURIComponent(id)}`)
export const createTransaction = (value: TransactionInput) => apiRequest<TransactionDto>('/api/transactions', { method: 'POST', body: JSON.stringify(value) })
export const updateTransaction = (id: string, value: TransactionInput) => apiRequest<TransactionDto>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(value) })
export const removeTransaction = (id: string) => apiRequest<{ id: string }>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' })
