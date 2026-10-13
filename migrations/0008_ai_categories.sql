-- Preserve existing rules; AI proposals are paused until a person activates them.
CREATE TABLE category_rules_ai_upgrade (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('expense','income','refund')),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','history','ai')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id,keyword,transaction_type)
);
INSERT INTO category_rules_ai_upgrade SELECT * FROM category_rules;
DROP TABLE category_rules;
ALTER TABLE category_rules_ai_upgrade RENAME TO category_rules;
CREATE INDEX idx_category_rules_workspace ON category_rules(workspace_id,is_active);
ALTER TABLE transactions ADD COLUMN category_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN category_origin TEXT CHECK(category_origin IN ('manual','rule','ai') OR category_origin IS NULL);
CREATE TABLE ai_category_jobs (
  transaction_id TEXT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','applied','review','failed','superseded','corrected')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token TEXT,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  keyword TEXT,
  reason TEXT,
  error_code TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  corrected_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ai_jobs_pending ON ai_category_jobs(workspace_id,state,next_attempt_at);
CREATE TABLE ai_category_usage (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(workspace_id,day)
);
