export type TransactionType = 'Expense' | 'Income' | 'Transfer' | 'Investment' | 'Refund'
export type Category = 'Shopping' | 'Food' | 'Transport' | 'Salary' | 'Utilities' | 'Transfer' | 'Investments' | 'Housing' | 'Groceries' | 'Education' | 'Refund' | 'Other'
export type AccountKind = 'Savings' | 'Current' | 'Credit Card' | 'Investment'

export interface Account {
  id: string
  name: string
  kind: AccountKind
  maskedIdentifier: string
  balance: number
  color: 'lime' | 'violet' | 'blue' | 'slate'
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
