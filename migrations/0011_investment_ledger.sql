-- Keep cash movements, contribution reconciliation, and market values separate.
ALTER TABLE investments ADD COLUMN basis_kind TEXT NOT NULL DEFAULT 'recorded' CHECK(basis_kind IN ('recorded','actual_cost','opening_valuation','unknown'));
ALTER TABLE investments ADD COLUMN valuation_date TEXT;
ALTER TABLE investments ADD COLUMN ledger_version INTEGER NOT NULL DEFAULT 0;
-- Classify only explicitly documented opening valuations; do not change balances.
UPDATE investments SET basis_kind='opening_valuation' WHERE instr(COALESCE(notes,''),'OPENING VALUATION BASELINE')>0;
CREATE TABLE investment_payments (
 id TEXT PRIMARY KEY,
 investment_id TEXT NOT NULL REFERENCES investments(id) ON DELETE RESTRICT,
 transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0 AND amount_minor<=9007199254740991),
 payment_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'awaiting' CHECK(status IN ('awaiting','credited')),
 included_in_value INTEGER NOT NULL DEFAULT 0 CHECK(included_in_value IN (0,1)),
 credit_date TEXT,
 reference TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(status='awaiting' OR (credit_date IS NOT NULL AND length(reference)>0))
);
CREATE INDEX idx_investment_payments_holding ON investment_payments(investment_id,payment_date);
CREATE TABLE investment_valuations (
 id TEXT PRIMARY KEY,
 investment_id TEXT NOT NULL REFERENCES investments(id) ON DELETE RESTRICT,
 valuation_date TEXT NOT NULL,
 invested_minor INTEGER NOT NULL CHECK(invested_minor>=0),
 value_minor INTEGER NOT NULL CHECK(value_minor>=0),
 basis_kind TEXT NOT NULL CHECK(basis_kind IN ('recorded','actual_cost','opening_valuation','unknown')),
 source TEXT NOT NULL,
 units REAL,
 quantity REAL,
 weight_grams REAL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_investment_valuations_date ON investment_valuations(investment_id,valuation_date,created_at);
CREATE TRIGGER investment_payment_insert_guard BEFORE INSERT ON investment_payments BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transactions t JOIN investments i ON i.id=NEW.investment_id AND i.workspace_id=t.workspace_id WHERE t.id=NEW.transaction_id AND t.transaction_type='investment' AND t.status='confirmed' AND t.amount_minor=NEW.amount_minor AND t.transaction_date=NEW.payment_date) THEN RAISE(ABORT,'Investment payment must match a confirmed investment transaction') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM nps_credit_matches WHERE transaction_id=NEW.transaction_id) THEN RAISE(ABORT,'Use retirement reconciliation for this transaction') END;
END;
CREATE TRIGGER investment_payment_transaction_guard BEFORE UPDATE ON transactions WHEN EXISTS(SELECT 1 FROM investment_payments WHERE transaction_id=OLD.id) BEGIN
 SELECT CASE WHEN NEW.workspace_id<>OLD.workspace_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.transaction_type<>OLD.transaction_type OR NEW.status<>OLD.status OR NEW.transaction_date<>OLD.transaction_date OR NEW.from_account_id IS NOT OLD.from_account_id OR NEW.to_account_id IS NOT OLD.to_account_id THEN RAISE(ABORT,'Unlink the investment payment before changing its cash transaction') END;
END;
CREATE TRIGGER investment_valuation_no_update BEFORE UPDATE ON investment_valuations BEGIN SELECT RAISE(ABORT,'Valuation history is append-only'); END;
CREATE TRIGGER investment_valuation_no_delete BEFORE DELETE ON investment_valuations BEGIN SELECT RAISE(ABORT,'Valuation history is append-only'); END;
-- Existing imported NPS statements carry genuine dates and totals, so retain that evidence.
INSERT INTO investment_valuations(id,investment_id,valuation_date,invested_minor,value_minor,basis_kind,source)
 SELECT 'nps-history-'||s.id,s.investment_id,s.statement_date,
 json_extract(s.data_json,'$.contributedMinor'),json_extract(s.data_json,'$.valueMinor'),
 'actual_cost','Imported NPS statement '||s.statement_date
 FROM nps_statements s;
UPDATE investments SET valuation_date=(SELECT MAX(s.statement_date) FROM nps_statements s WHERE s.investment_id=investments.id),basis_kind='actual_cost'
 WHERE EXISTS(SELECT 1 FROM nps_statements s WHERE s.investment_id=investments.id);
CREATE TRIGGER investment_payment_transaction_delete BEFORE DELETE ON transactions WHEN EXISTS(SELECT 1 FROM investment_payments WHERE transaction_id=OLD.id) BEGIN
 SELECT RAISE(ABORT,'Unlink the investment payment before deleting its cash transaction');
END;
