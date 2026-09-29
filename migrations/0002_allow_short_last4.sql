-- last4 is optional and may contain one to four digits; full account numbers are never stored.
PRAGMA foreign_keys = OFF;

CREATE TABLE accounts_new (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, institution TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('bank', 'credit_card', 'cash', 'wallet')),
  last4 TEXT CHECK (last4 IS NULL OR (length(last4) BETWEEN 1 AND 4 AND last4 NOT GLOB '*[^0-9]*')),
  opening_balance_minor INTEGER NOT NULL DEFAULT 0, opening_balance_date TEXT,
  credit_limit_minor INTEGER CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
  billing_day INTEGER CHECK (billing_day IS NULL OR billing_day BETWEEN 1 AND 31),
  due_day INTEGER CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31), notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  CHECK (account_type = 'credit_card' OR (credit_limit_minor IS NULL AND billing_day IS NULL AND due_day IS NULL))
);
INSERT INTO accounts_new SELECT * FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;
CREATE INDEX idx_accounts_workspace ON accounts(workspace_id);

PRAGMA foreign_keys = ON;
