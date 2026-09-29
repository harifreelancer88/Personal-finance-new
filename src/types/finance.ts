export type TransactionType = 'Expense' | 'Income' | 'Transfer' | 'Investment' | 'Refund'
export type Category = string
export type AccountType = 'Bank Account' | 'Credit Card' | 'Cash' | 'Wallet / Prepaid'

export interface Account {
  id: string
  name: string
  institution: string
  type: AccountType
  maskedIdentifier: string
  balance: number
  color: 'lime' | 'violet' | 'blue' | 'slate'
  status?: 'Active' | 'Inactive'
  notes?: string
  creditLimit?: number
  billingDate?: number
  dueDate?: number
}

export interface Transaction {
  id: string
  date: string
  description: string
  merchant: string
  category: Category
  account: string
  type: TransactionType
  amount: number
  status: 'Completed' | 'Pending'
  notes?: string
  fromAccount?: string
  toAccount?: string
  amountMinor?: number
  categoryId?: string | null
  fromAccountId?: string | null
  toAccountId?: string | null
  originalTransactionId?: string | null
}

export interface CashFlowPoint {
  month: string
  income: number
  expense: number
}

export type InvestmentType = 'Stocks / Equity' | 'Mutual Funds' | 'Gold' | 'EPF' | 'NPS' | 'Fixed Deposits' | 'Crypto' | 'Other Investments'

export interface Investment {
  id: string
  name: string
  type: InvestmentType
  institution: string
  investedAmount: number
  currentValue: number
  startDate: string
  notes?: string
  quantity?: number
  averagePrice?: number
  currentPrice?: number
  units?: number
  averageNav?: number
  currentNav?: number
  weightGrams?: number
  goldType?: string
  monthlyContribution?: number
  principal?: number
  interestRate?: number
  maturityDate?: string
}

export interface InvestmentActivity {
  id: string
  investmentId?: string
  title: string
  type: 'Contribution' | 'Purchase' | 'Dividend'
  date: string
  amount: number
}

export interface PortfolioPoint {
  label: string
  value: number
}

export interface ReportMonth {
  month: string
  label: string
  income: number
  expenses: number
  categories: Record<string, number>
  accounts: Record<string, number>
  incomeSources: Record<string, number>
}
