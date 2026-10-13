CREATE TABLE IF NOT EXISTS payroll_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  payroll_month TEXT NOT NULL CHECK(payroll_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  employer TEXT NOT NULL,
  gross_minor INTEGER NOT NULL CHECK(gross_minor > 0),
  net_minor INTEGER NOT NULL CHECK(net_minor > 0),
  employee_pf_minor INTEGER NOT NULL DEFAULT 0 CHECK(employee_pf_minor >= 0),
  nps_minor INTEGER NOT NULL DEFAULT 0 CHECK(nps_minor >= 0),
  income_tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(income_tax_minor >= 0),
  professional_tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(professional_tax_minor >= 0),
  staff_sale_minor INTEGER NOT NULL DEFAULT 0 CHECK(staff_sale_minor >= 0),
  other_minor INTEGER NOT NULL DEFAULT 0 CHECK(other_minor >= 0),
  notes TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(gross_minor = net_minor + employee_pf_minor + nps_minor + income_tax_minor + professional_tax_minor + staff_sale_minor + other_minor)
);
CREATE TABLE IF NOT EXISTS payroll_contributions (
  id TEXT PRIMARY KEY,
  payroll_id TEXT NOT NULL REFERENCES payroll_records(id) ON DELETE RESTRICT,
  scheme TEXT NOT NULL CHECK(scheme IN ('epf','nps','eps')),
  contributor TEXT NOT NULL CHECK(contributor IN ('employee','employer')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  investment_id TEXT REFERENCES investments(id) ON DELETE RESTRICT,
  activity_id TEXT UNIQUE REFERENCES investment_activity(id) ON DELETE RESTRICT,
  credited_date TEXT,
  statement_reference TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(payroll_id,scheme,contributor),
  CHECK(scheme <> 'eps' OR (contributor='employer' AND investment_id IS NULL AND activity_id IS NULL)),
  CHECK((credited_date IS NULL AND statement_reference IS NULL AND investment_id IS NULL AND activity_id IS NULL)
    OR (credited_date IS NOT NULL AND statement_reference IS NOT NULL AND (scheme='eps' OR investment_id IS NOT NULL)))
);
CREATE INDEX IF NOT EXISTS idx_payroll_workspace_month ON payroll_records(workspace_id,payroll_month DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_contributions_record ON payroll_contributions(payroll_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_evidence ON payroll_contributions(investment_id,scheme,credited_date,statement_reference)
  WHERE credited_date IS NOT NULL AND investment_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS payroll_link_insert BEFORE INSERT ON payroll_records BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.transaction_id AND workspace_id=NEW.workspace_id
    AND transaction_type='income' AND status<>'ignored' AND amount_minor=NEW.net_minor)
    THEN RAISE(ABORT,'PAYROLL_TRANSACTION_MISMATCH') END;
END;
CREATE TRIGGER IF NOT EXISTS payroll_link_update BEFORE UPDATE ON payroll_records BEGIN
  SELECT CASE WHEN NEW.payroll_month<>OLD.payroll_month AND EXISTS(SELECT 1 FROM payroll_contributions WHERE payroll_id=OLD.id AND credited_date IS NOT NULL)
    THEN RAISE(ABORT,'PAYROLL_MATCH_LOCKED') END;
  SELECT CASE WHEN NEW.transaction_id<>OLD.transaction_id OR NEW.workspace_id<>OLD.workspace_id
    OR NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.transaction_id AND workspace_id=NEW.workspace_id
    AND transaction_type='income' AND amount_minor=NEW.net_minor)
    THEN RAISE(ABORT,'PAYROLL_TRANSACTION_MISMATCH') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM payroll_contributions WHERE payroll_id=OLD.id AND credited_date IS NOT NULL
    AND contributor='employee' AND ((scheme='epf' AND amount_minor<>NEW.employee_pf_minor) OR (scheme='nps' AND amount_minor<>NEW.nps_minor)))
    THEN RAISE(ABORT,'PAYROLL_MATCH_LOCKED') END;
END;
CREATE TRIGGER IF NOT EXISTS payroll_transaction_guard BEFORE UPDATE OF transaction_type,amount_minor ON transactions
WHEN EXISTS(SELECT 1 FROM payroll_records WHERE transaction_id=OLD.id AND (NEW.transaction_type<>'income' OR net_minor<>NEW.amount_minor)) BEGIN
  SELECT RAISE(ABORT,'PAYROLL_TRANSACTION_MISMATCH');
END;
CREATE TRIGGER IF NOT EXISTS payroll_sync_insert AFTER INSERT ON payroll_records BEGIN
  INSERT INTO payroll_contributions(id,payroll_id,scheme,contributor,amount_minor)
    SELECT NEW.id||':employee:epf',NEW.id,'epf','employee',NEW.employee_pf_minor WHERE NEW.employee_pf_minor>0;
  INSERT INTO payroll_contributions(id,payroll_id,scheme,contributor,amount_minor)
    SELECT NEW.id||':employee:nps',NEW.id,'nps','employee',NEW.nps_minor WHERE NEW.nps_minor>0;
END;
CREATE TRIGGER IF NOT EXISTS payroll_sync_update AFTER UPDATE ON payroll_records BEGIN
  DELETE FROM payroll_contributions WHERE payroll_id=NEW.id AND contributor='employee' AND credited_date IS NULL
    AND ((scheme='epf' AND NEW.employee_pf_minor=0) OR (scheme='nps' AND NEW.nps_minor=0));
  INSERT INTO payroll_contributions(id,payroll_id,scheme,contributor,amount_minor)
    SELECT NEW.id||':employee:epf',NEW.id,'epf','employee',NEW.employee_pf_minor WHERE NEW.employee_pf_minor>0
    ON CONFLICT(payroll_id,scheme,contributor) DO UPDATE SET amount_minor=excluded.amount_minor,revision=revision+1,updated_at=CURRENT_TIMESTAMP;
  INSERT INTO payroll_contributions(id,payroll_id,scheme,contributor,amount_minor)
    SELECT NEW.id||':employee:nps',NEW.id,'nps','employee',NEW.nps_minor WHERE NEW.nps_minor>0
    ON CONFLICT(payroll_id,scheme,contributor) DO UPDATE SET amount_minor=excluded.amount_minor,revision=revision+1,updated_at=CURRENT_TIMESTAMP;
END;
CREATE TRIGGER IF NOT EXISTS payroll_contribution_insert BEFORE INSERT ON payroll_contributions BEGIN
  SELECT CASE WHEN NEW.scheme='eps' AND NEW.credited_date IS NOT NULL AND EXISTS(
    SELECT 1 FROM payroll_contributions c JOIN payroll_records p ON p.id=c.payroll_id
    WHERE c.scheme='eps' AND c.credited_date=NEW.credited_date AND c.statement_reference=NEW.statement_reference
    AND p.workspace_id=(SELECT workspace_id FROM payroll_records WHERE id=NEW.payroll_id))
    THEN RAISE(ABORT,'PAYROLL_EVIDENCE_USED') END;
  SELECT CASE WHEN NEW.investment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM investments i JOIN payroll_records p ON p.id=NEW.payroll_id
    WHERE i.id=NEW.investment_id AND i.workspace_id=p.workspace_id AND i.investment_type=NEW.scheme)
    THEN RAISE(ABORT,'PAYROLL_HOLDING_MISMATCH') END;
  SELECT CASE WHEN NEW.activity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM investment_activity WHERE id=NEW.activity_id
    AND investment_id=NEW.investment_id AND activity_type='contribution' AND amount_minor=NEW.amount_minor AND activity_date=NEW.credited_date)
    THEN RAISE(ABORT,'PAYROLL_ACTIVITY_MISMATCH') END;
END;
CREATE TRIGGER IF NOT EXISTS payroll_contribution_update BEFORE UPDATE ON payroll_contributions BEGIN
  SELECT CASE WHEN NEW.scheme='eps' AND NEW.credited_date IS NOT NULL AND EXISTS(
    SELECT 1 FROM payroll_contributions c JOIN payroll_records p ON p.id=c.payroll_id
    WHERE c.id<>NEW.id AND c.scheme='eps' AND c.credited_date=NEW.credited_date AND c.statement_reference=NEW.statement_reference
    AND p.workspace_id=(SELECT workspace_id FROM payroll_records WHERE id=NEW.payroll_id))
    THEN RAISE(ABORT,'PAYROLL_EVIDENCE_USED') END;
  SELECT CASE WHEN NEW.payroll_id<>OLD.payroll_id OR NEW.scheme<>OLD.scheme OR NEW.contributor<>OLD.contributor
    THEN RAISE(ABORT,'PAYROLL_MATCH_LOCKED') END;
  SELECT CASE WHEN NEW.investment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM investments i JOIN payroll_records p ON p.id=NEW.payroll_id
    WHERE i.id=NEW.investment_id AND i.workspace_id=p.workspace_id AND i.investment_type=NEW.scheme)
    THEN RAISE(ABORT,'PAYROLL_HOLDING_MISMATCH') END;
  SELECT CASE WHEN NEW.activity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM investment_activity WHERE id=NEW.activity_id
    AND investment_id=NEW.investment_id AND activity_type='contribution' AND amount_minor=NEW.amount_minor AND activity_date=NEW.credited_date)
    THEN RAISE(ABORT,'PAYROLL_ACTIVITY_MISMATCH') END;
END;
CREATE TRIGGER IF NOT EXISTS payroll_holding_type_guard BEFORE UPDATE OF investment_type ON investments
WHEN EXISTS(SELECT 1 FROM payroll_contributions WHERE investment_id=OLD.id AND scheme<>NEW.investment_type) BEGIN
  SELECT RAISE(ABORT,'PAYROLL_HOLDING_MISMATCH');
END;
