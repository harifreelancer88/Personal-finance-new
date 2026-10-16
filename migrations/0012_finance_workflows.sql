-- Schedules and category allocations never create an extra cash movement.
CREATE TABLE bill_plans (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), account_id TEXT NOT NULL REFERENCES accounts(id),
 category_id TEXT REFERENCES categories(id), transaction_type TEXT NOT NULL CHECK(transaction_type IN ('expense','investment')),
 investment_id TEXT REFERENCES investments(id), frequency TEXT NOT NULL CHECK(frequency IN ('monthly','quarterly','annual')),
 first_due_date TEXT NOT NULL, anchor_day INTEGER NOT NULL CHECK(anchor_day BETWEEN 1 AND 31),
 max_occurrences INTEGER CHECK(max_occurrences>0), opening_paid_count INTEGER NOT NULL DEFAULT 0 CHECK(opening_paid_count>=0),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(max_occurrences IS NULL OR opening_paid_count<=max_occurrences)
);
CREATE TABLE bill_periods (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES bill_plans(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK(sequence>0), due_date TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming','paid','skipped')),
 transaction_id TEXT UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
 UNIQUE(plan_id,sequence), CHECK((status='paid' AND transaction_id IS NOT NULL) OR (status<>'paid' AND transaction_id IS NULL))
);
CREATE INDEX idx_bill_plans_workspace ON bill_plans(workspace_id,is_active);
CREATE INDEX idx_bill_period_due ON bill_periods(plan_id,due_date);
CREATE TABLE transaction_splits (
 id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
 category_id TEXT NOT NULL REFERENCES categories(id), amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 UNIQUE(transaction_id,category_id)
);
CREATE TABLE import_batches (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), account_id TEXT NOT NULL REFERENCES accounts(id),
 file_name TEXT NOT NULL, content_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','committed','undone')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, committed_at TEXT,
 UNIQUE(workspace_id,account_id,content_hash)
);
CREATE TABLE import_rows (
 batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE, row_number INTEGER NOT NULL,
 transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
 fingerprint TEXT NOT NULL, PRIMARY KEY(batch_id,row_number)
);
CREATE TABLE saved_report_views (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, filters_json TEXT NOT NULL,
 UNIQUE(workspace_id,name)
);
-- Private recovery context exists only inside an atomic restore batch.
CREATE TABLE recovery_context (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id));
CREATE TABLE restore_previews (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), payload_json TEXT NOT NULL,
 current_hash TEXT NOT NULL, expires_at TEXT NOT NULL
);
DROP TRIGGER investment_valuation_no_delete;
CREATE TRIGGER investment_valuation_no_delete BEFORE DELETE ON investment_valuations
WHEN NOT EXISTS(SELECT 1 FROM recovery_context r JOIN investments i ON i.workspace_id=r.workspace_id WHERE i.id=OLD.investment_id)
BEGIN SELECT RAISE(ABORT,'Valuation history is append-only'); END;
CREATE TRIGGER split_insert_guard BEFORE INSERT ON transaction_splits BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM transactions t JOIN categories c ON c.workspace_id=t.workspace_id WHERE t.id=NEW.transaction_id AND c.id=NEW.category_id AND t.transaction_type IN ('expense','income') AND c.id IS NOT t.category_id)
 THEN RAISE(ABORT,'SPLIT_INVALID_CATEGORY_OR_TYPE') END);
 SELECT (CASE WHEN NEW.amount_minor+COALESCE((SELECT SUM(amount_minor) FROM transaction_splits WHERE transaction_id=NEW.transaction_id),0)>(SELECT amount_minor FROM transactions WHERE id=NEW.transaction_id)
 THEN RAISE(ABORT,'SPLIT_EXCEEDS_AMOUNT') END);
END;
CREATE TRIGGER split_parent_guard BEFORE UPDATE ON transactions
WHEN EXISTS(SELECT 1 FROM transaction_splits WHERE transaction_id=OLD.id) BEGIN
 SELECT (CASE WHEN NEW.transaction_type NOT IN ('expense','income') OR NEW.amount_minor<(SELECT SUM(amount_minor) FROM transaction_splits WHERE transaction_id=OLD.id) OR EXISTS(SELECT 1 FROM transaction_splits WHERE transaction_id=OLD.id AND category_id=NEW.category_id)
 THEN RAISE(ABORT,'SPLIT_PARENT_CONFLICT') END);
END;
CREATE TRIGGER bill_payment_guard BEFORE UPDATE ON transactions
WHEN EXISTS(SELECT 1 FROM bill_periods WHERE transaction_id=OLD.id) BEGIN
 SELECT (CASE WHEN NEW.amount_minor<>OLD.amount_minor OR NEW.status<>'confirmed' OR NEW.transaction_type<>OLD.transaction_type OR NEW.transaction_date<>OLD.transaction_date OR NEW.from_account_id IS NOT OLD.from_account_id
 THEN RAISE(ABORT,'BILL_PAYMENT_LOCKED') END);
END;
ALTER TABLE import_batches ADD COLUMN opening_adjustment_minor INTEGER NOT NULL DEFAULT 0;
-- Required for simultaneous bill matches and stale requests.
CREATE TRIGGER bill_period_link_guard BEFORE UPDATE OF status,transaction_id ON bill_periods
WHEN NEW.status='paid' BEGIN
 SELECT (CASE WHEN OLD.status<>'upcoming' THEN RAISE(ABORT,'BILL_ALREADY_SETTLED') END);
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM transactions t JOIN bill_plans p ON p.id=NEW.plan_id WHERE t.id=NEW.transaction_id AND t.workspace_id=p.workspace_id AND t.status='confirmed' AND t.transaction_type=p.transaction_type AND t.from_account_id=p.account_id) THEN RAISE(ABORT,'BILL_INVALID_PAYMENT') END);
END;
CREATE TABLE workflow_claims(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),eligible INTEGER NOT NULL DEFAULT 1 CHECK(eligible=1));
ALTER TABLE recovery_context ADD COLUMN snapshot_matches INTEGER NOT NULL DEFAULT 1 CHECK(snapshot_matches=1);
CREATE TRIGGER bill_investment_match_guard BEFORE UPDATE OF status ON bill_periods WHEN NEW.status='paid' BEGIN
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM bill_plans p WHERE p.id=NEW.plan_id AND p.investment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM investment_payments m WHERE m.transaction_id=NEW.transaction_id AND m.investment_id=p.investment_id)) THEN RAISE(ABORT,'BILL_INVESTMENT_MATCH_REQUIRED') END);
END;
CREATE TRIGGER split_refund_insert_guard BEFORE INSERT ON transaction_splits
WHEN EXISTS(SELECT 1 FROM transactions WHERE original_transaction_id=NEW.transaction_id)
AND NOT EXISTS(SELECT 1 FROM recovery_context r JOIN transactions t ON t.workspace_id=r.workspace_id WHERE t.id=NEW.transaction_id)
BEGIN SELECT RAISE(ABORT,'SPLIT_REFUND_LOCKED'); END;
CREATE TRIGGER split_refund_delete_guard BEFORE DELETE ON transaction_splits
WHEN EXISTS(SELECT 1 FROM transactions WHERE original_transaction_id=OLD.transaction_id)
AND NOT EXISTS(SELECT 1 FROM recovery_context r JOIN transactions t ON t.workspace_id=r.workspace_id WHERE t.id=OLD.transaction_id)
BEGIN SELECT RAISE(ABORT,'SPLIT_REFUND_LOCKED'); END;

-- Fixed recovery program; only the owner-authorized restore route writes this table.
CREATE TABLE recovery_payloads(workspace_id TEXT PRIMARY KEY REFERENCES recovery_context(workspace_id), payload_json TEXT NOT NULL);
CREATE TRIGGER recovery_apply AFTER INSERT ON recovery_payloads BEGIN
 DELETE FROM workflow_claims WHERE workspace_id=NEW.workspace_id;
 DELETE FROM saved_report_views WHERE workspace_id = NEW.workspace_id;
 DELETE FROM import_rows WHERE batch_id IN (SELECT id FROM import_batches WHERE workspace_id = NEW.workspace_id);
 DELETE FROM import_batches WHERE workspace_id = NEW.workspace_id;
 DELETE FROM transaction_splits WHERE transaction_id IN (SELECT id FROM transactions WHERE workspace_id = NEW.workspace_id);
 DELETE FROM bill_periods WHERE plan_id IN (SELECT id FROM bill_plans WHERE workspace_id = NEW.workspace_id);
 DELETE FROM bill_plans WHERE workspace_id = NEW.workspace_id;
 DELETE FROM investment_valuations WHERE investment_id IN (SELECT id FROM investments WHERE workspace_id = NEW.workspace_id);
 DELETE FROM investment_payments WHERE investment_id IN (SELECT id FROM investments WHERE workspace_id = NEW.workspace_id);
 DELETE FROM nps_credit_matches WHERE investment_id IN (SELECT id FROM investments WHERE workspace_id = NEW.workspace_id);
 DELETE FROM nps_statements WHERE workspace_id = NEW.workspace_id;
 DELETE FROM payroll_contributions WHERE payroll_id IN (SELECT id FROM payroll_records WHERE workspace_id = NEW.workspace_id);
 DELETE FROM payroll_records WHERE workspace_id = NEW.workspace_id;
 DELETE FROM investment_activity WHERE investment_id IN (SELECT id FROM investments WHERE workspace_id = NEW.workspace_id);
 DELETE FROM ai_category_audits WHERE workspace_id = NEW.workspace_id;
 DELETE FROM ai_category_jobs WHERE workspace_id = NEW.workspace_id;
 DELETE FROM ai_category_usage WHERE workspace_id = NEW.workspace_id;
 DELETE FROM category_rules WHERE workspace_id = NEW.workspace_id;
 DELETE FROM sms_messages WHERE workspace_id = NEW.workspace_id;
 DELETE FROM transactions WHERE workspace_id = NEW.workspace_id;
 DELETE FROM investments WHERE workspace_id = NEW.workspace_id;
 DELETE FROM settings WHERE workspace_id = NEW.workspace_id;
 DELETE FROM categories WHERE workspace_id = NEW.workspace_id;
 DELETE FROM accounts WHERE workspace_id = NEW.workspace_id;
 DELETE FROM family_members WHERE workspace_id = NEW.workspace_id;
 INSERT INTO family_members(id,workspace_id,name,relationship,initials,is_active,created_at,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.name'),json_extract(value,'$.relationship'),json_extract(value,'$.initials'),json_extract(value,'$.is_active'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at') FROM json_each(NEW.payload_json,'$.tables.family_members') WHERE 1;
 INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4,opening_balance_minor,opening_balance_date,credit_limit_minor,billing_day,due_day,notes,is_active,created_at,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.name'),json_extract(value,'$.institution'),json_extract(value,'$.account_type'),json_extract(value,'$.last4'),json_extract(value,'$.opening_balance_minor'),json_extract(value,'$.opening_balance_date'),json_extract(value,'$.credit_limit_minor'),json_extract(value,'$.billing_day'),json_extract(value,'$.due_day'),json_extract(value,'$.notes'),json_extract(value,'$.is_active'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at') FROM json_each(NEW.payload_json,'$.tables.accounts') WHERE 1;
 INSERT INTO categories(id,workspace_id,name,kind,is_active,created_at,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.name'),json_extract(value,'$.kind'),json_extract(value,'$.is_active'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at') FROM json_each(NEW.payload_json,'$.tables.categories') WHERE 1;
 INSERT INTO settings(workspace_id,currency,date_format,financial_year_start_month,default_landing_page,display_density,created_at,updated_at) SELECT json_extract(value,'$.workspace_id'),json_extract(value,'$.currency'),json_extract(value,'$.date_format'),json_extract(value,'$.financial_year_start_month'),json_extract(value,'$.default_landing_page'),json_extract(value,'$.display_density'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at') FROM json_each(NEW.payload_json,'$.tables.settings') WHERE 1;
 INSERT INTO investments(id,workspace_id,investment_type,name,institution,invested_minor,current_value_minor,start_date,notes,quantity,average_cost_minor,current_price_minor,units,average_nav_minor,current_nav_minor,weight_grams,monthly_contribution_minor,interest_rate,maturity_date,created_at,updated_at,basis_kind,valuation_date,ledger_version) SELECT json_extract(value,'$.id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.investment_type'),json_extract(value,'$.name'),json_extract(value,'$.institution'),json_extract(value,'$.invested_minor'),json_extract(value,'$.current_value_minor'),json_extract(value,'$.start_date'),json_extract(value,'$.notes'),json_extract(value,'$.quantity'),json_extract(value,'$.average_cost_minor'),json_extract(value,'$.current_price_minor'),json_extract(value,'$.units'),json_extract(value,'$.average_nav_minor'),json_extract(value,'$.current_nav_minor'),json_extract(value,'$.weight_grams'),json_extract(value,'$.monthly_contribution_minor'),json_extract(value,'$.interest_rate'),json_extract(value,'$.maturity_date'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at'),json_extract(value,'$.basis_kind'),json_extract(value,'$.valuation_date'),json_extract(value,'$.ledger_version') FROM json_each(NEW.payload_json,'$.tables.investments') WHERE 1;
 INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,category_id,from_account_id,to_account_id,transaction_date,notes,source,external_id,original_transaction_id,status,created_at,updated_at,accounting_date,category_revision,category_origin) SELECT json_extract(value,'$.id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.transaction_type'),json_extract(value,'$.description'),json_extract(value,'$.amount_minor'),json_extract(value,'$.category_id'),json_extract(value,'$.from_account_id'),json_extract(value,'$.to_account_id'),json_extract(value,'$.transaction_date'),json_extract(value,'$.notes'),json_extract(value,'$.source'),json_extract(value,'$.external_id'),json_extract(value,'$.original_transaction_id'),json_extract(value,'$.status'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at'),json_extract(value,'$.accounting_date'),json_extract(value,'$.category_revision'),json_extract(value,'$.category_origin') FROM json_each(NEW.payload_json,'$.tables.transactions') WHERE 1;
 INSERT INTO sms_messages(id,workspace_id,external_id,dedupe_key,sender,raw_text,received_at,parse_status,parse_confidence,parse_notes,parsed_transaction_type,parsed_amount_minor,parsed_description,parsed_transaction_date,parsed_account_last4,transaction_id,created_at,updated_at,bank_reference) SELECT json_extract(value,'$.id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.external_id'),json_extract(value,'$.dedupe_key'),json_extract(value,'$.sender'),json_extract(value,'$.raw_text'),json_extract(value,'$.received_at'),json_extract(value,'$.parse_status'),json_extract(value,'$.parse_confidence'),json_extract(value,'$.parse_notes'),json_extract(value,'$.parsed_transaction_type'),json_extract(value,'$.parsed_amount_minor'),json_extract(value,'$.parsed_description'),json_extract(value,'$.parsed_transaction_date'),json_extract(value,'$.parsed_account_last4'),json_extract(value,'$.transaction_id'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at'),json_extract(value,'$.bank_reference') FROM json_each(NEW.payload_json,'$.tables.sms_messages') WHERE 1;
 INSERT INTO category_rules(id,workspace_id,keyword,transaction_type,category_id,is_active,source,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.keyword'),json_extract(value,'$.transaction_type'),json_extract(value,'$.category_id'),json_extract(value,'$.is_active'),json_extract(value,'$.source'),json_extract(value,'$.updated_at') FROM json_each(NEW.payload_json,'$.tables.category_rules') WHERE 1;
 INSERT INTO ai_category_usage(workspace_id,day,requests) SELECT json_extract(value,'$.workspace_id'),json_extract(value,'$.day'),json_extract(value,'$.requests') FROM json_each(NEW.payload_json,'$.tables.ai_category_usage') WHERE 1;
 INSERT INTO ai_category_jobs(transaction_id,workspace_id,state,attempts,next_attempt_at,lease_token,model,category_id,keyword,reason,error_code,input_tokens,output_tokens,corrected_category_id,created_at,updated_at) SELECT json_extract(value,'$.transaction_id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.state'),json_extract(value,'$.attempts'),json_extract(value,'$.next_attempt_at'),json_extract(value,'$.lease_token'),json_extract(value,'$.model'),json_extract(value,'$.category_id'),json_extract(value,'$.keyword'),json_extract(value,'$.reason'),json_extract(value,'$.error_code'),json_extract(value,'$.input_tokens'),json_extract(value,'$.output_tokens'),json_extract(value,'$.corrected_category_id'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at') FROM json_each(NEW.payload_json,'$.tables.ai_category_jobs') WHERE 1;
 INSERT INTO ai_category_audits(id,transaction_id,workspace_id,attempt_number,model,request_json,response_json,request_id,http_status,input_tokens,cached_input_tokens,output_tokens,estimated_cost_nano_usd,pricing_version,duration_ms,error_code,started_at,completed_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.transaction_id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.attempt_number'),json_extract(value,'$.model'),json_extract(value,'$.request_json'),json_extract(value,'$.response_json'),json_extract(value,'$.request_id'),json_extract(value,'$.http_status'),json_extract(value,'$.input_tokens'),json_extract(value,'$.cached_input_tokens'),json_extract(value,'$.output_tokens'),json_extract(value,'$.estimated_cost_nano_usd'),json_extract(value,'$.pricing_version'),json_extract(value,'$.duration_ms'),json_extract(value,'$.error_code'),json_extract(value,'$.started_at'),json_extract(value,'$.completed_at') FROM json_each(NEW.payload_json,'$.tables.ai_category_audits') WHERE 1;
 INSERT INTO investment_activity(id,investment_id,activity_type,activity_date,amount_minor,description,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.investment_id'),json_extract(value,'$.activity_type'),json_extract(value,'$.activity_date'),json_extract(value,'$.amount_minor'),json_extract(value,'$.description'),json_extract(value,'$.created_at') FROM json_each(NEW.payload_json,'$.tables.investment_activity') WHERE 1;
 INSERT INTO payroll_records(id,workspace_id,transaction_id,payroll_month,employer,gross_minor,net_minor,employee_pf_minor,nps_minor,income_tax_minor,professional_tax_minor,staff_sale_minor,other_minor,notes,revision,created_at,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.transaction_id'),json_extract(value,'$.payroll_month'),json_extract(value,'$.employer'),json_extract(value,'$.gross_minor'),json_extract(value,'$.net_minor'),json_extract(value,'$.employee_pf_minor'),json_extract(value,'$.nps_minor'),json_extract(value,'$.income_tax_minor'),json_extract(value,'$.professional_tax_minor'),json_extract(value,'$.staff_sale_minor'),json_extract(value,'$.other_minor'),json_extract(value,'$.notes'),json_extract(value,'$.revision'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at') FROM json_each(NEW.payload_json,'$.tables.payroll_records') WHERE 1;
 INSERT INTO payroll_contributions(id,payroll_id,scheme,contributor,amount_minor,investment_id,activity_id,credited_date,statement_reference,revision,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.payroll_id'),json_extract(value,'$.scheme'),json_extract(value,'$.contributor'),json_extract(value,'$.amount_minor'),json_extract(value,'$.investment_id'),json_extract(value,'$.activity_id'),json_extract(value,'$.credited_date'),json_extract(value,'$.statement_reference'),json_extract(value,'$.revision'),json_extract(value,'$.updated_at') FROM json_each(NEW.payload_json,'$.tables.payroll_contributions') WHERE 1 ON CONFLICT(id) DO UPDATE SET payroll_id=excluded.payroll_id,scheme=excluded.scheme,contributor=excluded.contributor,amount_minor=excluded.amount_minor,investment_id=excluded.investment_id,activity_id=excluded.activity_id,credited_date=excluded.credited_date,statement_reference=excluded.statement_reference,revision=excluded.revision,updated_at=excluded.updated_at;
 INSERT INTO nps_statements(id,investment_id,workspace_id,account_hash,content_hash,statement_date,data_json,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.investment_id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.account_hash'),json_extract(value,'$.content_hash'),json_extract(value,'$.statement_date'),json_extract(value,'$.data_json'),json_extract(value,'$.created_at') FROM json_each(NEW.payload_json,'$.tables.nps_statements') WHERE 1;
 INSERT INTO nps_credit_matches(investment_id,transaction_id,credit_date,salary_month,amount_minor,created_at) SELECT json_extract(value,'$.investment_id'),json_extract(value,'$.transaction_id'),json_extract(value,'$.credit_date'),json_extract(value,'$.salary_month'),json_extract(value,'$.amount_minor'),json_extract(value,'$.created_at') FROM json_each(NEW.payload_json,'$.tables.nps_credit_matches') WHERE 1;
 INSERT INTO investment_payments(id,investment_id,transaction_id,amount_minor,payment_date,status,included_in_value,credit_date,reference,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.investment_id'),json_extract(value,'$.transaction_id'),json_extract(value,'$.amount_minor'),json_extract(value,'$.payment_date'),json_extract(value,'$.status'),json_extract(value,'$.included_in_value'),json_extract(value,'$.credit_date'),json_extract(value,'$.reference'),json_extract(value,'$.created_at') FROM json_each(NEW.payload_json,'$.tables.investment_payments') WHERE 1;
 INSERT INTO investment_valuations(id,investment_id,valuation_date,invested_minor,value_minor,basis_kind,source,units,quantity,weight_grams,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.investment_id'),json_extract(value,'$.valuation_date'),json_extract(value,'$.invested_minor'),json_extract(value,'$.value_minor'),json_extract(value,'$.basis_kind'),json_extract(value,'$.source'),json_extract(value,'$.units'),json_extract(value,'$.quantity'),json_extract(value,'$.weight_grams'),json_extract(value,'$.created_at') FROM json_each(NEW.payload_json,'$.tables.investment_valuations') WHERE 1;
 INSERT INTO bill_plans(id,workspace_id,name,amount_minor,account_id,category_id,transaction_type,investment_id,frequency,first_due_date,anchor_day,max_occurrences,opening_paid_count,is_active,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.name'),json_extract(value,'$.amount_minor'),json_extract(value,'$.account_id'),json_extract(value,'$.category_id'),json_extract(value,'$.transaction_type'),json_extract(value,'$.investment_id'),json_extract(value,'$.frequency'),json_extract(value,'$.first_due_date'),json_extract(value,'$.anchor_day'),json_extract(value,'$.max_occurrences'),json_extract(value,'$.opening_paid_count'),json_extract(value,'$.is_active'),json_extract(value,'$.created_at') FROM json_each(NEW.payload_json,'$.tables.bill_plans') WHERE 1;
 INSERT INTO bill_periods(id,plan_id,sequence,due_date,status,transaction_id) SELECT json_extract(value,'$.id'),json_extract(value,'$.plan_id'),json_extract(value,'$.sequence'),json_extract(value,'$.due_date'),json_extract(value,'$.status'),json_extract(value,'$.transaction_id') FROM json_each(NEW.payload_json,'$.tables.bill_periods') WHERE 1;
 INSERT INTO transaction_splits(id,transaction_id,category_id,amount_minor) SELECT json_extract(value,'$.id'),json_extract(value,'$.transaction_id'),json_extract(value,'$.category_id'),json_extract(value,'$.amount_minor') FROM json_each(NEW.payload_json,'$.tables.transaction_splits') WHERE 1;
 INSERT INTO import_batches(id,workspace_id,account_id,file_name,content_hash,payload_json,status,created_at,committed_at,opening_adjustment_minor) SELECT json_extract(value,'$.id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.account_id'),json_extract(value,'$.file_name'),json_extract(value,'$.content_hash'),json_extract(value,'$.payload_json'),json_extract(value,'$.status'),json_extract(value,'$.created_at'),json_extract(value,'$.committed_at'),json_extract(value,'$.opening_adjustment_minor') FROM json_each(NEW.payload_json,'$.tables.import_batches') WHERE 1;
 INSERT INTO import_rows(batch_id,row_number,transaction_id,fingerprint) SELECT json_extract(value,'$.batch_id'),json_extract(value,'$.row_number'),json_extract(value,'$.transaction_id'),json_extract(value,'$.fingerprint') FROM json_each(NEW.payload_json,'$.tables.import_rows') WHERE 1;
 INSERT INTO saved_report_views(id,workspace_id,name,filters_json) SELECT json_extract(value,'$.id'),json_extract(value,'$.workspace_id'),json_extract(value,'$.name'),json_extract(value,'$.filters_json') FROM json_each(NEW.payload_json,'$.tables.saved_report_views') WHERE 1;
END;
-- An import's duplicate approval applies only to matches actually reviewed.
CREATE TABLE import_commit_guards (
 batch_id TEXT PRIMARY KEY REFERENCES import_batches(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 planned_ids_json TEXT NOT NULL, allowed_matches_json TEXT NOT NULL
);
CREATE TRIGGER import_cash_insert_guard BEFORE INSERT ON transactions
WHEN NEW.source='import' AND NOT EXISTS(SELECT 1 FROM recovery_context WHERE workspace_id=NEW.workspace_id) BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM import_commit_guards g,json_each(g.planned_ids_json) j WHERE g.workspace_id=NEW.workspace_id AND j.value=NEW.id) THEN RAISE(ABORT,'IMPORT_PREVIEW_REQUIRED') END);
 SELECT (CASE WHEN EXISTS(
  SELECT 1 FROM transactions t JOIN import_commit_guards g ON g.workspace_id=NEW.workspace_id
  WHERE EXISTS(SELECT 1 FROM json_each(g.planned_ids_json) j WHERE j.value=NEW.id)
  AND t.workspace_id=NEW.workspace_id AND t.transaction_date=NEW.transaction_date AND t.amount_minor=NEW.amount_minor
  AND (t.from_account_id=NEW.from_account_id OR t.to_account_id=NEW.to_account_id OR t.from_account_id=NEW.to_account_id OR t.to_account_id=NEW.from_account_id)
  AND NOT EXISTS(SELECT 1 FROM json_each(g.planned_ids_json) j WHERE j.value=t.id)
  AND NOT EXISTS(SELECT 1 FROM json_each(g.allowed_matches_json) a,json_each(a.value) m WHERE a.key=NEW.id AND m.value=t.id)
 ) THEN RAISE(ABORT,'IMPORT_NEW_DUPLICATE') END);
END;
