-- One immutable request/response snapshot per paid attempt, including retries.
-- Request bodies contain the already-sanitised narration, never auth headers.
CREATE TABLE ai_category_audits (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  model TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  request_id TEXT,
  http_status INTEGER,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_nano_usd INTEGER,
  pricing_version TEXT NOT NULL DEFAULT 'gpt-4o-mini-standard-2026-10-14',
  duration_ms INTEGER,
  error_code TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX idx_ai_audits_transaction ON ai_category_audits(workspace_id,transaction_id,attempt_number);
