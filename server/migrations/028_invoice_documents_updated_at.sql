-- Add updated_at column to invoice_documents table
ALTER TABLE invoice_documents ADD COLUMN updated_at TEXT;
UPDATE invoice_documents SET updated_at = created_at WHERE updated_at IS NULL;