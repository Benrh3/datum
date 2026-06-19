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
