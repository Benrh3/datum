-- Tenant profiles, notices, maintenance requests, and work orders.
-- Closes the loop: tenant request → work order → vendor → invoice → approval.
PRAGMA foreign_keys = ON;

-- Tenant documents (insurance COI naming landlord, business license, etc.)
CREATE TABLE tenant_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  doc_type    TEXT    NOT NULL CHECK (doc_type IN ('insurance_coi','business_license','lease_copy','other')),
  description TEXT,
  expiry_date TEXT,
  file_path   TEXT,
  uploaded_at TEXT    NOT NULL DEFAULT (datetime('now')),
  status      TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','expired','rejected'))
);

-- Additional tenant contacts (beyond the single contact on the tenants table)
CREATE TABLE tenant_contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  name        TEXT    NOT NULL,
  role        TEXT,
  email       TEXT,
  phone       TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0
);

-- Notices (building-wide or tenant-specific)
CREATE TABLE notices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  tenant_id   INTEGER REFERENCES tenants(id),
  scope       TEXT    NOT NULL DEFAULT 'tenant'
                CHECK (scope IN ('tenant','building')),
  subject     TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  sent_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  sent_by     INTEGER REFERENCES users(id)
);

-- Maintenance requests (tenant-submitted)
CREATE TABLE maintenance_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id),
  building_id  INTEGER NOT NULL REFERENCES buildings(id),
  suite_id     INTEGER REFERENCES suites(id),
  category     TEXT    NOT NULL DEFAULT 'general'
                 CHECK (category IN ('general','plumbing','electrical','hvac','elevator','pest','fire_safety','other')),
  description  TEXT    NOT NULL,
  priority     TEXT    NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('low','normal','urgent','emergency')),
  status       TEXT    NOT NULL DEFAULT 'submitted'
                 CHECK (status IN ('submitted','acknowledged','assigned','in_progress','completed','closed')),
  submitted_at TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT
);

-- Work orders (assigned from a maintenance request or created independently)
CREATE TABLE work_orders (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  maintenance_request_id INTEGER REFERENCES maintenance_requests(id),
  building_id           INTEGER NOT NULL REFERENCES buildings(id),
  assigned_vendor_id    INTEGER REFERENCES vendors(id),
  assigned_by           INTEGER REFERENCES users(id),
  description           TEXT    NOT NULL,
  priority              TEXT    NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low','normal','urgent','emergency')),
  status                TEXT    NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','dispatched','in_progress','completed','invoiced','closed')),
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at          TEXT,
  invoice_id            INTEGER REFERENCES invoices(id)
);
