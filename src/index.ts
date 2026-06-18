// App bootstrap: migrate, configure EJS + static, mount domain routers.
import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, migrate } from './db.js';
import { reports } from './routes/reports.js';

migrate();

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('view engine', 'ejs');
app.set('views', join(here, '../views'));
app.use(express.json());
app.use(express.static(join(here, '../public')));

app.get('/', (_req, res) => res.render('index'));
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.get('/budget-vs-actual', (req, res) => {
  const buildingId = Number(req.query.building ?? 1);
  const year = Number(req.query.year ?? 2026);
  const period = Number(req.query.period ?? 6);

  const building = db.prepare(
    'SELECT b.name, e.name AS entity_name FROM buildings b JOIN entities e ON e.id = b.entity_id WHERE b.id = ?'
  ).get(buildingId) as { name: string; entity_name: string } | undefined;
  if (!building) return res.status(404).send('Building not found');

  const detail = db.prepare(
    `SELECT v.*, g.parent_id, g.sort_order
     FROM v_budget_vs_actual v
     JOIN gl_accounts g ON g.id = v.gl_account_id
     WHERE v.building_id = ? AND v.fiscal_year = ? AND v.period = ?
     ORDER BY g.sort_order`
  ).all(buildingId, year, period) as any[];

  const grouped = db.prepare(
    `SELECT * FROM v_budget_vs_actual_grouped
     WHERE building_id = ? AND fiscal_year = ? AND period = ?
     ORDER BY group_code`
  ).all(buildingId, year, period) as any[];

  const accruals = db.prepare(
    `SELECT gl_account_id, amount_cents, note FROM accruals
     WHERE building_id = ? AND fiscal_year = ? AND accrual_period = ? AND status = 'open'`
  ).all(buildingId, year, period) as any[];

  let totalBudget = 0, totalActual = 0, totalAccruals = 0;
  for (const r of detail) { totalBudget += r.budget_cents; totalActual += r.actual_cents; }
  for (const a of accruals) { totalAccruals += a.amount_cents; }

  res.render('budget-vs-actual', {
    building, buildingId, year, period, detail, grouped, accruals,
    totalBudget, totalActual,
    totalVariance: totalActual - totalBudget,
    totalAccruals,
  });
});

app.get('/rent-roll', (req, res) => {
  const buildingId = Number(req.query.building ?? 1);

  const building = db.prepare(
    'SELECT b.name, b.rentable_area_sqft, e.name AS entity_name FROM buildings b JOIN entities e ON e.id = b.entity_id WHERE b.id = ?'
  ).get(buildingId) as { name: string; rentable_area_sqft: number; entity_name: string } | undefined;
  if (!building) return res.status(404).send('Building not found');

  const rows = db.prepare(
    'SELECT * FROM v_rent_roll WHERE building_id = ? ORDER BY suite_number'
  ).all(buildingId) as any[];

  res.render('rent-roll', { building, buildingId, rows });
});

// One router per domain. Add: ap, leasing, vendors, capital, investor.
app.use('/api', reports);

const port = Number(process.env.PORT ?? 4010);
app.listen(port, () => console.log(`[commercial-pm] http://localhost:${port}`));
