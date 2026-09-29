export interface DashboardAccount {
  account_type: 'bank' | 'credit_card' | 'cash' | 'wallet'
  current_balance_minor: number
}

export interface DashboardTransaction {
  transaction_type: 'expense' | 'income' | 'transfer' | 'investment' | 'refund'
  amount_minor: number
  transaction_date: string
  status: 'pending' | 'confirmed' | 'ignored'
  original_transaction_type?: string | null
  category_kind?: string | null
}

export interface CashFlowPoint { month: string; incomeMinor: number; expenseMinor: number }

const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`

function isExpenseRefund(transaction: DashboardTransaction) {
  return transaction.transaction_type === 'refund' &&
    (transaction.original_transaction_type === 'expense' || transaction.category_kind === 'expense' || transaction.category_kind === 'both')
}

function monthlyTotals(transactions: DashboardTransaction[], month: string) {
  let incomeMinor = 0
  let expenseMinor = 0
  for (const transaction of transactions) {
    if (transaction.status !== 'confirmed' || transaction.transaction_date.slice(0, 7) !== month) continue
    if (transaction.transaction_type === 'income') incomeMinor += transaction.amount_minor
    if (transaction.transaction_type === 'expense') expenseMinor += transaction.amount_minor
    if (isExpenseRefund(transaction)) expenseMinor -= transaction.amount_minor
  }
  return { incomeMinor, expenseMinor: Math.max(0, expenseMinor) }
}

/**
 * Dashboard totals deliberately exclude investments. Available balance is bank + cash +
 * wallet, less the outstanding portion of credit-card balances (negative card balances).
 */
export function calculateDashboard(accounts: DashboardAccount[], transactions: DashboardTransaction[], now: Date) {
  let bankBalanceMinor = 0
  let cashWalletBalanceMinor = 0
  let creditCardOutstandingMinor = 0
  for (const account of accounts) {
    if (account.account_type === 'bank') bankBalanceMinor += account.current_balance_minor
    else if (account.account_type === 'cash' || account.account_type === 'wallet') cashWalletBalanceMinor += account.current_balance_minor
    else creditCardOutstandingMinor += Math.max(0, -account.current_balance_minor)
  }
  const month = monthKey(now)
  const monthly = monthlyTotals(transactions, month)
  return {
    totalBalanceMinor: bankBalanceMinor + cashWalletBalanceMinor - creditCardOutstandingMinor,
    bankBalanceMinor,
    cashWalletBalanceMinor,
    creditCardOutstandingMinor,
    monthlyIncomeMinor: monthly.incomeMinor,
    monthlyExpenseMinor: monthly.expenseMinor,
    monthlyNetCashFlowMinor: monthly.incomeMinor - monthly.expenseMinor,
    transactionCount: transactions.filter(item => item.status === 'confirmed').length,
    accountCount: accounts.length,
  }
}

export function calculateCashFlow(transactions: DashboardTransaction[], now: Date, count = 6): CashFlowPoint[] {
  const points: CashFlowPoint[] = []
  for (let offset = count - 1; offset >= 0; offset--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    const month = monthKey(date)
    points.push({ month, ...monthlyTotals(transactions, month) })
  }
  return points
}
