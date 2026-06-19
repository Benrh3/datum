-- Portfolio structure: operate by building, report by company.
-- Ownership is a reporting lens — admins never see it in day-to-day navigation.
PRAGMA foreign_keys = ON;

CREATE TABLE orgs (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

ALTER TABLE entities ADD COLUMN org_id INTEGER REFERENCES orgs(id);

-- Many-to-many ownership in basis points. 40/60 = 4000/6000.
-- This is what lets the investor report apportion a shared property.
CREATE TABLE building_ownership (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id   INTEGER NOT NULL REFERENCES buildings(id),
  entity_id     INTEGER NOT NULL REFERENCES entities(id),
  ownership_bps INTEGER NOT NULL CHECK (ownership_bps BETWEEN 1 AND 10000),
  UNIQUE(building_id, entity_id)
);
