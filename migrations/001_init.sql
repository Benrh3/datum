-- ============================================================================
-- Commercial Property Management — demo schema
-- ----------------------------------------------------------------------------
-- Target: SQLite (better-sqlite3), to match the existing benhowbrook-api setup.
-- Ports cleanly to MySQL: swap INTEGER PK AUTOINCREMENT for AUTO_INCREMENT,
-- TEXT dates for DATE/DATETIME, and keep money as integer cents either way.
--
-- Two design decisions worth knowing up front:
--   1. Money is stored as INTEGER cents, never floats. Accounting tolerates
--      zero rounding drift; floats don't. This is the kind of thing the demo
--      should get right precisely because most generic CRUD apps get it wrong.
--   2. The hierarchy is building -> suite -> lease, because commercial real
--      estate is multi-tenant buildings, not single rental units. Residential
--      tools collapse this; the collapse is what makes them useless here.
--
-- Run with PRAGMA foreign_keys = ON; (SQLite doesn't enforce FKs by default).
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- Ownership / portfolio
-- Quarterly board reporting is per ownership entity, so it's a first-class row,
-- not an afterthought baked into the building.
-- ----------------------------------------------------------------------------
CREATE TABLE entities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,          -- e.g. "Hastings Holdings LP"
  legal_form    TEXT,                       -- LP, Corp, etc.
  fiscal_year_start_month INTEGER DEFAULT 1 -- 1 = January; drives reporting periods
);

CREATE TABLE buildings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id       INTEGER NOT NULL REFERENCES entities(id),
  name            TEXT    NOT NULL,
  address         TEXT,
  city            TEXT,
  -- Total rentable area of the building. Every tenant's pro-rata share of
  -- recoverable costs is (their leased area / this number).
  rentable_area_sqft INTEGER NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- Leasable space
-- ----------------------------------------------------------------------------
CREATE TABLE suites (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id        INTEGER NOT NULL REFERENCES buildings(id),
  suite_number       TEXT    NOT NULL,      -- "300", "Unit B"
  floor              INTEGER,
  rentable_area_sqft INTEGER NOT NULL,
  usable_area_sqft   INTEGER,               -- usable < rentable; the gap is the load factor
  status             TEXT NOT NULL DEFAULT 'vacant'
                       CHECK (status IN ('vacant', 'occupied', 'holdover'))
);

-- ----------------------------------------------------------------------------
-- Tenants & leases
-- ----------------------------------------------------------------------------
CREATE TABLE tenants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  is_company  INTEGER NOT NULL DEFAULT 1,   -- commercial tenants are usually entities
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT
);

CREATE TABLE leases (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  suite_id         INTEGER NOT NULL REFERENCES suites(id),
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
  commencement_date TEXT NOT NULL,          -- ISO yyyy-mm-dd
  expiry_date       TEXT NOT NULL,

  lease_type        TEXT NOT NULL DEFAULT 'nnn'
                      CHECK (lease_type IN ('nnn', 'gross', 'modified_gross')),

  -- Base rent expressed annually, in cents. The monthly bill is /12.
  base_rent_annual_cents INTEGER NOT NULL,

  -- Recovery mechanics — the commercial-specific bits.
  -- base_year_for_recoveries: under a base-year/stop lease, the tenant only pays
  --   the increase in operating costs above the costs of this year.
  -- expense_stop_cents: alternative to base year; a fixed $/yr the tenant covers
  --   before recoveries kick in. Null when not used.
  base_year_for_recoveries INTEGER,
  expense_stop_cents        INTEGER,

  -- Retail percentage rent: tenant pays a % of gross sales above a breakpoint.
  -- Null for non-retail. percentage_rent_rate is stored as basis points (600 = 6%).
  percentage_rent_bps   INTEGER,
  percentage_breakpoint_cents INTEGER
);

-- Scheduled rent steps (escalations). Rather than one rent number, a commercial
-- lease almost always escalates — fixed bumps or CPI. Each row is the annual
-- base rent that applies from effective_date forward.
CREATE TABLE rent_steps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_id       INTEGER NOT NULL REFERENCES leases(id),
  effective_date TEXT    NOT NULL,
  annual_rent_cents INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- Accounting backbone: chart of accounts, vendors, budgets, invoices, accruals
-- ----------------------------------------------------------------------------

-- General ledger / cost codes. is_recoverable flags whether a cost flows into
-- the CAM pool that tenants reimburse. This single flag is what makes recovery
-- reconciliation possible and is invisible in most generic tools.
CREATE TABLE gl_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,    -- "5100", "6200"
  name          TEXT    NOT NULL,           -- "Repairs & Maintenance"
  account_type  TEXT    NOT NULL
                  CHECK (account_type IN ('income', 'operating_expense', 'capital', 'tax')),
  is_recoverable INTEGER NOT NULL DEFAULT 0 -- 1 = recoverable via CAM
);

CREATE TABLE vendors (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT    NOT NULL,
  -- The fix for the real pain: admin no longer hand-types the code every time.
  -- A new invoice from this vendor pre-fills this account; user can override.
  default_gl_account_id INTEGER REFERENCES gl_accounts(id)
);

-- Budget: one row per building x account x period. The board's expectation.
CREATE TABLE budgets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id   INTEGER NOT NULL REFERENCES buildings(id),
  gl_account_id INTEGER NOT NULL REFERENCES gl_accounts(id),
  fiscal_year   INTEGER NOT NULL,
  period        INTEGER NOT NULL CHECK (period BETWEEN 1 AND 12), -- month
  amount_cents  INTEGER NOT NULL,
  UNIQUE (building_id, gl_account_id, fiscal_year, period)
);

-- Accounts payable. Status walks entered -> coded -> approved -> paid.
CREATE TABLE invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
  building_id   INTEGER NOT NULL REFERENCES buildings(id),
  invoice_number TEXT,
  invoice_date  TEXT    NOT NULL,
  due_date      TEXT,
  total_cents   INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'entered'
                  CHECK (status IN ('entered', 'coded', 'approved', 'paid'))
);

-- Line-level coding. One invoice can hit several GL codes (a facilities invoice
-- splitting across R&M and Utilities, say), so coding lives on the line, not
-- the invoice. The sum of an invoice's lines should equal its total_cents.
CREATE TABLE invoice_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  gl_account_id INTEGER NOT NULL REFERENCES gl_accounts(id),
  description   TEXT,
  amount_cents  INTEGER NOT NULL
);

-- Accruals: the "out of sync" fix. At period close you book an estimate for a
-- cost incurred but not yet invoiced, so the period's actuals are honest. It
-- reverses automatically in reverse_period; the real invoice lands later and
-- replaces it. A generalist dev has never modelled this — it's pure domain.
CREATE TABLE accruals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id    INTEGER NOT NULL REFERENCES buildings(id),
  gl_account_id  INTEGER NOT NULL REFERENCES gl_accounts(id),
  fiscal_year    INTEGER NOT NULL,
  accrual_period INTEGER NOT NULL CHECK (accrual_period BETWEEN 1 AND 12),
  reverse_period INTEGER NOT NULL CHECK (reverse_period BETWEEN 1 AND 12),
  amount_cents   INTEGER NOT NULL,
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'reversed'))
);

-- CAM / recovery reconciliation. At year end: total recoverable costs are
-- pooled, each lease's pro-rata share is computed, base-year/stop is applied,
-- and the result is trued up against what was billed as monthly estimates.
CREATE TABLE recovery_reconciliations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_id             INTEGER NOT NULL REFERENCES leases(id),
  fiscal_year          INTEGER NOT NULL,
  recoverable_pool_cents INTEGER NOT NULL,  -- building-wide recoverable total
  pro_rata_bps         INTEGER NOT NULL,    -- tenant share in basis points
  tenant_share_cents   INTEGER NOT NULL,    -- pool * share, after base year/stop
  billed_estimate_cents INTEGER NOT NULL,   -- what they actually paid monthly
  true_up_cents        INTEGER NOT NULL     -- share - billed; +ve = tenant owes
);

-- ----------------------------------------------------------------------------
-- Reporting views — the board-facing outputs, defined once so the UI just reads
-- ----------------------------------------------------------------------------

-- Budget vs Actual, by building / account / month, with accruals folded in.
-- Actual = posted invoice lines + open accruals - reversed accruals.
-- This is the view the variance report renders from.
CREATE VIEW v_budget_vs_actual AS
SELECT
  b.building_id,
  b.fiscal_year,
  b.period,
  b.gl_account_id,
  g.code  AS account_code,
  g.name  AS account_name,
  b.amount_cents AS budget_cents,
  COALESCE((
    SELECT SUM(il.amount_cents)
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    WHERE i.building_id = b.building_id
      AND il.gl_account_id = b.gl_account_id
      AND CAST(strftime('%Y', i.invoice_date) AS INTEGER) = b.fiscal_year
      AND CAST(strftime('%m', i.invoice_date) AS INTEGER) = b.period
  ), 0)
  + COALESCE((
    SELECT SUM(CASE WHEN a.accrual_period = b.period THEN a.amount_cents
                    WHEN a.reverse_period = b.period THEN -a.amount_cents
                    ELSE 0 END)
    FROM accruals a
    WHERE a.building_id = b.building_id
      AND a.gl_account_id = b.gl_account_id
      AND a.fiscal_year = b.fiscal_year
  ), 0) AS actual_cents
FROM budgets b
JOIN gl_accounts g ON g.id = b.gl_account_id;

-- Rent roll: current leases with tenant, suite, area, and the in-effect rent
-- step. The single most-requested artifact in commercial PM.
CREATE VIEW v_rent_roll AS
SELECT
  bl.id           AS building_id,
  bl.name         AS building_name,
  s.suite_number,
  s.rentable_area_sqft,
  t.name          AS tenant_name,
  l.id            AS lease_id,
  l.lease_type,
  l.commencement_date,
  l.expiry_date,
  COALESCE((
    SELECT rs.annual_rent_cents
    FROM rent_steps rs
    WHERE rs.lease_id = l.id
      AND rs.effective_date <= date('now')
    ORDER BY rs.effective_date DESC
    LIMIT 1
  ), l.base_rent_annual_cents) AS current_annual_rent_cents
FROM leases l
JOIN suites s    ON s.id = l.suite_id
JOIN buildings bl ON bl.id = s.building_id
JOIN tenants t   ON t.id = l.tenant_id
WHERE l.expiry_date >= date('now');

-- ============================================================================
-- Seed data and the auto-coding / accrual-reversal logic live in the app layer,
-- not here. The schema's job is to make the commercial concepts explicit and
-- the reports cheap to read.
-- ============================================================================
