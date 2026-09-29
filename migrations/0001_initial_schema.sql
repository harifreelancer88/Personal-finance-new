PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (length(currency) = 3),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE family_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  initials TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  institution TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('bank', 'credit_card', 'cash', 'wallet')),
  last4 TEXT CHECK (last4 IS NULL OR (length(last4) = 4 AND last4 NOT GLOB '*[^0-9]*')),
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  opening_balance_date TEXT,
  credit_limit_minor INTEGER CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
  billing_day INTEGER CHECK (billing_day IS NULL OR billing_day BETWEEN 1 AND 31),
  due_day INTEGER CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  CHECK (account_type = 'credit_card' OR (credit_limit_minor IS NULL AND billing_day IS NULL AND due_day IS NULL))
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'both')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, name)
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('expense', 'income', 'transfer', 'investment', 'refund')),
  description TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  category_id TEXT,
  from_account_id TEXT,
  to_account_id TEXT,
  transaction_date TEXT NOT NULL,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  original_transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'ignored')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (from_account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (to_account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (original_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  CHECK (from_account_id IS NULL OR to_account_id IS NULL OR from_account_id <> to_account_id),
  CHECK (
    (transaction_type IN ('expense', 'investment') AND from_account_id IS NOT NULL AND to_account_id IS NULL) OR
    (transaction_type IN ('income', 'refund') AND from_account_id IS NULL AND to_account_id IS NOT NULL) OR
    (transaction_type = 'transfer' AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL)
  )
);

CREATE TABLE investments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  investment_type TEXT NOT NULL CHECK (investment_type IN ('equity', 'mutual_fund', 'gold', 'epf', 'nps', 'fixed_deposit', 'crypto', 'other')),
  name TEXT NOT NULL,
  institution TEXT NOT NULL,
  invested_minor INTEGER NOT NULL DEFAULT 0 CHECK (invested_minor >= 0),
  current_value_minor INTEGER NOT NULL DEFAULT 0 CHECK (current_value_minor >= 0),
  start_date TEXT,
  notes TEXT,
  quantity REAL CHECK (quantity IS NULL OR quantity >= 0),
  average_cost_minor INTEGER CHECK (average_cost_minor IS NULL OR average_cost_minor >= 0),
  current_price_minor INTEGER CHECK (current_price_minor IS NULL OR current_price_minor >= 0),
  units REAL CHECK (units IS NULL OR units >= 0),
  average_nav_minor INTEGER CHECK (average_nav_minor IS NULL OR average_nav_minor >= 0),
  current_nav_minor INTEGER CHECK (current_nav_minor IS NULL OR current_nav_minor >= 0),
  weight_grams REAL CHECK (weight_grams IS NULL OR weight_grams >= 0),
  monthly_contribution_minor INTEGER CHECK (monthly_contribution_minor IS NULL OR monthly_contribution_minor >= 0),
  interest_rate REAL CHECK (interest_rate IS NULL OR interest_rate >= 0),
  maturity_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
);

CREATE TABLE investment_activity (
  id TEXT PRIMARY KEY,
  investment_id TEXT NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('contribution', 'purchase', 'sale', 'dividend', 'interest', 'adjustment')),
  activity_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (investment_id) REFERENCES investments(id) ON DELETE RESTRICT
);

CREATE TABLE settings (
  workspace_id TEXT PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (length(currency) = 3),
  date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  financial_year_start_month INTEGER NOT NULL DEFAULT 4 CHECK (financial_year_start_month BETWEEN 1 AND 12),
  default_landing_page TEXT NOT NULL DEFAULT '/',
  display_density TEXT NOT NULL DEFAULT 'comfortable' CHECK (display_density IN ('comfortable', 'compact')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
);

CREATE INDEX idx_family_members_workspace ON family_members(workspace_id);
CREATE INDEX idx_accounts_workspace ON accounts(workspace_id);
CREATE INDEX idx_categories_workspace ON categories(workspace_id);
CREATE INDEX idx_transactions_workspace_date ON transactions(workspace_id, transaction_date DESC);
CREATE INDEX idx_transactions_from_account ON transactions(from_account_id);
CREATE INDEX idx_transactions_to_account ON transactions(to_account_id);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_original_transaction ON transactions(original_transaction_id);
CREATE INDEX idx_transactions_external_id ON transactions(external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX idx_transactions_external_source_unique
  ON transactions(workspace_id, source, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX idx_investments_workspace ON investments(workspace_id);
CREATE INDEX idx_investment_activity_investment_date ON investment_activity(investment_id, activity_date DESC);
