import Anthropic from '@anthropic-ai/sdk';

export interface ExtractedLine {
  description: string;
  amount_cents: number;
  suggested_code?: string;
  confidence?: number;
}

export interface ExtractedInvoice {
  vendor: string;
  invoice_number?: string;
  date?: string;
  total_cents: number;
  lines: ExtractedLine[];
}

const PROMPT = `Extract invoice data from this document. Return ONLY valid JSON, no markdown fences, no commentary. Use this exact schema:
{
  "vendor": "vendor name as printed",
  "invoice_number": "invoice number or null",
  "date": "YYYY-MM-DD or null",
  "total_cents": <total amount in integer cents, e.g. $1,234.56 = 123456>,
  "lines": [
    {
      "description": "line item description",
      "amount_cents": <line amount in integer cents>,
      "suggested_code": "GL account code if you can infer one, or null",
      "confidence": <0-100 confidence in the suggested_code, or null>
    }
  ]
}
All monetary amounts MUST be integer cents (multiply dollars by 100). Return ONLY the JSON object.`;

export async function readInvoice(fileBuffer: Buffer, mediaType: string): Promise<ExtractedInvoice> {
  const client = new Anthropic();
  const data = fileBuffer.toString('base64');

  const isPdf = mediaType === 'application/pdf';
  const contentBlock = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: mediaType as 'application/pdf', data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/png', data } };

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        contentBlock,
        { type: 'text', text: PROMPT },
      ],
    }],
  });

  const text = response.content.find(b => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('No text in reader response');

  let raw = text.text.trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Reader returned invalid JSON: ' + raw.slice(0, 200));
  }

  const toCents = (v: any): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return n < 500 && n !== Math.floor(n) ? Math.round(n * 100) : Math.round(n);
  };

  return {
    vendor: String(parsed.vendor ?? ''),
    invoice_number: parsed.invoice_number ?? undefined,
    date: parsed.date ?? undefined,
    total_cents: toCents(parsed.total_cents),
    lines: Array.isArray(parsed.lines)
      ? parsed.lines.map((l: any) => ({
          description: String(l.description ?? ''),
          amount_cents: toCents(l.amount_cents),
          suggested_code: l.suggested_code ?? undefined,
          confidence: l.confidence != null ? Number(l.confidence) : undefined,
        }))
      : [],
  };
}
