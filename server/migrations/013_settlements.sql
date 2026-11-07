CREATE TABLE voucher_context(voucher_id INTEGER PRIMARY KEY REFERENCES cash_vouchers(id),party_account TEXT NOT NULL CHECK(party_account IN ('1201','2101')),party_snapshot TEXT NOT NULL,legacy_snapshot INTEGER NOT NULL DEFAULT 0 CHECK(legacy_snapshot IN (0,1)));
INSERT INTO voucher_context SELECT v.id,COALESCE((SELECT l.account_code FROM journal_lines l WHERE l.entry_id=v.journal_id AND l.account_code IN ('1201','2101') LIMIT 1),CASE v.kind WHEN 'receipt' THEN '1201' ELSE '2101' END),json_object('id',p.id,'name_ar',p.name_ar,'vat_number',p.vat_number,'address',p.address,'phone',p.phone),1 FROM cash_vouchers v JOIN parties p ON p.id=v.party_id;
CREATE TRIGGER voucher_context_fixed_update BEFORE UPDATE ON voucher_context BEGIN SELECT RAISE(ABORT,'سياق السند ثابت');END;
CREATE TRIGGER voucher_context_fixed_delete BEFORE DELETE ON voucher_context BEGIN SELECT RAISE(ABORT,'سياق السند ثابت');END;
CREATE TRIGGER voucher_context_matches BEFORE INSERT ON voucher_context WHEN NOT EXISTS(SELECT 1 FROM cash_vouchers v JOIN journal_lines l ON l.entry_id=v.journal_id JOIN journal_party_links x ON x.line_id=l.id WHERE v.id=NEW.voucher_id AND x.party_id=v.party_id AND l.account_code=NEW.party_account) BEGIN SELECT RAISE(ABORT,'حساب السند لا يطابق قيده');END;
CREATE TABLE allocation_batches(id INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,voucher_id INTEGER NOT NULL REFERENCES cash_vouchers(id),created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE voucher_allocations ADD COLUMN batch_id INTEGER REFERENCES allocation_batches(id);
CREATE INDEX allocations_by_voucher ON voucher_allocations(voucher_id);
CREATE INDEX allocations_by_invoice ON voucher_allocations(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX allocations_by_purchase ON voucher_allocations(purchase_id) WHERE purchase_id IS NOT NULL;
CREATE INDEX invoices_by_reference ON invoices(ref_invoice_id,type,status);
CREATE INDEX invoices_by_party ON invoices(party_id,payment,status,id);
CREATE INDEX purchases_by_reference ON purchases(ref_purchase_id,kind);
CREATE INDEX purchases_by_party ON purchases(supplier_id,payment,kind,id);
CREATE VIEW settlement_documents AS
 SELECT 'invoice' source,i.id,i.number,i.issue_date document_date,i.party_id,'1201' party_account,i.total,
 i.total-COALESCE((SELECT SUM(r.total) FROM invoices r WHERE r.ref_invoice_id=i.id AND r.type='381' AND r.status='issued'),0) net,
 i.total-COALESCE((SELECT SUM(r.total) FROM invoices r WHERE r.ref_invoice_id=i.id AND r.type='381' AND r.status='issued'),0)-COALESCE((SELECT SUM(CASE v.kind WHEN 'receipt' THEN a.amount ELSE -a.amount END) FROM voucher_allocations a JOIN cash_vouchers v ON v.id=a.voucher_id WHERE a.invoice_id=i.id),0) open_due
 FROM invoices i WHERE i.status='issued' AND i.type='388' AND i.payment='credit'
 UNION ALL
 SELECT 'purchase',p.id,p.number,p.document_date,p.supplier_id,'2101',p.total,
 p.total-COALESCE((SELECT SUM(r.total) FROM purchases r WHERE r.ref_purchase_id=p.id AND r.kind='return'),0),
 p.total-COALESCE((SELECT SUM(r.total) FROM purchases r WHERE r.ref_purchase_id=p.id AND r.kind='return'),0)-COALESCE((SELECT SUM(CASE v.kind WHEN 'payment' THEN a.amount ELSE -a.amount END) FROM voucher_allocations a JOIN cash_vouchers v ON v.id=a.voucher_id WHERE a.purchase_id=p.id),0)
 FROM purchases p WHERE p.kind='purchase' AND p.payment='credit';
CREATE TRIGGER allocation_guard BEFORE INSERT ON voucher_allocations WHEN
 NOT EXISTS(SELECT 1 FROM allocation_batches b WHERE b.id=NEW.batch_id AND b.voucher_id=NEW.voucher_id)
 OR NEW.amount+COALESCE((SELECT SUM(amount) FROM voucher_allocations WHERE voucher_id=NEW.voucher_id),0)>(SELECT amount FROM cash_vouchers WHERE id=NEW.voucher_id)
 OR NOT EXISTS(SELECT 1 FROM settlement_documents d JOIN cash_vouchers v ON v.id=NEW.voucher_id JOIN voucher_context c ON c.voucher_id=v.id WHERE d.source=CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' ELSE 'purchase' END AND d.id=COALESCE(NEW.invoice_id,NEW.purchase_id) AND d.party_id=v.party_id AND d.party_account=c.party_account AND NEW.amount<=d.open_due*CASE WHEN (c.party_account='1201' AND v.kind='receipt') OR (c.party_account='2101' AND v.kind='payment') THEN 1 ELSE -1 END)
 BEGIN SELECT RAISE(ABORT,'التخصيص يتجاوز السند أو المستند أو لا يطابق الطرف');END;
CREATE TRIGGER allocation_batch_fixed_update BEFORE UPDATE ON allocation_batches BEGIN SELECT RAISE(ABORT,'تخصيص السند ثابت');END;
CREATE TRIGGER allocation_batch_fixed_delete BEFORE DELETE ON allocation_batches BEGIN SELECT RAISE(ABORT,'تخصيص السند ثابت');END;
CREATE TABLE journal_reversal_requests(request_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,id INTEGER NOT NULL REFERENCES journal_entries(id));
CREATE TRIGGER reversal_request_fixed_update BEFORE UPDATE ON journal_reversal_requests BEGIN SELECT RAISE(ABORT,'طلب العكس ثابت');END;
CREATE TRIGGER reversal_request_fixed_delete BEFORE DELETE ON journal_reversal_requests BEGIN SELECT RAISE(ABORT,'طلب العكس ثابت');END;
UPDATE local_meta SET value='13' WHERE key='schema_version';
