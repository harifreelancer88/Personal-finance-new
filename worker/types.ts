export interface Env {
  ASSETS: Fetcher
  DB: D1Database
  DEFAULT_WORKSPACE_ID: string
  SMS_INGEST_TOKEN?: string
}

export interface SmsMessageRow {
  id: string; workspace_id: string; external_id: string | null; dedupe_key: string
  sender: string | null; raw_text: string; received_at: string; parse_status: string
  parse_confidence: number | null; parse_notes: string | null; parsed_transaction_type: string | null
  parsed_amount_minor: number | null; parsed_description: string | null; parsed_transaction_date: string | null
  parsed_account_last4: string | null; bank_reference: string | null; transaction_id: string | null; created_at: string; updated_at: string
}

export interface AccountRow {
  id: string
  workspace_id: string
  name: string
  institution: string
  account_type: 'bank' | 'credit_card' | 'cash' | 'wallet'
  last4: string | null
  opening_balance_minor: number
  opening_balance_date: string | null
  credit_limit_minor: number | null
  billing_day: number | null
  due_day: number | null
  notes: string | null
  is_active: number
  created_at: string
  updated_at: string
}

export interface CategoryRow {
  id: string
  workspace_id: string
  name: string
  kind: 'expense' | 'income' | 'both'
  is_active: number
  created_at: string
  updated_at: string
}

export interface TransactionRow {
  id: string
  workspace_id: string
  transaction_type: 'expense' | 'income' | 'transfer' | 'investment' | 'refund'
  description: string
  amount_minor: number
  category_id: string | null
  from_account_id: string | null
  to_account_id: string | null
  transaction_date: string
  notes: string | null
  source: string
  external_id: string | null
  original_transaction_id: string | null
  status: 'pending' | 'confirmed' | 'ignored'
  created_at: string
  updated_at: string
}

export interface InvestmentRow {
  id: string
  workspace_id: string
  investment_type: 'equity' | 'mutual_fund' | 'gold' | 'epf' | 'nps' | 'fixed_deposit' | 'crypto' | 'other'
  name: string
  institution: string
  invested_minor: number
  current_value_minor: number
  start_date: string | null
  notes: string | null
  quantity: number | null
  average_cost_minor: number | null
  current_price_minor: number | null
  units: number | null
  average_nav_minor: number | null
  current_nav_minor: number | null
  weight_grams: number | null
  monthly_contribution_minor: number | null
  interest_rate: number | null
  maturity_date: string | null
  created_at: string
  updated_at: string
}
