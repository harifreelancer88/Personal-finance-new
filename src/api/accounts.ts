import { apiRequest } from './client'
export interface AccountDto { id: string; name: string; institution: string; accountType: 'bank' | 'credit_card' | 'cash' | 'wallet'; isActive: boolean }
export const getAccounts = () => apiRequest<AccountDto[]>('/api/accounts')
