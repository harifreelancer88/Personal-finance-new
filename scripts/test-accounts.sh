#!/usr/bin/env bash
set -euo pipefail
db="$(mktemp)"
trap 'rm -f "$db"' EXIT
sqlite3 "$db" < migrations/0001_initial_schema.sql
sqlite3 "$db" < migrations/0002_allow_short_last4.sql
sqlite3 "$db" < bootstrap.sql

expect_constraint() { if sqlite3 "$db" "PRAGMA foreign_keys=ON; $1" >/dev/null 2>&1; then echo "Expected constraint failure" >&2; exit 1; fi; }

# Bank and credit-card creation, account update, and central schema validation.
sqlite3 "$db" <<'SQL'
PRAGMA foreign_keys=ON;
INSERT INTO accounts (id,workspace_id,name,institution,account_type,last4,opening_balance_minor)
VALUES ('bank','development-workspace','Everyday Bank','Example Bank','bank','1234',100000);
INSERT INTO accounts (id,workspace_id,name,institution,account_type,last4,opening_balance_minor,credit_limit_minor,billing_day,due_day)
VALUES ('card','development-workspace','Rewards Card','Example Bank','credit_card','42',-20000,500000,10,25);
UPDATE accounts SET name='Main Bank', updated_at=CURRENT_TIMESTAMP WHERE id='bank';
INSERT INTO accounts (id,workspace_id,name,institution,account_type) VALUES ('unused','development-workspace','Unused','','cash');
DELETE FROM accounts WHERE id='unused';
SQL
[[ "$(sqlite3 "$db" "SELECT name FROM accounts WHERE id='bank'")" = 'Main Bank' ]]
[[ "$(sqlite3 "$db" "SELECT count(*) FROM accounts WHERE id='unused'")" = 0 ]]
expect_constraint "INSERT INTO accounts (id,workspace_id,name,institution,account_type) VALUES ('bad-type','development-workspace','Bad','','brokerage');"
expect_constraint "INSERT INTO accounts (id,workspace_id,name,institution,account_type,billing_day) VALUES ('bad-day','development-workspace','Bad','','credit_card',32);"
expect_constraint "INSERT INTO accounts (id,workspace_id,name,institution,account_type,due_day) VALUES ('bad-due','development-workspace','Bad','','credit_card',0);"

# Every transaction direction contributes to balance, and only confirmed rows count.
sqlite3 "$db" <<'SQL'
PRAGMA foreign_keys=ON;
INSERT INTO transactions (id,workspace_id,transaction_type,description,amount_minor,from_account_id,transaction_date,status) VALUES
 ('expense','development-workspace','expense','Expense',1000,'bank','2026-01-01','confirmed'),
 ('investment','development-workspace','investment','Investment',500,'bank','2026-01-02','confirmed'),
 ('pending','development-workspace','expense','Pending',99999,'bank','2026-01-03','pending');
INSERT INTO transactions (id,workspace_id,transaction_type,description,amount_minor,to_account_id,transaction_date,status) VALUES
 ('income','development-workspace','income','Income',3000,'bank','2026-01-04','confirmed'),
 ('refund','development-workspace','refund','Refund',200,'bank','2026-01-05','confirmed');
INSERT INTO transactions (id,workspace_id,transaction_type,description,amount_minor,from_account_id,to_account_id,transaction_date,status)
VALUES ('transfer','development-workspace','transfer','Transfer',700,'bank','card','2026-01-06','confirmed');
SQL
balance_sql="SELECT a.opening_balance_minor + COALESCE(SUM(CASE WHEN t.status <> 'confirmed' THEN 0 WHEN t.from_account_id=a.id THEN -t.amount_minor WHEN t.to_account_id=a.id THEN t.amount_minor ELSE 0 END),0) FROM accounts a LEFT JOIN transactions t ON t.from_account_id=a.id OR t.to_account_id=a.id WHERE a.id='bank' GROUP BY a.id;"
[[ "$(sqlite3 "$db" "$balance_sql")" = 101000 ]]

# SQLite foreign keys mirror the API's ACCOUNT_IN_USE deletion guard.
expect_constraint "DELETE FROM accounts WHERE id='bank';"
echo "Account CRUD, constraints, delete safety, and balance checks passed"
