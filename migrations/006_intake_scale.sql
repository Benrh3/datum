-- Intake at scale: dedup via content hash, email ingestion via Gmail message ID.
PRAGMA foreign_keys = ON;

ALTER TABLE invoice_imports ADD COLUMN content_hash TEXT;
ALTER TABLE invoice_imports ADD COLUMN gmail_message_id TEXT;
