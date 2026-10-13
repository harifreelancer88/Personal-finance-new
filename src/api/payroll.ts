import { apiRequest } from './client'
import type { PayrollInput,PayrollRecord,RetirementContribution,ContributionMatch } from '../../shared/payroll'
export type { PayrollInput,PayrollRecord,RetirementContribution,ContributionMatch } from '../../shared/payroll'

export const getPayrolls = (signal?: AbortSignal) => apiRequest<PayrollRecord[]>('/api/payroll', { signal })
export const getPayroll = (transactionId: string, signal?: AbortSignal) => apiRequest<PayrollRecord | null>(`/api/payroll/transactions/${encodeURIComponent(transactionId)}`, { signal })
export const savePayroll = (transactionId: string, value: PayrollInput) => apiRequest<PayrollRecord>(`/api/payroll/transactions/${encodeURIComponent(transactionId)}`, { method: 'PUT', body: JSON.stringify(value) })
export const deletePayroll = (transactionId: string, expectedRevision: number) => apiRequest(`/api/payroll/transactions/${encodeURIComponent(transactionId)}`, { method: 'DELETE', body: JSON.stringify({ expectedRevision }) })
export const matchContribution = (id: string, value: ContributionMatch | { reset: true; expectedRevision: number }) => apiRequest<RetirementContribution>(`/api/payroll/contributions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(value) })
export const removeEmployerContribution = (id: string, expectedRevision: number) => apiRequest(`/api/payroll/contributions/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({expectedRevision}) })
export const addEmployerContribution = (transactionId: string, value: { scheme: 'epf' | 'nps' | 'eps'; amountMinor: number; expectedRevision: number }) => apiRequest<PayrollRecord>(`/api/payroll/transactions/${encodeURIComponent(transactionId)}/employer`, { method: 'POST', body: JSON.stringify(value) })
