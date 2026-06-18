-- Data-driven approval routing, ranked roles, and service contracts.
-- Replaces hardcoded thresholds and the vendor boolean flag.
PRAGMA foreign_keys = ON;

-- Ranked roles: rank orders the approval chain (lower = earlier).
CREATE TABLE roles (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  key  TEXT    NOT NULL UNIQUE,
  name TEXT    NOT NULL,
  rank INTEGER NOT NULL UNIQUE
);

-- Users now reference a role. The text 'role' column from 003 stays for
-- backward compat; role_id is the canonical FK going forward.
ALTER TABLE users ADD COLUMN role_id INTEGER REFERENCES roles(id);

-- Approval rules: scope + trigger + threshold -> required role.
-- "Configure approvals without a developer."
--   scope:   'all' (every invoice) or 'building' (per-building override)
--   trigger: 'always' (every invoice hits this rule),
--            'amount' (invoice total >= min_amount_cents),
--            'budget_overrun' (any line's account is over budget)
CREATE TABLE approval_rules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  scope            TEXT    NOT NULL DEFAULT 'all' CHECK (scope IN ('all','building')),
  building_id      INTEGER REFERENCES buildings(id),
  trigger_type     TEXT    NOT NULL CHECK (trigger_type IN ('always','amount','budget_overrun')),
  min_amount_cents INTEGER,
  required_role_id INTEGER NOT NULL REFERENCES roles(id),
  active           INTEGER NOT NULL DEFAULT 1
);

-- Service contracts: recurring vendor obligations. The work-verification
-- gate checks work_confirmations against these, not a vendor boolean.
CREATE TABLE service_contracts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
  building_id   INTEGER NOT NULL REFERENCES buildings(id),
  gl_account_id INTEGER NOT NULL REFERENCES gl_accounts(id),
  description   TEXT,
  amount_cents  INTEGER NOT NULL,
  frequency     TEXT    NOT NULL DEFAULT 'monthly'
                  CHECK (frequency IN ('monthly','quarterly','annual','one_time')),
  start_date    TEXT    NOT NULL,
  end_date      TEXT,
  active        INTEGER NOT NULL DEFAULT 1
);
