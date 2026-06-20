// App bootstrap: migrate, configure EJS + static, mount domain routers.
import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, migrate } from './db.js';
import { reports } from './routes/reports.js';
import { ap } from './routes/ap.js';
import { receivables } from './routes/receivables.js';

migrate();

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('view engine', 'ejs');
app.set('views', join(here, '../views'));
app.use(express.json());
app.use(express.static(join(here, '../public')));

app.use((_req, res, next) => {
  (res.locals as any).allBuildings = db.prepare('SELECT id, name, address, city, rentable_area_sqft FROM buildings ORDER BY name').all();
  next();
});

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

const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;
function fmtD(iso: string) { const [y,m,d] = iso.split('T')[0].split('-').map(Number); return MO[m-1]+' '+d+', '+y; }
function fmtMY(iso: string) { const [y,m] = iso.split('T')[0].split('-').map(Number); return MO[m-1]+' '+y; }

function hasOverrun(buildingId: number, invoiceId: number, invoiceDate: string) {
  const m = parseInt(invoiceDate.split('-')[1], 10);
  const y = parseInt(invoiceDate.split('-')[0], 10);
  return db.prepare(`
    SELECT 1 FROM invoice_lines il
    JOIN v_budget_vs_actual v ON v.gl_account_id = il.gl_account_id
      AND v.building_id = ? AND v.fiscal_year = ? AND v.period = ?
    WHERE il.invoice_id = ? AND v.actual_cents > v.budget_cents LIMIT 1
  `).get(buildingId, y, m, invoiceId);
}

function hasServiceContract(vendorId: number, buildingId: number, today: string) {
  return db.prepare(
    `SELECT 1 FROM service_contracts
     WHERE vendor_id = ? AND building_id = ? AND active = 1
       AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) LIMIT 1`
  ).get(vendorId, buildingId, today, today);
}

function buildChainFromRules(invoiceId: number, totalCents: number, buildingId: number, invoiceDate: string) {
  const hasBudgetOverrun = !!hasOverrun(buildingId, invoiceId, invoiceDate);
  const rules = db.prepare(`
    SELECT ar.*, r.key AS role_key, r.name AS role_name, r.rank AS role_rank
    FROM approval_rules ar
    JOIN roles r ON r.id = ar.required_role_id
    WHERE ar.active = 1
      AND (ar.scope = 'all' OR (ar.scope = 'building' AND ar.building_id = ?))
    ORDER BY r.rank
  `).all(buildingId) as any[];

  const requiredRoles = new Map<number, any>();
  for (const rule of rules) {
    if (rule.trigger_type === 'always') {
      requiredRoles.set(rule.required_role_id, rule);
    } else if (rule.trigger_type === 'amount' && rule.min_amount_cents != null && totalCents >= rule.min_amount_cents) {
      requiredRoles.set(rule.required_role_id, rule);
    } else if (rule.trigger_type === 'budget_overrun' && hasBudgetOverrun) {
      requiredRoles.set(rule.required_role_id, rule);
    }
  }

  const sorted = [...requiredRoles.values()].sort((a, b) => a.role_rank - b.role_rank);

  const existingApprovals = db.prepare(
    'SELECT * FROM approvals WHERE invoice_id = ?'
  ).all(invoiceId) as any[];
  const approvalByUser = new Map(existingApprovals.map((a: any) => [a.user_id, a]));

  const chain: any[] = [];
  let foundPending = false;
  for (let i = 0; i < sorted.length; i++) {
    const rule = sorted[i];
    const user = db.prepare('SELECT * FROM users WHERE role_id = ? LIMIT 1').get(rule.required_role_id) as any;
    if (!user) continue;
    const existing = approvalByUser.get(user.id);

    let status: string, reason: string | null, decided_at: string | null;
    if (existing) {
      status = existing.status;
      reason = existing.reason;
      decided_at = existing.decided_at;
    } else {
      status = foundPending ? 'queued' : 'pending';
      reason = rule.trigger_type === 'amount'
        ? 'required over $' + (rule.min_amount_cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
        : rule.trigger_type === 'budget_overrun'
          ? 'added because the invoice exceeds budget'
          : null;
      decided_at = null;
    }

    if (status === 'pending' || status === 'queued') foundPending = true;

    chain.push({
      user_name: user.name,
      user_role: rule.role_name,
      status,
      reason,
      decided_at,
      rule_trigger: rule.trigger_type,
      rule_min: rule.min_amount_cents,
    });
  }
  return chain;
}

app.get('/ap-review', (req, res) => {
  const buildingId = Number(req.query.building ?? 1);
  const selectedId = Number(req.query.invoice ?? 1);
  const today = new Date().toISOString().split('T')[0];

  const building = db.prepare(
    'SELECT b.name, e.name AS entity_name FROM buildings b JOIN entities e ON e.id = b.entity_id WHERE b.id = ?'
  ).get(buildingId) as { name: string; entity_name: string } | undefined;
  if (!building) return res.status(404).send('Building not found');

  // Queue: invoices not yet paid
  const queueRaw = db.prepare(`
    SELECT i.id, i.invoice_number, i.total_cents, i.status, i.source, i.invoice_date,
           v.name AS vendor_name, v.id AS vendor_id, v.approval_status
    FROM invoices i JOIN vendors v ON v.id = i.vendor_id
    WHERE i.building_id = ? AND i.status IN ('entered','coded')
    ORDER BY i.invoice_date DESC
  `).all(buildingId) as any[];

  const queue = queueRaw.map(item => {
    if (item.approval_status !== 'approved')
      return { ...item, chip: { text: 'Vendor pending', cls: 'block' } };
    const ins = db.prepare(
      "SELECT expiry_date FROM vendor_documents WHERE vendor_id = ? AND doc_type = 'insurance_coi' ORDER BY expiry_date DESC LIMIT 1"
    ).get(item.vendor_id) as any;
    if (!ins || ins.expiry_date < today)
      return { ...item, chip: { text: 'Insurance lapsed', cls: 'block' } };
    if (hasServiceContract(item.vendor_id, buildingId, today)) {
      const wc = db.prepare('SELECT 1 FROM work_confirmations WHERE invoice_id = ?').get(item.id);
      if (!wc) return { ...item, chip: { text: 'Work unconfirmed', cls: 'block' } };
    }
    if (hasOverrun(buildingId, item.id, item.invoice_date))
      return { ...item, chip: { text: 'Over budget', cls: 'block' } };
    const qLineSum = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS s FROM invoice_lines WHERE invoice_id = ?').get(item.id) as any;
    if (qLineSum.s !== item.total_cents)
      return { ...item, chip: { text: 'Lines mismatch', cls: 'block' } };
    const pending = db.prepare(
      "SELECT 1 FROM approvals WHERE invoice_id = ? AND status IN ('pending','queued')"
    ).get(item.id);
    return { ...item, chip: { text: pending ? 'In approval' : 'Ready to pay', cls: pending ? 'pend' : 'ok' } };
  });

  // Selected invoice detail
  const invoice = db.prepare(`
    SELECT i.*, v.name AS vendor_name, v.approval_status, v.id AS vendor_id
    FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = ?
  `).get(selectedId) as any;
  if (!invoice) return res.render('ap-review', { building, buildingId, queue, selectedId, invoice: null, lines: [], gates: [], approvals: [], importInfo: null, rules: [] });

  const lines = db.prepare(`
    SELECT il.*, g.code AS gl_code, g.name AS gl_name
    FROM invoice_lines il JOIN gl_accounts g ON g.id = il.gl_account_id
    WHERE il.invoice_id = ? ORDER BY il.id
  `).all(selectedId) as any[];

  const importInfo = db.prepare('SELECT * FROM invoice_imports WHERE invoice_id = ?').get(selectedId) as any;

  // --- Gates ---
  const gates: any[] = [];

  // 1. Vendor approved
  const bankDoc = db.prepare("SELECT uploaded_at FROM vendor_documents WHERE vendor_id = ? AND doc_type = 'banking' LIMIT 1").get(invoice.vendor_id) as any;
  gates.push({
    name: 'Vendor approved',
    sub: invoice.approval_status === 'approved'
      ? 'Banking and W-9 on file' + (bankDoc ? ' · onboarded ' + fmtMY(bankDoc.uploaded_at) : '')
      : 'Vendor approval pending',
    pass: invoice.approval_status === 'approved',
    chip: invoice.approval_status === 'approved' ? 'Clear' : 'Pending',
  });

  // 2. Insurance certificate
  const coi = db.prepare(
    "SELECT description, expiry_date FROM vendor_documents WHERE vendor_id = ? AND doc_type = 'insurance_coi' ORDER BY expiry_date DESC LIMIT 1"
  ).get(invoice.vendor_id) as any;
  const insValid = !!(coi && coi.expiry_date >= today);
  gates.push({
    name: 'Insurance certificate',
    sub: coi ? coi.description + ' · valid to ' + fmtD(coi.expiry_date) : 'No certificate on file',
    pass: insValid,
    chip: insValid ? 'Valid' : 'Lapsed',
  });

  // 3. Work confirmed (only if vendor has an active service contract for this building)
  const contract = hasServiceContract(invoice.vendor_id, buildingId, today);
  if (contract) {
    const wc = db.prepare('SELECT * FROM work_confirmations WHERE invoice_id = ? LIMIT 1').get(selectedId) as any;
    gates.push({
      name: 'Work confirmed on site',
      sub: wc ? wc.notes + ' · ' + fmtD(wc.confirmed_at) : 'No confirmation on file',
      pass: !!wc,
      chip: wc ? 'Verified' : 'Unconfirmed',
    });
  }

  // 4. Duplicate check
  const dup = db.prepare(
    'SELECT id FROM invoices WHERE vendor_id = ? AND invoice_number = ? AND id != ?'
  ).get(invoice.vendor_id, invoice.invoice_number, selectedId);
  gates.push({
    name: 'Duplicate check',
    sub: dup ? 'Matches an existing invoice' : 'No prior invoice from this vendor matches ' + invoice.invoice_number,
    pass: !dup,
    chip: dup ? 'Duplicate' : 'None found',
  });

  // 5. Budget check
  const invMonth = parseInt(invoice.invoice_date.split('-')[1], 10);
  const invYear = parseInt(invoice.invoice_date.split('-')[0], 10);
  const acctIds = [...new Set(lines.map((l: any) => l.gl_account_id))];
  const overruns: any[] = [];
  for (const aid of acctIds) {
    const bva = db.prepare(
      'SELECT * FROM v_budget_vs_actual WHERE building_id = ? AND gl_account_id = ? AND fiscal_year = ? AND period = ?'
    ).get(buildingId, aid, invYear, invMonth) as any;
    if (bva && bva.actual_cents > bva.budget_cents) {
      overruns.push({
        name: bva.account_name, code: bva.account_code,
        over_cents: bva.actual_cents - bva.budget_cents,
        over_pct: ((bva.actual_cents - bva.budget_cents) / bva.budget_cents * 100).toFixed(1),
      });
    }
  }
  const budgetOk = overruns.length === 0;
  gates.push({
    name: 'Budget check',
    sub: budgetOk ? 'All accounts within budget'
      : 'Posts ' + overruns[0].name + ' $' + (overruns[0].over_cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
        + ' (' + overruns[0].over_pct + '%) over Q' + Math.ceil(invMonth / 3) + ' budget',
    pass: budgetOk,
    chip: budgetOk ? 'Within budget' : 'Adds approver',
  });

  // 6. Line reconciliation
  const lineSum = lines.reduce((s: number, l: any) => s + l.amount_cents, 0);
  const reconOk = lineSum === invoice.total_cents;
  gates.push({
    name: 'Line reconciliation',
    sub: reconOk ? 'Line amounts sum to invoice total'
      : 'Lines sum to $' + (lineSum / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
        + ' but invoice total is $' + (invoice.total_cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 }),
    pass: reconOk,
    chip: reconOk ? 'Balanced' : 'Mismatch',
  });

  // Approval chain — generated from rules, merged with persisted decisions
  const approvals = buildChainFromRules(selectedId, invoice.total_cents, buildingId, invoice.invoice_date);

  // Active rules for the rulenote
  const rules = db.prepare(`
    SELECT ar.trigger_type, ar.min_amount_cents, r.name AS role_name
    FROM approval_rules ar JOIN roles r ON r.id = ar.required_role_id
    WHERE ar.active = 1 AND (ar.scope = 'all' OR (ar.scope = 'building' AND ar.building_id = ?))
    ORDER BY r.rank
  `).all(buildingId) as any[];

  // Unusual-code warnings: lines coded differently from vendor history
  const vendorHistory = db.prepare(`
    SELECT il.gl_account_id, COUNT(*) AS cnt FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    WHERE i.vendor_id = ? AND i.id != ? GROUP BY il.gl_account_id ORDER BY cnt DESC
  `).all(invoice.vendor_id, selectedId) as any[];
  const usualCodes = new Set(vendorHistory.map((h: any) => h.gl_account_id));
  const unusualLines = vendorHistory.length > 0
    ? lines.filter((l: any) => !usualCodes.has(l.gl_account_id)).map((l: any) => l.id)
    : [];

  // Reclassification history
  const reclassHistory = db.prepare(`
    SELECT r.*, gf.code AS from_code, gt.code AS to_code, gt.name AS to_name, u.name AS user_name
    FROM reclassifications r
    JOIN gl_accounts gf ON gf.id = r.from_gl_account_id
    JOIN gl_accounts gt ON gt.id = r.to_gl_account_id
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.invoice_id = ? ORDER BY r.created_at DESC
  `).all(selectedId) as any[];

  // GL accounts for reclass dropdown
  const glAccounts = db.prepare("SELECT id, code, name FROM gl_accounts WHERE is_postable = 1 ORDER BY sort_order").all() as any[];

  res.render('ap-review', { building, buildingId, queue, selectedId, invoice, lines, gates, approvals, importInfo, rules, unusualLines, reclassHistory, glAccounts });
});

app.get('/receivables', (req, res) => {
  const buildingId = Number(req.query.building ?? 1);
  const tab = String(req.query.tab ?? 'charges');

  const building = db.prepare(
    'SELECT b.name, e.name AS entity_name FROM buildings b JOIN entities e ON e.id = b.entity_id WHERE b.id = ?'
  ).get(buildingId) as { name: string; entity_name: string } | undefined;
  if (!building) return res.status(404).send('Building not found');

  const charges = db.prepare(`
    SELECT rc.*, t.name AS tenant_name, s.suite_number,
      COALESCE((SELECT SUM(pa.amount_cents) FROM payment_applications pa WHERE pa.rent_charge_id = rc.id), 0) AS paid_cents
    FROM rent_charges rc
    JOIN leases l ON l.id = rc.lease_id
    JOIN tenants t ON t.id = l.tenant_id
    JOIN suites s ON s.id = l.suite_id
    WHERE rc.building_id = ?
    ORDER BY rc.period_year DESC, rc.period_month DESC, t.name
  `).all(buildingId) as any[];

  const receipts = db.prepare(`
    SELECT r.*, t.name AS tenant_name
    FROM receipts r
    LEFT JOIN tenants t ON t.id = (SELECT tenant_id FROM leases WHERE id = r.lease_id)
    WHERE r.building_id = ?
    ORDER BY r.receipt_date DESC
  `).all(buildingId) as any[];

  const proposals = db.prepare(`
    SELECT mp.*, bt.transaction_date, bt.amount_cents AS deposit_amount, bt.description AS deposit_desc,
           rc.charge_type, rc.amount_cents AS charge_amount, rc.period_year, rc.period_month,
           t.name AS tenant_name, s.suite_number
    FROM match_proposals mp
    JOIN bank_transactions bt ON bt.id = mp.bank_transaction_id
    LEFT JOIN rent_charges rc ON rc.id = mp.rent_charge_id
    LEFT JOIN leases l ON l.id = mp.lease_id
    LEFT JOIN tenants t ON t.id = l.tenant_id
    LEFT JOIN suites s ON s.id = l.suite_id
    WHERE mp.status = 'proposed'
      AND rc.building_id = ?
    ORDER BY mp.confidence DESC
  `).all(buildingId) as any[];

  const arrears = charges.filter((c: any) => c.status !== 'paid' && c.status !== 'void');
  const totalArrears = arrears.reduce((s: number, c: any) => s + (c.amount_cents - c.paid_cents), 0);

  res.render('receivables', { building, buildingId, tab, charges, receipts, proposals, arrears, totalArrears });
});

app.get('/reports/miscoding-review', (req, res) => {
  const buildingId = Number(req.query.building ?? 0);
  const year = Number(req.query.year ?? 2026);
  const period = Number(req.query.period ?? 6);

  // Lines coded differently from vendor norm
  const unusualRows = db.prepare(`
    SELECT il.id AS line_id, il.description, il.amount_cents, il.gl_account_id,
           g.code AS line_code, g.name AS line_acct_name,
           i.id AS invoice_id, i.invoice_number, i.invoice_date, i.status,
           v.name AS vendor_name, v.id AS vendor_id, v.default_gl_account_id,
           dg.code AS default_code, b.name AS building_name
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    JOIN vendors v ON v.id = i.vendor_id
    JOIN gl_accounts g ON g.id = il.gl_account_id
    LEFT JOIN gl_accounts dg ON dg.id = v.default_gl_account_id
    JOIN buildings b ON b.id = i.building_id
    WHERE (? = 0 OR i.building_id = ?)
      AND CAST(strftime('%Y', i.invoice_date) AS INTEGER) = ?
      AND CAST(strftime('%m', i.invoice_date) AS INTEGER) = ?
      AND v.default_gl_account_id IS NOT NULL
      AND il.gl_account_id != v.default_gl_account_id
    ORDER BY i.invoice_date DESC
  `).all(buildingId, buildingId, year, period) as any[];

  // Lines that pushed an account materially over budget (>10%)
  const overBudgetRows = db.prepare(`
    SELECT il.id AS line_id, il.description, il.amount_cents, il.gl_account_id,
           g.code AS line_code, g.name AS line_acct_name,
           i.id AS invoice_id, i.invoice_number, i.invoice_date,
           v.name AS vendor_name, b.name AS building_name,
           bva.budget_cents, bva.actual_cents
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    JOIN vendors v ON v.id = i.vendor_id
    JOIN gl_accounts g ON g.id = il.gl_account_id
    JOIN buildings b ON b.id = i.building_id
    JOIN v_budget_vs_actual bva ON bva.building_id = i.building_id
      AND bva.gl_account_id = il.gl_account_id AND bva.fiscal_year = ?
      AND bva.period = CAST(strftime('%m', i.invoice_date) AS INTEGER)
    WHERE (? = 0 OR i.building_id = ?)
      AND CAST(strftime('%Y', i.invoice_date) AS INTEGER) = ?
      AND CAST(strftime('%m', i.invoice_date) AS INTEGER) = ?
      AND bva.actual_cents > bva.budget_cents
      AND (bva.actual_cents - bva.budget_cents) * 100 / bva.budget_cents > 10
    ORDER BY (bva.actual_cents - bva.budget_cents) DESC
  `).all(year, buildingId, buildingId, year, period) as any[];

  res.render('reports-miscoding-review', { buildingId, year, period, unusualRows, overBudgetRows });
});

app.get('/reports/owner-statement', (req, res) => {
  const entityId = Number(req.query.entity ?? 0);
  const year = Number(req.query.year ?? 2026);
  const period = Number(req.query.period ?? 6);

  const entities = db.prepare('SELECT * FROM entities ORDER BY name').all() as any[];
  const entity = entityId ? db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId) as any : null;

  if (!entity) return res.render('reports-owner-statement', { entities, entity: null, rows: [], year, period, totalBudget: 0, totalActual: 0 });

  const owned = db.prepare(`
    SELECT bo.ownership_bps, b.id AS building_id, b.name AS building_name
    FROM building_ownership bo JOIN buildings b ON b.id = bo.building_id
    WHERE bo.entity_id = ? ORDER BY b.name
  `).all(entityId) as any[];

  const rows: any[] = [];
  let totalBudget = 0, totalActual = 0;
  for (const ob of owned) {
    const bva = db.prepare(
      'SELECT COALESCE(SUM(budget_cents),0) AS b, COALESCE(SUM(actual_cents),0) AS a FROM v_budget_vs_actual WHERE building_id = ? AND fiscal_year = ? AND period = ?'
    ).get(ob.building_id, year, period) as any;
    const share = ob.ownership_bps / 10000;
    const bud = Math.round(bva.b * share);
    const act = Math.round(bva.a * share);
    rows.push({
      building_name: ob.building_name, building_id: ob.building_id,
      ownership_pct: (ob.ownership_bps / 100).toFixed(0),
      budget_cents: bud, actual_cents: act, variance_cents: act - bud,
    });
    totalBudget += bud;
    totalActual += act;
  }

  res.render('reports-owner-statement', { entities, entity, rows, year, period, totalBudget, totalActual });
});

// One router per domain. Add: leasing, vendors, capital, investor.
app.use('/api', reports);
app.use('/api/ap', ap);
app.use('/api/receivables', receivables);

const port = Number(process.env.PORT ?? 4010);
app.listen(port, () => console.log(`[commercial-pm] http://localhost:${port}`));
