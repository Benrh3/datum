// Loads seed.sql into the db (after migrating). Run: npm run seed
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, migrate } from '../src/db.js';

migrate();
const here = dirname(fileURLToPath(import.meta.url));
db.exec(readFileSync(join(here, '../seed.sql'), 'utf8'));
console.log('[seed] done');
