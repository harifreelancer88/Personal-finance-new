#!/usr/bin/env bash
set -euo pipefail
rm -rf .sms-test-dist
trap 'rm -rf .sms-test-dist; rm -f "${db:-}"' EXIT
npx tsc --ignoreConfig worker/lib/sms-parser.ts worker/lib/sms-category.ts worker/lib/sms-security.ts --module esnext --moduleResolution bundler --target es2022 --outDir .sms-test-dist --skipLibCheck
node --test tests/sms-parser.test.mjs tests/sms-security.test.mjs

db="$(mktemp)"
sqlite3 "$db" < migrations/0001_initial_schema.sql
sqlite3 "$db" < migrations/0002_allow_short_last4.sql
sqlite3 "$db" < bootstrap.sql
sqlite3 "$db" < migrations/0003_sms_ingestion.sql
sqlite3 "$db" < migrations/0004_sms_bank_reference.sql
sqlite3 "$db" <<'SQL'
PRAGMA foreign_keys=ON;
INSERT INTO accounts(id,workspace_id,name,institution,account_type,last4) VALUES
 ('unique','development-workspace','Unique','Bank','bank','2847'),
 ('duplicate-a','development-workspace','Duplicate A','Bank','bank','99'),
 ('duplicate-b','development-workspace','Duplicate B','Bank','bank','99'),
 ('card-0005','development-workspace','ICICI Card','ICICI','credit_card','0005');
INSERT INTO sms_messages(id,workspace_id,dedupe_key,raw_text,received_at,parse_status) VALUES
 ('sms-1','development-workspace','external:one','INR 650 spent using card xx2847 at AMAZON','2026-09-29T16:30:00+05:30','parsed');
INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,transaction_date,source,external_id,status)
 VALUES('pending','development-workspace','expense','AMAZON',65000,'2026-09-29','sms','external:one','pending');
UPDATE sms_messages SET transaction_id='pending' WHERE id='sms-1';
SQL
[[ "$(sqlite3 "$db" "SELECT count(*) FROM sms_messages WHERE dedupe_key='external:one'")" = 1 ]]
[[ "$(sqlite3 "$db" "SELECT count(*) FROM pragma_index_list('sms_messages') WHERE name='idx_sms_messages_workspace_bank_reference'")" = 1 ]]
if sqlite3 "$db" "INSERT INTO sms_messages(id,workspace_id,dedupe_key,raw_text,received_at) VALUES('sms-2','development-workspace','external:one','retry','2026-09-29');" >/dev/null 2>&1; then echo 'Expected SMS dedupe constraint failure' >&2; exit 1; fi
if sqlite3 "$db" "UPDATE transactions SET status='confirmed' WHERE id='pending';" >/dev/null 2>&1; then echo 'Expected incomplete confirmation failure' >&2; exit 1; fi
sqlite3 "$db" "UPDATE transactions SET from_account_id='unique',status='confirmed' WHERE id='pending';"
[[ "$(sqlite3 "$db" "SELECT status FROM transactions WHERE id='pending'")" = confirmed ]]
sqlite3 "$db" "INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,transaction_date,source,status) VALUES('ignored','development-workspace','expense','Ignored',99999,'2026-09-29','sms','ignored');"
balance="$(sqlite3 "$db" "SELECT opening_balance_minor+COALESCE(SUM(CASE WHEN t.status!='confirmed' THEN 0 WHEN t.from_account_id=a.id THEN -t.amount_minor WHEN t.to_account_id=a.id THEN t.amount_minor ELSE 0 END),0) FROM accounts a LEFT JOIN transactions t ON t.from_account_id=a.id OR t.to_account_id=a.id WHERE a.id='unique' GROUP BY a.id")"
[[ "$balance" = -65000 ]]
# The transaction schema permits an unresolved-source card repayment to remain
# pending, but continues to reject confirmation until both sides are selected.
sqlite3 "$db" "INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,to_account_id,transaction_date,source,external_id,status) VALUES('repayment','development-workspace','transfer','Credit card payment',275765,'card-0005','2026-09-30','sms','external:repayment','pending');"
if sqlite3 "$db" "UPDATE transactions SET status='confirmed' WHERE id='repayment';" >/dev/null 2>&1; then echo 'Expected incomplete repayment confirmation failure' >&2; exit 1; fi
sqlite3 "$db" "INSERT INTO sms_messages(id,workspace_id,dedupe_key,raw_text,received_at,parse_status,transaction_id) VALUES('sms-repayment','development-workspace','external:repayment','Payment of INR 2,757.65 received on card 4xxx0005','2026-09-30','parsed','repayment');"
if sqlite3 "$db" "INSERT INTO transactions(id,workspace_id,transaction_type,description,amount_minor,to_account_id,transaction_date,source,external_id,status) VALUES('repayment-copy','development-workspace','transfer','Credit card payment',275765,'card-0005','2026-09-30','sms','external:repayment','pending');" >/dev/null 2>&1; then echo 'Expected repayment transaction dedupe failure' >&2; exit 1; fi
echo 'SMS migration, deduplication, pending confirmation, and balance checks passed'
