-- Bank-account model: tie every cash movement to an account.
-- Supports one operating account per entity, one per building, plus
-- trust/reserve/security-deposit accounts.
PRAGMA foreign_keys = ON;

CREATE TABLE bank_accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id   INTEGER NOT NULL REFERENCES entities(id),
  building_id INTEGER REFERENCES buildings(id),
  type        TEXT    NOT NULL CHECK (type IN ('operating','trust','reserve','security_deposit')),
  name        TEXT    NOT NULL,
  last4       TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);

-- Every AP payment and AR receipt references a bank account
ALTER TABLE invoices ADD COLUMN paid_from_bank_account_id INTEGER REFERENCES bank_accounts(id);

-- AR receipts (rent, CAM recoveries, percentage rent, etc.)
CREATE TABLE receipts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_id         INTEGER REFERENCES leases(id),
  building_id      INTEGER NOT NULL REFERENCES buildings(id),
  bank_account_id  INTEGER NOT NULL REFERENCES bank_accounts(id),
  receipt_date     TEXT    NOT NULL,
  amount_cents     INTEGER NOT NULL,
  description      TEXT,
  receipt_type     TEXT    NOT NULL DEFAULT 'rent'
                     CHECK (receipt_type IN ('rent','cam_recovery','percentage_rent','security_deposit','other'))
);

-- Imported bank statement lines for reconciliation
CREATE TABLE bank_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  transaction_date TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL,
  description     TEXT,
  reference       TEXT,
  reconciled      INTEGER NOT NULL DEFAULT 0
);

-- Per-account reconciliation records
CREATE TABLE bank_reconciliations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
  period_end      TEXT    NOT NULL,
  statement_balance_cents INTEGER NOT NULL,
  book_balance_cents      INTEGER NOT NULL,
  difference_cents        INTEGER NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','completed')),
  completed_at    TEXT,
  user_id         INTEGER REFERENCES users(id)
);

-- Upgrade inter_account_transfers to reference bank accounts instead of buildings
ALTER TABLE inter_account_transfers ADD COLUMN from_bank_account_id INTEGER REFERENCES bank_accounts(id);
ALTER TABLE inter_account_transfers ADD COLUMN to_bank_account_id   INTEGER REFERENCES bank_accounts(id);
