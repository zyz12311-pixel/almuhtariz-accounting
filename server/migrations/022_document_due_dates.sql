ALTER TABLE invoices ADD COLUMN due_date TEXT;
ALTER TABLE invoices ADD COLUMN payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK(payment_terms_days>=0 AND payment_terms_days<=3650);
ALTER TABLE purchases ADD COLUMN due_date TEXT;
ALTER TABLE purchases ADD COLUMN payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK(payment_terms_days>=0 AND payment_terms_days<=3650);
CREATE INDEX IF NOT EXISTS invoices_due_date ON invoices(due_date,party_id,status,payment);
CREATE INDEX IF NOT EXISTS purchases_due_date ON purchases(due_date,supplier_id,payment,kind);
DROP VIEW IF EXISTS settlement_documents;
CREATE VIEW settlement_documents AS
 SELECT 'invoice' source,i.id,i.number,COALESCE(i.due_date,i.issue_date) document_date,i.due_date,i.party_id,'1201' party_account,i.total,
 i.total-COALESCE((SELECT SUM(r.total) FROM invoices r WHERE r.ref_invoice_id=i.id AND r.type='381' AND r.status='issued'),0) net,
 i.total-COALESCE((SELECT SUM(r.total) FROM invoices r WHERE r.ref_invoice_id=i.id AND r.type='381' AND r.status='issued'),0)-COALESCE((SELECT SUM(CASE v.kind WHEN 'receipt' THEN a.amount ELSE -a.amount END) FROM voucher_allocations a JOIN cash_vouchers v ON v.id=a.voucher_id WHERE a.invoice_id=i.id),0) open_due
 FROM invoices i WHERE i.status='issued' AND i.type='388' AND i.payment='credit'
 UNION ALL
 SELECT 'purchase',p.id,p.number,COALESCE(p.due_date,p.document_date) document_date,p.due_date,p.supplier_id,'2101',p.total,
 p.total-COALESCE((SELECT SUM(r.total) FROM purchases r WHERE r.ref_purchase_id=p.id AND r.kind='return'),0),
 p.total-COALESCE((SELECT SUM(r.total) FROM purchases r WHERE r.ref_purchase_id=p.id AND r.kind='return'),0)-COALESCE((SELECT SUM(CASE v.kind WHEN 'payment' THEN a.amount ELSE -a.amount END) FROM voucher_allocations a JOIN cash_vouchers v ON v.id=a.voucher_id WHERE a.purchase_id=p.id),0)
 FROM purchases p WHERE p.kind='purchase' AND p.payment='credit';
UPDATE local_meta SET value='22' WHERE key='schema_version';
