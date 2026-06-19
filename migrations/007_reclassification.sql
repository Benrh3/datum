-- Reclassification workflow: correct miscoded invoices safely after posting.
-- Posted/paid invoices get reclass entries (not silent edits); drafts edit in place.
PRAGMA foreign_keys = ON;

-- Audit log: immutable record of every mutation
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT    NOT NULL,
  record_id  INTEGER NOT NULL,
  action     TEXT    NOT NULL,
  old_values TEXT,
  new_values TEXT,
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Reclassification entries: preserve the original coding, record the move
CREATE TABLE reclassifications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_line_id  INTEGER NOT NULL REFERENCES invoice_lines(id),
  invoice_id       INTEGER NOT NULL REFERENCES invoices(id),
  from_gl_account_id INTEGER NOT NULL REFERENCES gl_accounts(id),
  to_gl_account_id   INTEGER NOT NULL REFERENCES gl_accounts(id),
  amount_cents     INTEGER NOT NULL,
  reason           TEXT    NOT NULL,
  user_id          INTEGER REFERENCES users(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  transfer_id      INTEGER REFERENCES inter_account_transfers(id)
);

-- Inter-account transfers: when a reclass crosses buildings/entities,
-- the GL move doesn't move cash — this tracks the actual money movement.
CREATE TABLE inter_account_transfers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  from_building_id INTEGER NOT NULL REFERENCES buildings(id),
  to_building_id   INTEGER NOT NULL REFERENCES buildings(id),
  amount_cents     INTEGER NOT NULL,
  reason           TEXT,
  status           TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','recorded','voided')),
  reclass_id       INTEGER,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  recorded_at      TEXT
);
