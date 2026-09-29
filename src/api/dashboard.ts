import { apiRequest } from './client'

export interface DashboardSummary {
  totalBalanceMinor: number
  bankBalanceMinor: number
  cashWalletBalanceMinor: number
  creditCardOutstandingMinor: number
  monthlyIncomeMinor: number
  monthlyExpenseMinor: number
  monthlyNetCashFlowMinor: number
  transactionCount: number
  accountCount: number
}

export interface CashFlowPoint { month: string; incomeMinor: number; expenseMinor: number }

export const getDashboardSummary = () => apiRequest<DashboardSummary>('/api/dashboard/summary')
export const getDashboardCashFlow = () => apiRequest<CashFlowPoint[]>('/api/dashboard/cash-flow')
