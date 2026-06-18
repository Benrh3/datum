// SQLite connection + a tiny migration runner. Migrations in /migrations are
// applied in filename order, once each, tracked in _migrations. Never edit an
// applied migration — add a new numbered one.
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '../data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(process.env.DB_PATH || join(dataDir, 'commercial-pm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function migrate(): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = join(here, '../migrations');
  const done = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name)
  );
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    db.exec(readFileSync(join(dir, file), 'utf8'));
    db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    console.log('[db] migrated', file);
  }
}
