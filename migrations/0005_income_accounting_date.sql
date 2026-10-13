-- NULL uses the original bank transaction date; only income can override it.
ALTER TABLE transactions ADD COLUMN accounting_date TEXT NULL
  CHECK (accounting_date IS NULL OR (transaction_type = 'income' AND accounting_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'));
