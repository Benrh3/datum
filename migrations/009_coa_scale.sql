-- Performance indexes for chart of accounts at scale (hundreds of codes).
PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_gl_accounts_code ON gl_accounts(code);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_parent ON gl_accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_gl ON invoice_lines(gl_account_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_budgets_lookup ON budgets(building_id, gl_account_id, fiscal_year, period);
