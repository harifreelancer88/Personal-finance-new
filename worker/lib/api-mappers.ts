import type { AccountRow, CategoryRow, InvestmentRow, TransactionRow } from '../types'

export function accountToApi(row: AccountRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    institution: row.institution,
    accountType: row.account_type,
    last4: row.last4,
    openingBalanceMinor: row.opening_balance_minor,
    openingBalanceDate: row.opening_balance_date,
    creditLimitMinor: row.credit_limit_minor,
    billingDay: row.billing_day,
    dueDay: row.due_day,
    notes: row.notes,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function categoryToApi(row: CategoryRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    kind: row.kind,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function transactionToApi(row: TransactionRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    transactionType: row.transaction_type,
    description: row.description,
    amountMinor: row.amount_minor,
    categoryId: row.category_id,
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    transactionDate: row.transaction_date,
    notes: row.notes,
    source: row.source,
    externalId: row.external_id,
    originalTransactionId: row.original_transaction_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function investmentToApi(row: InvestmentRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    investmentType: row.investment_type,
    name: row.name,
    institution: row.institution,
    investedMinor: row.invested_minor,
    currentValueMinor: row.current_value_minor,
    startDate: row.start_date,
    notes: row.notes,
    quantity: row.quantity,
    averageCostMinor: row.average_cost_minor,
    currentPriceMinor: row.current_price_minor,
    units: row.units,
    averageNavMinor: row.average_nav_minor,
    currentNavMinor: row.current_nav_minor,
    weightGrams: row.weight_grams,
    monthlyContributionMinor: row.monthly_contribution_minor,
    interestRate: row.interest_rate,
    maturityDate: row.maturity_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
