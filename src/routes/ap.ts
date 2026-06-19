import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from '../db.js';
import { readInvoice, type ExtractedInvoice } from '../reader.js';

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

interface FileResult {
  filename: string;
  ok: boolean;
  invoice_id?: number;
  duplicate_of?: number;
  warnings: string[];
  error?: string;
}

function matchVendor(name: string) {
  const vendors = db.prepare('SELECT * FROM vendors').all() as any[];
  const lower = name.toLowerCase();
  for (const v of vendors) {
    if (v.name.toLowerCase() === lower) return { vendor: v, vendors };
    if (v.match_aliases) {
      try {
        const aliases: string[] = JSON.parse(v.match_aliases);
        if (aliases.some((a: string) => a.toLowerCase() === lower)) return { vendor: v, vendors };
      } catch {}
    }
  }
  return { vendor: null, vendors };
}

function checkDedup(contentHash: string, vendorId: number | null, invoiceNumber: string | undefined, totalCents: number) {
  if (contentHash) {
    const byHash = db.prepare(
      "SELECT id, invoice_id FROM invoice_imports WHERE content_hash = ? AND status != 'rejected' LIMIT 1"
    ).get(contentHash) as any;
    if (byHash) return byHash;
  }
  if (vendorId && invoiceNumber) {
    const byFields = db.prepare(
      "SELECT ii.id, ii.invoice_id FROM invoice_imports ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.vendor_id = ? AND i.invoice_number = ? AND i.total_cents = ? LIMIT 1"
    ).get(vendorId, invoiceNumber, totalCents) as any;
    if (byFields) return byFields;
  }
  return null;
}

function generateApprovals(invoiceId: number, totalCents: number, buildingId: number, invoiceDate: string) {
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
    else if (rule.trigger_type === 'amount' && rule.min_amount_cents != null && totalCents >= rule.min_amount_cents)
      requiredRoles.add(rule.required_role_id);
    else if (rule.trigger_type === 'budget_overrun' && hasBudgetOverrun)
      requiredRoles.add(rule.required_role_id);
  }

  const ins = db.prepare('INSERT INTO approvals (invoice_id, user_id, step_order, status) VALUES (?, ?, ?, ?)');
  let step = 1;
  for (const roleId of requiredRoles) {
    const user = db.prepare('SELECT id FROM users WHERE role_id = ? LIMIT 1').get(roleId) as any;
    if (user) {
      ins.run(invoiceId, user.id, step, step === 1 ? 'pending' : 'queued');
      step++;
    }
  }
}

async function processFile(
  buf: Buffer,
  filename: string,
  mimetype: string,
  buildingId: number,
  source: 'upload' | 'email',
  gmailMessageId?: string,
): Promise<FileResult> {
  const warnings: string[] = [];
  const contentHash = createHash('sha256').update(buf).digest('hex');

  let extracted: ExtractedInvoice;
  try {
    extracted = await readInvoice(buf, mimetype);
  } catch (err: any) {
    return { filename, ok: false, warnings: [], error: err.message || 'Extraction failed' };
  }

  const { vendor: matchedVendor, vendors } = matchVendor(extracted.vendor);
  const vendorId = matchedVendor?.id ?? vendors[0]?.id ?? 1;
  if (!matchedVendor) warnings.push('Vendor "' + extracted.vendor + '" not matched — assigned to ' + (vendors[0]?.name ?? 'default'));

  const dup = checkDedup(contentHash, vendorId, extracted.invoice_number, extracted.total_cents);
  if (dup) {
    db.prepare(`
      INSERT INTO invoice_imports (source, source_ref, received_at, matched_vendor_id, content_hash, gmail_message_id, confidence, status, invoice_id, note)
      VALUES (?, ?, ?, ?, ?, ?, 0, 'rejected', ?, 'Possible duplicate of import #' || ?)
    `).run(source, filename, new Date().toISOString(), matchedVendor?.id ?? null, contentHash, gmailMessageId ?? null, dup.invoice_id, dup.id);
    return { filename, ok: true, duplicate_of: dup.invoice_id, warnings: ['Possible duplicate — linked to existing import #' + dup.id] };
  }

  const invoiceDate = extracted.date || new Date().toISOString().split('T')[0];
  const avgConf = Math.round(extracted.lines.reduce((s, l) => s + (l.confidence ?? 0), 0) / Math.max(extracted.lines.length, 1));

  const importResult = db.prepare(`
    INSERT INTO invoice_imports (source, source_ref, received_at, matched_vendor_id, content_hash, gmail_message_id, confidence, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'received')
  `).run(source, filename, new Date().toISOString(), matchedVendor?.id ?? null, contentHash, gmailMessageId ?? null, avgConf);
  const importId = importResult.lastInsertRowid;

  const invoiceResult = db.prepare(`
    INSERT INTO invoices (vendor_id, building_id, invoice_number, invoice_date, total_cents, status, source, import_id)
    VALUES (?, ?, ?, ?, ?, 'coded', ?, ?)
  `).run(vendorId, buildingId, extracted.invoice_number ?? null, invoiceDate, extracted.total_cents, source, importId);
  const invoiceId = Number(invoiceResult.lastInsertRowid);

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
      if (acct) { glAccountId = acct.id; codingSource = 'ai_suggested'; confidence = line.confidence ?? null; }
    }
    if (!glAccountId && matchedVendor?.default_gl_account_id) {
      glAccountId = matchedVendor.default_gl_account_id; codingSource = 'vendor_default';
    }
    if (!glAccountId) {
      const fb = db.prepare("SELECT id FROM gl_accounts WHERE is_postable = 1 ORDER BY sort_order LIMIT 1").get() as any;
      glAccountId = fb?.id ?? 11;
    }
    insertLine.run(invoiceId, glAccountId, line.description, line.amount_cents, codingSource, confidence);
  }

  const lineSum = extracted.lines.reduce((s, l) => s + l.amount_cents, 0);
  const reconOk = lineSum === extracted.total_cents;
  const reconNote = reconOk ? null
    : 'Line amounts sum to $' + (lineSum / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
      + ' but invoice total is $' + (extracted.total_cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (!reconOk) warnings.push(reconNote!);

  db.prepare(
    'UPDATE invoice_imports SET status = ?, invoice_id = ?, extracted_json = ?, note = ? WHERE id = ?'
  ).run('needs_review', invoiceId, JSON.stringify(extracted), reconNote, importId);

  generateApprovals(invoiceId, extracted.total_cents, buildingId, invoiceDate);

  return { filename, ok: true, invoice_id: invoiceId, warnings };
}

// Single-file upload (backward compat)
ap.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded or unsupported type' });
    const buildingId = Number(req.body.building ?? 1);
    const buf = readFileSync(file.path);
    const result = await processFile(buf, file.originalname, file.mimetype, buildingId, 'upload');
    if (!result.ok) return res.status(500).json({ error: result.error });
    res.json({ ok: true, invoice_id: result.invoice_id, duplicate_of: result.duplicate_of, warnings: result.warnings });
  } catch (err: any) {
    console.error('[ap/upload]', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// Multi-file upload
ap.post('/upload-batch', upload.array('files', 20), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
    const buildingId = Number(req.body.building ?? 1);

    const results: FileResult[] = [];
    for (const file of files) {
      const buf = readFileSync(file.path);
      results.push(await processFile(buf, file.originalname, file.mimetype, buildingId, 'upload'));
    }
    res.json({ ok: true, results });
  } catch (err: any) {
    console.error('[ap/upload-batch]', err);
    res.status(500).json({ error: err.message || 'Batch upload failed' });
  }
});

// Email ingestion — called by a Gmail watch webhook or a cron sweep
ap.post('/ingest-email', async (req, res) => {
  try {
    const { gmail_message_id, filename, data, media_type, building } = req.body;
    if (!data || !media_type) return res.status(400).json({ error: 'Missing data or media_type' });

    if (gmail_message_id) {
      const existing = db.prepare("SELECT id FROM invoice_imports WHERE gmail_message_id = ? LIMIT 1").get(gmail_message_id);
      if (existing) return res.json({ ok: true, skipped: true, reason: 'Already ingested' });
    }

    const buf = Buffer.from(data, 'base64');
    const buildingId = Number(building ?? 1);
    const result = await processFile(buf, filename || gmail_message_id || 'email-attachment', media_type, buildingId, 'email', gmail_message_id);

    if (!result.ok) return res.status(500).json({ error: result.error });
    res.json({ ok: true, invoice_id: result.invoice_id, duplicate_of: result.duplicate_of, warnings: result.warnings });
  } catch (err: any) {
    console.error('[ap/ingest-email]', err);
    res.status(500).json({ error: err.message || 'Email ingestion failed' });
  }
});

// Reclassify an invoice line to a different GL code
ap.post('/reclass', (req, res) => {
  try {
    const { line_id, to_gl_code, reason, user_id } = req.body;
    if (!line_id || !to_gl_code || !reason) return res.status(400).json({ error: 'line_id, to_gl_code, and reason are required' });

    const line = db.prepare(`
      SELECT il.*, i.status AS invoice_status, i.building_id, i.id AS invoice_id, g.code AS from_code
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      JOIN gl_accounts g ON g.id = il.gl_account_id
      WHERE il.id = ?
    `).get(line_id) as any;
    if (!line) return res.status(404).json({ error: 'Line not found' });

    const toAcct = db.prepare('SELECT id, code FROM gl_accounts WHERE code = ? AND is_postable = 1').get(to_gl_code) as any;
    if (!toAcct) return res.status(400).json({ error: 'GL code ' + to_gl_code + ' not found or not postable' });
    if (toAcct.id === line.gl_account_id) return res.status(400).json({ error: 'Already coded to ' + to_gl_code });

    const isDraft = line.invoice_status === 'entered' || line.invoice_status === 'coded';

    if (isDraft) {
      db.prepare('UPDATE invoice_lines SET gl_account_id = ?, coding_source = ? WHERE id = ?')
        .run(toAcct.id, 'manual', line_id);
      db.prepare(`INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id)
        VALUES ('invoice_lines', ?, 'reclass_draft', ?, ?, ?)`).run(
        line_id,
        JSON.stringify({ gl_account_id: line.gl_account_id, code: line.from_code }),
        JSON.stringify({ gl_account_id: toAcct.id, code: to_gl_code }),
        user_id ?? null,
      );
      res.json({ ok: true, method: 'draft_edit' });
    } else {
      const reclass = db.prepare(`
        INSERT INTO reclassifications (invoice_line_id, invoice_id, from_gl_account_id, to_gl_account_id, amount_cents, reason, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(line.id, line.invoice_id, line.gl_account_id, toAcct.id, line.amount_cents, reason, user_id ?? null);
      const reclassId = Number(reclass.lastInsertRowid);

      db.prepare(`INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, user_id)
        VALUES ('reclassifications', ?, 'reclass_posted', ?, ?, ?)`).run(
        reclassId,
        JSON.stringify({ gl_account_id: line.gl_account_id, code: line.from_code }),
        JSON.stringify({ gl_account_id: toAcct.id, code: to_gl_code, reason }),
        user_id ?? null,
      );

      let transfer_needed = false;
      // TODO: cross-building reclass detection — when a line is recoded to an
      // account that belongs to a different building or entity, spawn an
      // inter_account_transfer and link it to this reclassification.

      res.json({ ok: true, method: 'reclass_entry', reclass_id: reclassId, transfer_needed });
    }
  } catch (err: any) {
    console.error('[ap/reclass]', err);
    res.status(500).json({ error: err.message || 'Reclassification failed' });
  }
});

// Budget swing for a proposed reclass: what happens to both accounts
ap.get('/budget-swing', (req, res) => {
  try {
    const lineId = Number(req.query.line_id);
    const toCode = String(req.query.to_gl_code ?? '');
    if (!lineId || !toCode) return res.status(400).json({ error: 'line_id and to_gl_code required' });

    const line = db.prepare(`
      SELECT il.*, i.building_id, i.invoice_date, g.code AS from_code, g.name AS from_name
      FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
      JOIN gl_accounts g ON g.id = il.gl_account_id WHERE il.id = ?
    `).get(lineId) as any;
    if (!line) return res.status(404).json({ error: 'Line not found' });

    const toAcct = db.prepare('SELECT id, code, name FROM gl_accounts WHERE code = ? AND is_postable = 1').get(toCode) as any;
    if (!toAcct) return res.status(400).json({ error: 'GL code not found' });

    const m = parseInt(line.invoice_date.split('-')[1], 10);
    const y = parseInt(line.invoice_date.split('-')[0], 10);

    function getVariance(acctId: number) {
      const bva = db.prepare(
        'SELECT budget_cents, actual_cents FROM v_budget_vs_actual WHERE building_id = ? AND gl_account_id = ? AND fiscal_year = ? AND period = ?'
      ).get(line.building_id, acctId, y, m) as any;
      return bva ? { budget: bva.budget_cents, actual: bva.actual_cents, variance: bva.actual_cents - bva.budget_cents } : null;
    }

    const fromBefore = getVariance(line.gl_account_id);
    const toBefore = getVariance(toAcct.id);
    const amt = line.amount_cents;

    res.json({
      amount_cents: amt,
      from: { code: line.from_code, name: line.from_name,
        before: fromBefore, after: fromBefore ? { ...fromBefore, actual: fromBefore.actual - amt, variance: fromBefore.variance - amt } : null },
      to: { code: toAcct.code, name: toAcct.name,
        before: toBefore, after: toBefore ? { ...toBefore, actual: toBefore.actual + amt, variance: toBefore.variance + amt } : null },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Unusual-code warning: check if a line's code deviates from vendor history
ap.get('/unusual-code', (req, res) => {
  try {
    const invoiceId = Number(req.query.invoice_id);
    if (!invoiceId) return res.status(400).json({ error: 'invoice_id required' });

    const invoice = db.prepare('SELECT vendor_id FROM invoices WHERE id = ?').get(invoiceId) as any;
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const history = db.prepare(`
      SELECT il.gl_account_id, g.code, COUNT(*) AS cnt
      FROM invoice_lines il
      JOIN invoices i ON i.id = il.invoice_id
      JOIN gl_accounts g ON g.id = il.gl_account_id
      WHERE i.vendor_id = ? AND i.id != ?
      GROUP BY il.gl_account_id ORDER BY cnt DESC
    `).all(invoice.vendor_id, invoiceId) as any[];
    const historyCodes = new Set(history.map((h: any) => h.gl_account_id));

    const lines = db.prepare(`
      SELECT il.id, il.gl_account_id, g.code, g.name
      FROM invoice_lines il JOIN gl_accounts g ON g.id = il.gl_account_id
      WHERE il.invoice_id = ?
    `).all(invoiceId) as any[];

    const unusual = lines
      .filter((l: any) => historyCodes.size > 0 && !historyCodes.has(l.gl_account_id))
      .map((l: any) => ({ line_id: l.id, code: l.code, name: l.name, vendor_usual: history.slice(0, 3).map((h: any) => h.code) }));

    res.json({ unusual });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reclassification history for an invoice
ap.get('/reclass-history', (req, res) => {
  try {
    const invoiceId = Number(req.query.invoice_id);
    if (!invoiceId) return res.status(400).json({ error: 'invoice_id required' });

    const rows = db.prepare(`
      SELECT r.*, gf.code AS from_code, gf.name AS from_name, gt.code AS to_code, gt.name AS to_name,
             u.name AS user_name
      FROM reclassifications r
      JOIN gl_accounts gf ON gf.id = r.from_gl_account_id
      JOIN gl_accounts gt ON gt.id = r.to_gl_account_id
      LEFT JOIN users u ON u.id = r.user_id
      ORDER BY r.created_at DESC
    `).all() as any[];

    res.json({ reclassifications: rows.filter((r: any) => r.invoice_id === invoiceId) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
