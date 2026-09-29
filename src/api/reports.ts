import { apiRequest } from './client'

export type ReportPeriod = 'thisMonth' | '3Months' | '6Months' | '1Year' | 'all'
export interface ReportSummary { totalIncomeMinor:number; totalExpenseMinor:number; netCashFlowMinor:number; savingsRatePercent:number|null; transactionCount:number; periodStart:string; periodEnd:string }
export interface CashFlowPoint { month:string; incomeMinor:number; expenseMinor:number }
export interface CategoryBreakdownItem { categoryId:string|null; categoryName:string; amountMinor:number; percentage:number }
export interface AccountBreakdownItem { accountId:string; accountName:string; amountMinor:number; percentage:number }
export interface IncomeBreakdownItem { categoryId:string|null; categoryName:string; amountMinor:number; percentage:number }
export interface TopExpense { id:string; description:string; categoryName:string; accountName:string; transactionDate:string; amountMinor:number }
export interface FinancialInsight { type:string; message:string; value:number }
export interface ReportsData { summary:ReportSummary; cashFlow:CashFlowPoint[]; categories:CategoryBreakdownItem[]; accounts:AccountBreakdownItem[]; income:IncomeBreakdownItem[]; topExpenses:TopExpense[]; insights:FinancialInsight[] }

const query = (period: ReportPeriod, extra = '') => `?period=${period}${extra}`
export async function getReports(period: ReportPeriod): Promise<ReportsData> {
  const [summary,cashFlow,categories,accounts,income,topExpenses,insights]=await Promise.all([
    apiRequest<ReportSummary>(`/api/reports/summary${query(period)}`),
    apiRequest<CashFlowPoint[]>(`/api/reports/cash-flow${query(period)}`),
    apiRequest<CategoryBreakdownItem[]>(`/api/reports/category-breakdown${query(period)}`),
    apiRequest<AccountBreakdownItem[]>(`/api/reports/account-breakdown${query(period)}`),
    apiRequest<IncomeBreakdownItem[]>(`/api/reports/income-breakdown${query(period)}`),
    apiRequest<TopExpense[]>(`/api/reports/top-expenses${query(period,'&limit=10')}`),
    apiRequest<FinancialInsight[]>(`/api/reports/insights${query(period)}`),
  ])
  return {summary,cashFlow,categories,accounts,income,topExpenses,insights}
}
