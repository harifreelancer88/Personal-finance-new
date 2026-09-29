#!/usr/bin/env bash
set -euo pipefail
db="$(mktemp)"
trap 'rm -f "$db"' EXIT
sqlite3 "$db" < migrations/0001_initial_schema.sql
sqlite3 "$db" < bootstrap.sql
sqlite3 "$db" <<'SQL'
PRAGMA foreign_keys=ON;
INSERT INTO accounts (id,workspace_id,name,institution,account_type) VALUES
 ('acct-a','development-workspace','Account A','Test','bank'),
 ('acct-b','development-workspace','Account B','Test','bank');
INSERT INTO transactions (id,workspace_id,transaction_type,description,amount_minor,category_id,from_account_id,transaction_date) VALUES
 ('expense','development-workspace','expense','Groceries',12500,'cat-groceries','acct-a','2026-09-01');
INSERT INTO transactions (id,workspace_id,transaction_type,description,amount_minor,category_id,to_account_id,transaction_date) VALUES
 ('income','development-workspace','income','Salary',100000,'cat-salary','acct-a','2026-09-02');
INSERT INTO transactions (id,workspace_id,transaction_type,description,amount_minor,from_account_id,to_account_id,transaction_date) VALUES
 ('transfer','development-workspace','transfer','Move money',5000,'acct-a','acct-b','2026-09-03');
INSERT INTO transactions (id,workspace_id,transaction_type,description,amount_minor,to_account_id,transaction_date,original_transaction_id) VALUES
 ('refund','development-workspace','refund','Refund',1000,'acct-a','2026-09-04','expense');
UPDATE transactions SET description='Updated groceries', amount_minor=13000 WHERE id='expense';
SQL

[[ "$(sqlite3 "$db" "SELECT count(*) FROM transactions WHERE transaction_type='transfer' AND from_account_id='acct-a' AND to_account_id='acct-b';")" = 1 ]]
[[ "$(sqlite3 "$db" "SELECT count(*) FROM transactions WHERE transaction_date >= '2026-09-02' AND (from_account_id='acct-a' OR to_account_id='acct-a');")" = 3 ]]
[[ "$(sqlite3 "$db" "SELECT amount_minor FROM transactions WHERE id='expense';")" = 13000 ]]

expect_constraint() { if sqlite3 "$db" "PRAGMA foreign_keys=ON; $1" >/dev/null 2>&1; then echo "Expected constraint failure" >&2; exit 1; fi; }
expect_constraint "INSERT INTO transactions (id,workspace_id,transaction_type,description,amount_minor,from_account_id,to_account_id,transaction_date) VALUES ('same','development-workspace','transfer','Bad',100,'acct-a','acct-a','2026-09-05');"
expect_constraint "INSERT INTO transactions (id,workspace_id,transaction_type,description,amount_minor,from_account_id,transaction_date) VALUES ('amount','development-workspace','expense','Bad',0,'acct-a','2026-09-05');"
expect_constraint "INSERT INTO transactions (id,workspace_id,transaction_type,description,amount_minor,from_account_id,transaction_date) VALUES ('account','development-workspace','expense','Bad',100,'missing','2026-09-05');"
expect_constraint "INSERT INTO transactions (id,workspace_id,transaction_type,description,amount_minor,category_id,from_account_id,transaction_date) VALUES ('category','development-workspace','expense','Bad',100,'missing','acct-a','2026-09-05');"

sqlite3 "$db" "PRAGMA foreign_keys=ON; DELETE FROM transactions WHERE id='expense';"
[[ "$(sqlite3 "$db" "SELECT original_transaction_id IS NULL FROM transactions WHERE id='refund';")" = 1 ]]
sqlite3 "$db" "PRAGMA foreign_keys=ON; DELETE FROM transactions WHERE id='income';"
[[ "$(sqlite3 "$db" "SELECT count(*) FROM transactions WHERE id='income';")" = 0 ]]
echo "Transaction SQLite checks passed"
