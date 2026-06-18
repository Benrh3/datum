import { Router } from 'express';
import multer from 'multer';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from '../db.js';
import { readInvoice } from '../reader.js';

const here = dirname(fileURLToPath(import.meta.url));
const uploadsDir = join(here, '../../data/uploads');
mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

export const ap = Router();

ap.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded or unsupported type' });
    const buildingId = Number(req.body.building ?? 1);

    const buf = readFileSync(file.path);
    const extracted = await readInvoice(buf, file.mimetype);

    // Match vendor via match_aliases
    const vendors = db.prepare('SELECT * FROM vendors').all() as any[];
    let matchedVendor: any = null;
    const extractedName = extracted.vendor.toLowerCase();
    for (const v of vendors) {
      if (v.name.toLowerCase() === extractedName) { matchedVendor = v; break; }
      if (v.match_aliases) {
        try {
          const aliases: string[] = JSON.parse(v.match_aliases);
          if (aliases.some(a => a.toLowerCase() === extractedName)) { matchedVendor = v; break; }
        } catch {}
      }
    }

    const invoiceDate = extracted.date || new Date().toISOString().split('T')[0];

    // Create import record
    const importResult = db.prepare(`
      INSERT INTO invoice_imports (source, source_ref, received_at, matched_vendor_id, confidence, status)
      VALUES ('upload', ?, ?, ?, ?, 'received')
    `).run(
      file.originalname,
      new Date().toISOString(),
      matchedVendor?.id ?? null,
      Math.round(extracted.lines.reduce((s, l) => s + (l.confidence ?? 0), 0) / Math.max(extracted.lines.length, 1)),
    );
    const importId = importResult.lastInsertRowid;

    // Create draft invoice — never beyond 'coded'
    const vendorId = matchedVendor?.id ?? vendors[0]?.id ?? 1;
    const invoiceResult = db.prepare(`
      INSERT INTO invoices (vendor_id, building_id, invoice_number, invoice_date, total_cents, status, source, import_id)
      VALUES (?, ?, ?, ?, ?, 'coded', 'upload', ?)
    `).run(vendorId, buildingId, extracted.invoice_number ?? null, invoiceDate, extracted.total_cents, importId);
    const invoiceId = invoiceResult.lastInsertRowid;

    // Create invoice lines
    const insertLine = db.prepare(`
      INSERT INTO invoice_lines (invoice_id, gl_account_id, description, amount_cents, coding_source, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const line of extracted.lines) {
      let glAccountId: number | null = null;
      let codingSource = 'manual';
      let confidence: number | null = null;

      if (line.suggested_code) {
        const acct = db.prepare('SELECT id FROM gl_accounts WHERE code = ? AND is_postable = 1').get(line.suggested_code) as any;
        if (acct) {
          glAccountId = acct.id;
          codingSource = 'ai_suggested';
          confidence = line.confidence ?? null;
        }
      }
      if (!glAccountId && matchedVendor?.default_gl_account_id) {
        glAccountId = matchedVendor.default_gl_account_id;
        codingSource = 'vendor_default';
      }
      if (!glAccountId) {
        const fallback = db.prepare("SELECT id FROM gl_accounts WHERE is_postable = 1 ORDER BY sort_order LIMIT 1").get() as any;
        glAccountId = fallback?.id ?? 11;
      }

      insertLine.run(invoiceId, glAccountId, line.description, line.amount_cents, codingSource, confidence);
    }

    // Reconciliation: flag if line amounts don't sum to total
    const lineSum = extracted.lines.reduce((s, l) => s + l.amount_cents, 0);
    const reconOk = lineSum === extracted.total_cents;
    const reconNote = reconOk ? null
      : 'Line amounts sum to $' + (lineSum / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
        + ' but invoice total is $' + (extracted.total_cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });

    // Update import record
    db.prepare(`
      UPDATE invoice_imports SET status = 'needs_review', invoice_id = ?, extracted_json = ?, note = ? WHERE id = ?
    `).run(invoiceId, JSON.stringify(extracted), reconNote, importId);

    // Generate approvals from rules
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
    const invMonth = parseInt(invoiceDate.split('-')[1], 10);
    const invYear = parseInt(invoiceDate.split('-')[0], 10);
    const hasBudgetOverrun = !!db.prepare(`
      SELECT 1 FROM invoice_lines il
      JOIN v_budget_vs_actual v ON v.gl_account_id = il.gl_account_id
        AND v.building_id = ? AND v.fiscal_year = ? AND v.period = ?
      WHERE il.invoice_id = ? AND v.actual_cents > v.budget_cents LIMIT 1
    `).get(buildingId, invYear, invMonth, invoiceId);

    const rules = db.prepare(`
      SELECT ar.*, r.rank AS role_rank
      FROM approval_rules ar JOIN roles r ON r.id = ar.required_role_id
      WHERE ar.active = 1 AND (ar.scope = 'all' OR (ar.scope = 'building' AND ar.building_id = ?))
      ORDER BY r.rank
    `).all(buildingId) as any[];

    const requiredRoles = new Set<number>();
    for (const rule of rules) {
      if (rule.trigger_type === 'always') requiredRoles.add(rule.required_role_id);
      else if (rule.trigger_type === 'amount' && rule.min_amount_cents != null && extracted.total_cents >= rule.min_amount_cents)
        requiredRoles.add(rule.required_role_id);
      else if (rule.trigger_type === 'budget_overrun' && hasBudgetOverrun)
        requiredRoles.add(rule.required_role_id);
    }

    const insertApproval = db.prepare(
      'INSERT INTO approvals (invoice_id, user_id, step_order, status) VALUES (?, ?, ?, ?)'
    );
    let step = 1;
    for (const roleId of requiredRoles) {
      const user = db.prepare('SELECT id FROM users WHERE role_id = ? LIMIT 1').get(roleId) as any;
      if (user) {
        insertApproval.run(invoiceId, user.id, step, step === 1 ? 'pending' : 'queued');
        step++;
      }
    }

    const warnings: string[] = [];
    if (!matchedVendor) warnings.push('Vendor "' + extracted.vendor + '" not matched — assigned to ' + (vendors[0]?.name ?? 'default'));
    if (!reconOk) warnings.push(reconNote!);

    res.json({ ok: true, invoice_id: Number(invoiceId), warnings });
  } catch (err: any) {
    console.error('[ap/upload]', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});
