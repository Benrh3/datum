-- Rent recording & bank reconciliation: charge generation, receipt matching,
-- payment application, AR aging.
PRAGMA foreign_keys = ON;

-- Expected charges per lease per period, generated from the rent schedule.
CREATE TABLE rent_charges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_id     INTEGER NOT NULL REFERENCES leases(id),
  building_id  INTEGER NOT NULL REFERENCES buildings(id),
  period_year  INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  charge_type  TEXT    NOT NULL CHECK (charge_type IN ('base','cam','percentage','other')),
  amount_cents INTEGER NOT NULL,
  due_date     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','partial','paid','void')),
  UNIQUE(lease_id, period_year, period_month, charge_type)
);

-- Payment applications: allocate a receipt across one or more charges.
CREATE TABLE payment_applications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id      INTEGER NOT NULL REFERENCES receipts(id),
  rent_charge_id  INTEGER NOT NULL REFERENCES rent_charges(id),
  amount_cents    INTEGER NOT NULL,
  applied_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Auto-matching queue: proposed matches between bank transactions and charges.
CREATE TABLE match_proposals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_transaction_id INTEGER NOT NULL REFERENCES bank_transactions(id),
  rent_charge_id     INTEGER REFERENCES rent_charges(id),
  lease_id           INTEGER REFERENCES leases(id),
  proposed_amount_cents INTEGER NOT NULL,
  confidence         INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  match_reason       TEXT,
  status             TEXT NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed','accepted','rejected')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_rent_charges_lease ON rent_charges(lease_id, period_year, period_month);
CREATE INDEX idx_rent_charges_status ON rent_charges(status, building_id);
CREATE INDEX idx_payment_apps_receipt ON payment_applications(receipt_id);
CREATE INDEX idx_payment_apps_charge ON payment_applications(rent_charge_id);
CREATE INDEX idx_match_proposals_status ON match_proposals(status);
