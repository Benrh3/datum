// Read-only reporting endpoints, served straight off the SQL views.
import { Router } from 'express';
import { db } from '../db.js';

export const reports = Router();

reports.get('/rent-roll', (_req, res) =>
  res.json(db.prepare('SELECT * FROM v_rent_roll').all()));

reports.get('/budget-vs-actual', (req, res) => {
  const building = Number(req.query.building ?? 1);
  const year = Number(req.query.year ?? 2026);
  const period = Number(req.query.period ?? 6);
  res.json(
    db.prepare(
      `SELECT * FROM v_budget_vs_actual
       WHERE building_id = ? AND fiscal_year = ? AND period = ?
       ORDER BY account_code`
    ).all(building, year, period)
  );
});

reports.get('/budget-vs-actual/grouped', (req, res) => {
  const building = Number(req.query.building ?? 1);
  const year = Number(req.query.year ?? 2026);
  const period = Number(req.query.period ?? 6);
  res.json(
    db.prepare(
      `SELECT * FROM v_budget_vs_actual_grouped
       WHERE building_id = ? AND fiscal_year = ? AND period = ?
       ORDER BY group_code`
    ).all(building, year, period)
  );
});
