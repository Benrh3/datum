-- AP review: the pre-payment gates, approval chain, and vendor compliance
-- tables that make the review queue work.
PRAGMA foreign_keys = ON;

-- Vendor compliance state
ALTER TABLE vendors ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE vendors ADD COLUMN requires_work_confirmation INTEGER NOT NULL DEFAULT 0;

-- Documents on file per vendor (insurance COI, banking, W-9)
CREATE TABLE vendor_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id   INTEGER NOT NULL REFERENCES vendors(id),
  doc_type    TEXT    NOT NULL CHECK (doc_type IN ('insurance_coi','banking','w9')),
  description TEXT,
  expiry_date TEXT,
  uploaded_at TEXT    NOT NULL
);

-- Per-invoice confirmation that physical work was done on site
CREATE TABLE work_confirmations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id   INTEGER NOT NULL REFERENCES invoices(id),
  confirmed_by TEXT    NOT NULL,
  confirmed_at TEXT    NOT NULL,
  notes        TEXT
);

-- Users and roles for the approval chain
CREATE TABLE users (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role  TEXT NOT NULL
);

-- Step-by-step approval routing per invoice
CREATE TABLE approvals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  step_order INTEGER NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','pending','approved','rejected')),
  reason     TEXT,
  decided_at TEXT,
  UNIQUE(invoice_id, step_order)
);
