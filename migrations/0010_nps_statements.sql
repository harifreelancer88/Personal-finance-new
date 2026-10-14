CREATE TABLE nps_statements (
  id TEXT PRIMARY KEY,
  investment_id TEXT NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  statement_date TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(investment_id,content_hash),
  UNIQUE(investment_id,statement_date)
);
CREATE INDEX idx_nps_statement_holding ON nps_statements(workspace_id,investment_id,statement_date);
CREATE TABLE nps_credit_matches (
  investment_id TEXT NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  transaction_id TEXT PRIMARY KEY NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  credit_date TEXT NOT NULL,
  salary_month TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(investment_id,credit_date,salary_month)
);
