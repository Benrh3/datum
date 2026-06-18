// Invoice reader (stub). Production: send the PDF/image to Claude's API (reads
// documents natively), parse structured JSON, suggest a G/L code + confidence
// per line. A human always approves — AP requires that control. Set
// ANTHROPIC_API_KEY in .env before building this (see CLAUDE.md, phase 3).
export interface ExtractedLine { description: string; amountCents: number; suggestedCode?: string; confidence?: number; }
export interface ExtractedInvoice { vendor: string; invoiceNumber?: string; date?: string; totalCents: number; lines: ExtractedLine[]; }

export async function readInvoice(_file: Buffer, _mediaType: string): Promise<ExtractedInvoice> {
  throw new Error('reader not implemented — see CLAUDE.md "build order", phase 3');
}
