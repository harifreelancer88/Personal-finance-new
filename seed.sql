PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO workspaces (id, name, currency)
VALUES ('development-workspace', 'My Family Finances', 'INR');

INSERT OR IGNORE INTO settings (workspace_id, currency, date_format, financial_year_start_month, default_landing_page, display_density)
VALUES ('development-workspace', 'INR', 'DD/MM/YYYY', 4, '/', 'comfortable');

INSERT OR IGNORE INTO family_members (id, workspace_id, name, relationship, initials)
VALUES
  ('member-me', 'development-workspace', 'Aarav Sharma', 'Self', 'AS'),
  ('member-spouse', 'development-workspace', 'Priya Sharma', 'Spouse', 'PS');

INSERT OR IGNORE INTO accounts (id, workspace_id, name, institution, account_type, last4, opening_balance_minor, opening_balance_date, credit_limit_minor, billing_day, due_day)
VALUES
  ('account-hdfc-salary', 'development-workspace', 'HDFC Salary Account', 'HDFC Bank', 'bank', '4821', 17965000, '2026-08-31', NULL, NULL, NULL),
  ('account-icici-savings', 'development-workspace', 'ICICI Savings Account', 'ICICI Bank', 'bank', '7394', 11248000, '2026-08-31', NULL, NULL, NULL),
  ('account-hdfc-card', 'development-workspace', 'HDFC Credit Card', 'HDFC Bank', 'credit_card', '9012', -1485500, '2026-08-31', 20000000, 18, 7),
  ('account-pluxee', 'development-workspace', 'Pluxee', 'Pluxee', 'wallet', NULL, 438500, '2026-08-31', NULL, NULL, NULL),
  ('account-cash', 'development-workspace', 'Cash', 'Cash', 'cash', NULL, 350000, '2026-08-31', NULL, NULL, NULL);

INSERT OR IGNORE INTO categories (id, workspace_id, name, kind)
VALUES
  ('category-groceries', 'development-workspace', 'Groceries', 'expense'),
  ('category-food-dining', 'development-workspace', 'Food & Dining', 'expense'),
  ('category-shopping', 'development-workspace', 'Shopping', 'expense'),
  ('category-transport', 'development-workspace', 'Transport', 'expense'),
  ('category-utilities', 'development-workspace', 'Utilities', 'expense'),
  ('category-education', 'development-workspace', 'School / Education', 'expense'),
  ('category-entertainment', 'development-workspace', 'Entertainment', 'expense'),
  ('category-healthcare', 'development-workspace', 'Healthcare', 'expense'),
  ('category-housing', 'development-workspace', 'Housing', 'expense'),
  ('category-salary', 'development-workspace', 'Salary', 'income'),
  ('category-investment', 'development-workspace', 'Investment', 'both'),
  ('category-other', 'development-workspace', 'Other', 'both');

INSERT OR IGNORE INTO transactions (id, workspace_id, transaction_type, description, amount_minor, category_id, from_account_id, to_account_id, transaction_date, original_transaction_id)
VALUES
  ('transaction-grocery', 'development-workspace', 'expense', 'Weekly groceries', 428500, 'category-groceries', 'account-hdfc-card', NULL, '2026-09-26', NULL),
  ('transaction-salary', 'development-workspace', 'income', 'Monthly salary', 12500000, 'category-salary', NULL, 'account-hdfc-salary', '2026-09-01', NULL),
  ('transaction-transfer', 'development-workspace', 'transfer', 'Savings transfer', 2000000, NULL, 'account-hdfc-salary', 'account-icici-savings', '2026-09-03', NULL),
  ('transaction-grocery-refund', 'development-workspace', 'refund', 'Grocery item refund', 50000, 'category-groceries', NULL, 'account-hdfc-card', '2026-09-28', 'transaction-grocery');

INSERT OR IGNORE INTO investments (id, workspace_id, investment_type, name, institution, invested_minor, current_value_minor, start_date, units, average_nav_minor, current_nav_minor, monthly_contribution_minor)
VALUES ('investment-index-fund', 'development-workspace', 'mutual_fund', 'Nifty 50 Index Fund', 'UTI Mutual Fund', 30000000, 34850000, '2023-04-05', 1523.44, 19692, 22876, 1000000);

INSERT OR IGNORE INTO investment_activity (id, investment_id, activity_type, activity_date, amount_minor, description)
VALUES ('activity-index-september', 'investment-index-fund', 'contribution', '2026-09-05', 1000000, 'September SIP');
