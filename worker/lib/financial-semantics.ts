/** Shared definition: expense refunds reduce spending; transfers and investments are excluded. */
export function isExpenseRefund(transaction: { transaction_type: string; original_transaction_type?: string | null; category_kind?: string | null }) {
  return transaction.transaction_type === 'refund' &&
    (transaction.original_transaction_type === 'expense' || transaction.category_kind === 'expense' || transaction.category_kind === 'both')
}
