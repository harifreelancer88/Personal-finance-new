-- Minimum bootstrap for DEFAULT_WORKSPACE_ID. Creates no accounts or transactions.
INSERT OR IGNORE INTO workspaces (id, name, currency) VALUES ('development-workspace', 'Personal Finance', 'INR');
INSERT OR IGNORE INTO categories (id, workspace_id, name, kind) VALUES
('cat-groceries','development-workspace','Groceries','expense'),
('cat-food-dining','development-workspace','Food & Dining','expense'),
('cat-shopping','development-workspace','Shopping','expense'),
('cat-transport','development-workspace','Transport','expense'),
('cat-utilities','development-workspace','Utilities','expense'),
('cat-education','development-workspace','School / Education','expense'),
('cat-entertainment','development-workspace','Entertainment','expense'),
('cat-healthcare','development-workspace','Healthcare','expense'),
('cat-housing','development-workspace','Housing','expense'),
('cat-salary','development-workspace','Salary','income'),
('cat-investment','development-workspace','Investment','expense'),
('cat-other','development-workspace','Other','both');
