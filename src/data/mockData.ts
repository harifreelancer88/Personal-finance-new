import type { Account, CashFlowPoint, Transaction } from '../types/finance'

export const accounts: Account[] = [
  { id: 'hdfc', name: 'HDFC Bank', kind: 'Savings', maskedIdentifier: '•• 2847', balance: 184250, color: 'lime' },
  { id: 'icici', name: 'ICICI Bank', kind: 'Current', maskedIdentifier: '•• 6192', balance: 96400, color: 'violet' },
  { id: 'sbi', name: 'SBI Bank', kind: 'Savings', maskedIdentifier: '•• 3701', balance: 67850, color: 'blue' },
  { id: 'hdfc-card', name: 'HDFC Credit Card', kind: 'Credit Card', maskedIdentifier: '•• 9438', balance: -18420, color: 'slate' },
]

export const transactions: Transaction[] = [
  { id: 'TXN-94281', date: '2026-09-28T18:42:00', description: 'Amazon India', merchant: 'Online shopping', category: 'Shopping', account: 'HDFC Bank', type: 'Expense', amount: -3299, status: 'Completed' },
  { id: 'TXN-94280', date: '2026-09-27T20:15:00', description: 'Swiggy', merchant: 'Dinner order', category: 'Food', account: 'ICICI Bank', type: 'Expense', amount: -684, status: 'Completed' },
  { id: 'TXN-94279', date: '2026-09-27T08:10:00', description: 'Indian Oil', merchant: 'Petrol', category: 'Transport', account: 'HDFC Credit Card', type: 'Expense', amount: -2500, status: 'Completed' },
  { id: 'TXN-94278', date: '2026-09-26T10:00:00', description: 'Monthly Salary', merchant: 'Acme Technologies Pvt Ltd', category: 'Salary', account: 'HDFC Bank', type: 'Income', amount: 125000, status: 'Completed' },
  { id: 'TXN-94277', date: '2026-09-25T12:35:00', description: 'BESCOM', merchant: 'Electricity bill', category: 'Utilities', account: 'SBI Bank', type: 'Expense', amount: -1870, status: 'Completed' },
  { id: 'TXN-94276', date: '2026-09-23T09:30:00', description: 'Monthly SIP', merchant: 'Nifty 50 Index Fund', category: 'Investments', account: 'HDFC Bank', type: 'Investment', amount: -10000, status: 'Completed' },
  { id: 'TXN-94275', date: '2026-09-21T16:20:00', description: 'Credit Card Payment', merchant: 'Self transfer', category: 'Transfer', account: 'HDFC Bank → HDFC Credit Card', type: 'Transfer', amount: 15000, status: 'Completed', fromAccount: 'HDFC Bank', toAccount: 'HDFC Credit Card', notes: 'September card payment' },
  { id: 'TXN-94274', date: '2026-09-19T14:05:00', description: 'House Rent', merchant: 'Rent payment', category: 'Housing', account: 'HDFC Bank', type: 'Expense', amount: -28000, status: 'Pending' },
  { id: 'TXN-94273', date: '2026-09-18T18:15:00', description: 'Zerodha Investment', merchant: 'Equity investment', category: 'Investments', account: 'HDFC Bank', type: 'Investment', amount: -7500, status: 'Completed' },
  { id: 'TXN-94272', date: '2026-09-16T19:40:00', description: 'Grocery', merchant: 'Nature’s Basket', category: 'Groceries', account: 'HDFC Credit Card', type: 'Expense', amount: -4280, status: 'Completed' },
  { id: 'TXN-94271', date: '2026-09-14T11:10:00', description: 'School Fees', merchant: 'Greenwood High', category: 'Education', account: 'ICICI Bank', type: 'Expense', amount: -18500, status: 'Completed' },
  { id: 'TXN-94270', date: '2026-09-12T15:25:00', description: 'UPI transfer', merchant: 'To Rohan Mehta', category: 'Transfer', account: 'SBI Bank → ICICI Bank', type: 'Transfer', amount: 5000, status: 'Completed', fromAccount: 'SBI Bank', toAccount: 'ICICI Bank' },
  { id: 'TXN-94269', date: '2026-09-10T13:20:00', description: 'Amazon Refund', merchant: 'Order refund', category: 'Refund', account: 'HDFC Credit Card', type: 'Refund', amount: 1299, status: 'Completed' },
]

export const cashFlow: CashFlowPoint[] = [
  { month: 'Apr', income: 112000, expense: 69000 }, { month: 'May', income: 118000, expense: 76000 },
  { month: 'Jun', income: 116000, expense: 64000 }, { month: 'Jul', income: 124000, expense: 81000 },
  { month: 'Aug', income: 121000, expense: 71000 }, { month: 'Sep', income: 140000, expense: 78540 },
]

export const summaryMetrics = [
  { label: 'Total Balance', value: 330080, change: '+8.2%', direction: 'up' as const },
  { label: 'Monthly Spending', value: 78540, change: '-3.4%', direction: 'down' as const },
  { label: 'Monthly Income', value: 140000, change: '+12.5%', direction: 'up' as const },
  { label: 'Net Worth', value: 842600, change: '+6.8%', direction: 'up' as const },
]
