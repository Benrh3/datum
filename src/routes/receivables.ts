import { Router } from 'express';
import { db } from '../db.js';

export const receivables = Router();

// Generate charges for a building + period from the rent schedule
receivables.post('/generate-charges', (req, res) => {
  try {
    const { building_id, year, month } = req.body;
    if (!building_id || !year || !month) return res.status(400).json({ error: 'building_id, year, month required' });

    const leases = db.prepare(`
      SELECT l.id AS lease_id, l.lease_type,
        COALESCE((SELECT rs.annual_rent_cents FROM rent_steps rs
          WHERE rs.lease_id = l.id AND rs.effective_date <= ? ORDER BY rs.effective_date DESC LIMIT 1
        ), l.base_rent_annual_cents) AS annual_rent_cents,
        s.rentable_area_sqft, bl.rentable_area_sqft AS bldg_area
      FROM leases l
      JOIN suites s ON s.id = l.suite_id
      JOIN buildings bl ON bl.id = s.building_id
      WHERE s.building_id = ? AND l.commencement_date <= ? AND l.expiry_date >= ?
    `).all(
      `${year}-${String(month).padStart(2, '0')}-01`,
      building_id,
      `${year}-${String(month).padStart(2, '0')}-28`,
      `${year}-${String(month).padStart(2, '0')}-01`,
    ) as any[];

    const ins = db.prepare(`
      INSERT OR IGNORE INTO rent_charges (lease_id, building_id, period_year, period_month, charge_type, amount_cents, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const dueDate = `${year}-${String(month).padStart(2, '0')}-01`;
    let created = 0;
    for (const l of leases) {
      const monthly = Math.round(l.annual_rent_cents / 12);
      const r = ins.run(l.lease_id, building_id, year, month, 'base', monthly, dueDate);
      if (r.changes > 0) created++;
    }
    res.json({ ok: true, created });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-match unreconciled bank deposits to open charges
receivables.post('/auto-match', (req, res) => {
  try {
    const buildingId = Number(req.body.building_id ?? 1);

    const deposits = db.prepare(`
      SELECT bt.* FROM bank_transactions bt
      JOIN bank_accounts ba ON ba.id = bt.bank_account_id
      WHERE bt.amount_cents > 0 AND bt.reconciled = 0
        AND (ba.building_id = ? OR ba.entity_id = (SELECT entity_id FROM buildings WHERE id = ?))
    `).all(buildingId, buildingId) as any[];

    const openCharges = db.prepare(`
      SELECT rc.*, t.name AS tenant_name
      FROM rent_charges rc
      JOIN leases l ON l.id = rc.lease_id
      JOIN tenants t ON t.id = l.tenant_id
      WHERE rc.building_id = ? AND rc.status IN ('open','partial')
      ORDER BY rc.due_date
    `).all(buildingId) as any[];

    const ins = db.prepare(`
      INSERT INTO match_proposals (bank_transaction_id, rent_charge_id, lease_id, proposed_amount_cents, confidence, match_reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let proposed = 0;
    for (const dep of deposits) {
      const existing = db.prepare("SELECT 1 FROM match_proposals WHERE bank_transaction_id = ? AND status = 'proposed' LIMIT 1").get(dep.id);
      if (existing) continue;

      const descUpper = (dep.description || '').toUpperCase();
      let bestMatch: any = null;
      let bestConf = 0;

      for (const ch of openCharges) {
        let conf = 0;
        const reasons: string[] = [];

        if (dep.amount_cents === ch.amount_cents) { conf += 50; reasons.push('exact amount'); }
        else if (dep.amount_cents > ch.amount_cents * 0.8 && dep.amount_cents < ch.amount_cents * 1.2) {
          conf += 20; reasons.push('amount within 20%');
        }

        const tenantWords = ch.tenant_name.toUpperCase().split(/\s+/);
        if (tenantWords.some((w: string) => w.length > 2 && descUpper.includes(w))) {
          conf += 35; reasons.push('tenant name in description');
        }

        const daysDiff = Math.abs(
          (new Date(dep.transaction_date).getTime() - new Date(ch.due_date).getTime()) / 86400000
        );
        if (daysDiff <= 5) { conf += 15; reasons.push('within 5 days of due'); }
        else if (daysDiff <= 15) { conf += 5; reasons.push('within 15 days of due'); }

        if (conf > bestConf) {
          bestConf = conf;
          bestMatch = { charge: ch, confidence: Math.min(conf, 100), reason: reasons.join('; ') };
        }
      }

      if (bestMatch && bestMatch.confidence >= 30) {
        ins.run(dep.id, bestMatch.charge.id, bestMatch.charge.lease_id,
          Math.min(dep.amount_cents, bestMatch.charge.amount_cents),
          bestMatch.confidence, bestMatch.reason);
        proposed++;
      }
    }
    res.json({ ok: true, proposed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Accept a match proposal → create receipt + payment application
receivables.post('/accept-match', (req, res) => {
  try {
    const { proposal_id } = req.body;
    if (!proposal_id) return res.status(400).json({ error: 'proposal_id required' });

    const prop = db.prepare(`
      SELECT mp.*, bt.bank_account_id, bt.transaction_date, bt.amount_cents AS deposit_amount,
             rc.building_id, rc.lease_id, rc.amount_cents AS charge_amount
      FROM match_proposals mp
      JOIN bank_transactions bt ON bt.id = mp.bank_transaction_id
      JOIN rent_charges rc ON rc.id = mp.rent_charge_id
      WHERE mp.id = ? AND mp.status = 'proposed'
    `).get(proposal_id) as any;
    if (!prop) return res.status(404).json({ error: 'Proposal not found or already resolved' });

    const applyAmount = prop.proposed_amount_cents;

    const rcpt = db.prepare(`
      INSERT INTO receipts (lease_id, building_id, bank_account_id, receipt_date, amount_cents, description, receipt_type)
      VALUES (?, ?, ?, ?, ?, ?, 'rent')
    `).run(prop.lease_id, prop.building_id, prop.bank_account_id, prop.transaction_date, applyAmount, 'Matched deposit');
    const receiptId = rcpt.lastInsertRowid;

    db.prepare('INSERT INTO payment_applications (receipt_id, rent_charge_id, amount_cents) VALUES (?, ?, ?)')
      .run(receiptId, prop.rent_charge_id, applyAmount);

    const totalApplied = (db.prepare(
      'SELECT COALESCE(SUM(amount_cents),0) AS s FROM payment_applications WHERE rent_charge_id = ?'
    ).get(prop.rent_charge_id) as any).s;
    const newStatus = totalApplied >= prop.charge_amount ? 'paid' : 'partial';
    db.prepare('UPDATE rent_charges SET status = ? WHERE id = ?').run(newStatus, prop.rent_charge_id);

    db.prepare('UPDATE match_proposals SET status = ? WHERE id = ?').run('accepted', proposal_id);
    db.prepare('UPDATE bank_transactions SET reconciled = 1 WHERE id = ?').run(prop.bank_transaction_id);

    res.json({ ok: true, receipt_id: Number(receiptId), charge_status: newStatus });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reject a match proposal
receivables.post('/reject-match', (req, res) => {
  try {
    const { proposal_id } = req.body;
    db.prepare("UPDATE match_proposals SET status = 'rejected' WHERE id = ? AND status = 'proposed'").run(proposal_id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
