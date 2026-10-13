/** Shared definition: expense refunds reduce spending; transfers and investments are excluded. */
export function isExpenseRefund(transaction: { transaction_type: string; original_transaction_type?: string | null; category_kind?: string | null }) {
  return transaction.transaction_type === 'refund' &&
    (transaction.original_transaction_type === 'expense' || transaction.category_kind === 'expense' || transaction.category_kind === 'both')
}

/** Income is recognised by accounting date; bank balances and SMS matching keep the original date. */
export function effectiveTransactionDate(transaction: { transaction_type: string; transaction_date: string; accounting_date?: string | null }) {
  return transaction.transaction_type === 'income' ? transaction.accounting_date ?? transaction.transaction_date : transaction.transaction_date
}
export const accountingDateSql = "CASE WHEN t.transaction_type='income' THEN COALESCE(t.accounting_date,t.transaction_date) ELSE t.transaction_date END"
