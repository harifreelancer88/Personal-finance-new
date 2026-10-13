CREATE TABLE IF NOT EXISTS category_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('expense','income','refund')),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','history')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id,keyword,transaction_type)
);
CREATE INDEX IF NOT EXISTS idx_category_rules_workspace ON category_rules(workspace_id,is_active);
