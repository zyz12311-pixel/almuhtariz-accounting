-- Date-first ledger aggregation; preserve earlier applied migrations.
CREATE INDEX journal_entries_by_date ON journal_entries(entry_date,id);
CREATE INDEX journal_lines_by_entry ON journal_lines(entry_id,account_code,debit,credit);
CREATE INDEX items_by_name ON items(name_ar,id);
CREATE INDEX invoices_by_status ON invoices(status,id);
UPDATE local_meta SET value='12' WHERE key='schema_version';
