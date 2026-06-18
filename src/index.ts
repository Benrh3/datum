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
  if (!invoice) return res.render('ap-review', { building, queue, selectedId, invoice: null, lines: [], gates: [], approvals: [], importInfo: null, rules: [] });

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

  // Approval chain — generated from rules, merged with persisted decisions
  const approvals = buildChainFromRules(selectedId, invoice.total_cents, buildingId, invoice.invoice_date);

  // Active rules for the rulenote
  const rules = db.prepare(`
    SELECT ar.trigger_type, ar.min_amount_cents, r.name AS role_name
    FROM approval_rules ar JOIN roles r ON r.id = ar.required_role_id
    WHERE ar.active = 1 AND (ar.scope = 'all' OR (ar.scope = 'building' AND ar.building_id = ?))
    ORDER BY r.rank
  `).all(buildingId) as any[];

  res.render('ap-review', { building, queue, selectedId, invoice, lines, gates, approvals, importInfo, rules });
});

// One router per domain. Add: ap, leasing, vendors, capital, investor.
app.use('/api', reports);

const port = Number(process.env.PORT ?? 4010);
app.listen(port, () => console.log(`[commercial-pm] http://localhost:${port}`));
