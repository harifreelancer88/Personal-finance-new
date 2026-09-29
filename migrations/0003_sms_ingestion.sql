-- Allow incomplete pending/ignored imports while retaining strict direction rules for confirmed rows.
PRAGMA foreign_keys = OFF;

CREATE TABLE transactions_new (
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
  FOREIGN KEY (original_transaction_id) REFERENCES transactions_new(id) ON DELETE SET NULL,
  CHECK (from_account_id IS NULL OR to_account_id IS NULL OR from_account_id <> to_account_id),
  CHECK (status <> 'confirmed' OR
    (transaction_type IN ('expense', 'investment') AND from_account_id IS NOT NULL AND to_account_id IS NULL) OR
    (transaction_type IN ('income', 'refund') AND from_account_id IS NULL AND to_account_id IS NOT NULL) OR
    (transaction_type = 'transfer' AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL))
);

INSERT INTO transactions_new SELECT * FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX idx_transactions_workspace_date ON transactions(workspace_id, transaction_date DESC);
CREATE INDEX idx_transactions_from_account ON transactions(from_account_id);
CREATE INDEX idx_transactions_to_account ON transactions(to_account_id);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_original_transaction ON transactions(original_transaction_id);
CREATE INDEX idx_transactions_external_id ON transactions(external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX idx_transactions_external_source_unique ON transactions(workspace_id, source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE sms_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  external_id TEXT,
  dedupe_key TEXT NOT NULL,
  sender TEXT,
  raw_text TEXT NOT NULL,
  received_at TEXT NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'received',
  parse_confidence REAL,
  parse_notes TEXT,
  parsed_transaction_type TEXT,
  parsed_amount_minor INTEGER,
  parsed_description TEXT,
  parsed_transaction_date TEXT,
  parsed_account_last4 TEXT,
  transaction_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  UNIQUE (workspace_id, dedupe_key)
);

CREATE INDEX idx_sms_messages_workspace ON sms_messages(workspace_id);
CREATE INDEX idx_sms_messages_received_at ON sms_messages(received_at DESC);
CREATE INDEX idx_sms_messages_parse_status ON sms_messages(parse_status);
CREATE INDEX idx_sms_messages_transaction ON sms_messages(transaction_id);

PRAGMA foreign_keys = ON;
