export type TransactionType = 'Expense' | 'Income' | 'Transfer' | 'Investment' | 'Refund'
export type Category = 'Shopping' | 'Food' | 'Transport' | 'Salary' | 'Utilities' | 'Transfer' | 'Investments' | 'Housing' | 'Groceries' | 'Education' | 'Refund' | 'Other'
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
}

export interface CashFlowPoint {
  month: string
  income: number
  expense: number
}
