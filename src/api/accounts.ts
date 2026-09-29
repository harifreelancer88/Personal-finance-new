import { apiRequest } from './client'
export type ApiAccountType = 'bank' | 'credit_card' | 'cash' | 'wallet'
export interface AccountDto { id: string; name: string; institution: string; accountType: ApiAccountType; last4: string | null; openingBalanceMinor: number; openingBalanceDate: string | null; currentBalanceMinor: number; creditLimitMinor: number | null; billingDay: number | null; dueDay: number | null; notes: string | null; isActive: boolean; createdAt: string; updatedAt: string }
export interface AccountInput { name: string; institution: string; accountType: ApiAccountType; last4: string | null; openingBalanceMinor: number; openingBalanceDate: string | null; creditLimitMinor: number | null; billingDay: number | null; dueDay: number | null; notes: string | null; isActive?: boolean }
export const getAccounts = () => apiRequest<AccountDto[]>('/api/accounts')
export const getAccount = (id: string) => apiRequest<AccountDto>(`/api/accounts/${encodeURIComponent(id)}`)
export const createAccount = (value: AccountInput) => apiRequest<AccountDto>('/api/accounts', { method: 'POST', body: JSON.stringify(value) })
export const updateAccount = (id: string, value: AccountInput) => apiRequest<AccountDto>(`/api/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(value) })
export const deleteAccount = (id: string) => apiRequest<{ id: string }>(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' })
