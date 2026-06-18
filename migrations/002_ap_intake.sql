-- ============================================================================
-- Commercial PM — schema extension
--   (1) chart-of-accounts hierarchy, so a real ~hundreds-of-codes chart stays
--       readable: postable leaves roll up into header accounts and categories.
--   (2) the AP invoice-intake pipeline: email/upload -> read -> auto-code ->
--       review -> post. The DB tracks state; the reading (vision model) and the
--       inbox watch (Gmail API) live in the Node app layer.
--
-- Additive: run AFTER commercial-pm-schema.sql. Uses ALTER ... ADD COLUMN so it
-- won't collide with the existing tables. SQLite-flavored; ports to MySQL.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- (1) Chart of accounts at industry scale
-- ----------------------------------------------------------------------------
-- parent_id : the header/summary account this leaf rolls up into (NULL = top).
--             A two-level tree (category header -> postable account) is enough
--             to turn 300 lines into ~6 board-level groups with drill-down.
-- is_postable: 0 = summary/header (you never code to it), 1 = postable leaf.
-- sort_order : preserve the accountant's chart ordering, not alphabetical.
ALTER TABLE gl_accounts ADD COLUMN parent_id   INTEGER REFERENCES gl_accounts(id);
ALTER TABLE gl_accounts ADD COLUMN is_postable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gl_accounts ADD COLUMN sort_order  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gl_accounts ADD COLUMN active      INTEGER NOT NULL DEFAULT 1;

-- ----------------------------------------------------------------------------
-- (2) Vendor matching — incoming invoices name the vendor inconsistently
-- ----------------------------------------------------------------------------
-- match_aliases: JSON array of name variants seen on real invoices
--   (e.g. ["BC Hydro","British Columbia Hydro & Power"]) so intake can map an
--   extracted vendor name back to the right vendor — and therefore its default
--   G/L code — automatically.
ALTER TABLE vendors ADD COLUMN tax_id        TEXT;
ALTER TABLE vendors ADD COLUMN match_aliases TEXT;

-- ----------------------------------------------------------------------------
-- (2) Intake queue — one row per document that arrives, tracked end to end
-- ----------------------------------------------------------------------------
CREATE TABLE invoice_imports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT    NOT NULL CHECK (source IN ('email', 'upload')),
  source_ref    TEXT,                 -- Gmail message id, or original filename
  received_at   TEXT    NOT NULL,
  file_path     TEXT,                 -- where the stored attachment lives

  matched_vendor_id INTEGER REFERENCES vendors(id),

  -- Raw structured output from the reader (vendor, number, date, totals, lines).
  -- Kept verbatim so a human can see exactly what was read vs. what they changed.
  extracted_json TEXT,
  confidence     INTEGER,             -- overall extraction confidence, 0..100

  status        TEXT NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','reading','needs_review','posted','rejected')),
  invoice_id    INTEGER REFERENCES invoices(id),  -- set once the draft is posted
  note          TEXT
);

-- Link a posted invoice back to the document it came from, and record how it
-- entered the system (manual entry vs. the new pipeline).
ALTER TABLE invoices ADD COLUMN source    TEXT NOT NULL DEFAULT 'manual'; -- manual | upload | email
ALTER TABLE invoices ADD COLUMN import_id INTEGER REFERENCES invoice_imports(id);

-- Per-line coding provenance — the bit that makes the review screen honest.
-- coding_source: where the code on this line came from. The UI flags
--   'ai_suggested' lines (and anything low-confidence) for a human to confirm.
ALTER TABLE invoice_lines ADD COLUMN coding_source TEXT NOT NULL DEFAULT 'manual'
                            CHECK (coding_source IN ('manual','vendor_default','ai_suggested'));
ALTER TABLE invoice_lines ADD COLUMN confidence    INTEGER;  -- 0..100, NULL when manual

-- ----------------------------------------------------------------------------
-- Board-level rollup: budget vs actual summarised to header accounts, so the
-- hundreds of postable codes collapse into a handful of readable groups. The
-- existing v_budget_vs_actual still serves the drill-down detail.
-- ----------------------------------------------------------------------------
CREATE VIEW v_budget_vs_actual_grouped AS
SELECT
  COALESCE(p.id,   g.id)   AS group_id,
  COALESCE(p.code, g.code) AS group_code,
  COALESCE(p.name, g.name) AS group_name,
  v.building_id,
  v.fiscal_year,
  v.period,
  SUM(v.budget_cents)                    AS budget_cents,
  SUM(v.actual_cents)                    AS actual_cents,
  SUM(v.actual_cents - v.budget_cents)   AS variance_cents
FROM v_budget_vs_actual v
JOIN gl_accounts g ON g.id = v.gl_account_id
LEFT JOIN gl_accounts p ON p.id = g.parent_id
GROUP BY COALESCE(p.id, g.id), v.building_id, v.fiscal_year, v.period;

-- ============================================================================
-- App-layer responsibilities (not SQL, noted here so the data model reads in
-- context):
--   - Inbox watch: Gmail API pulls new AP-inbox attachments -> invoice_imports
--     row (status 'received').
--   - Reader: send the attachment to a vision model (Claude API reads PDFs and
--     images natively) -> extracted_json + confidence; status 'needs_review'.
--   - Auto-code: match vendor via match_aliases, apply default G/L code, suggest
--     per-line codes from line descriptions; write draft invoice + invoice_lines
--     with coding_source / confidence set.
--   - Review screen: human confirms flagged lines, then posts -> invoice.status
--     advances, invoice_imports.status -> 'posted'.
-- ============================================================================
