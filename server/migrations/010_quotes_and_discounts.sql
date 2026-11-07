ALTER TABLE invoice_lines ADD COLUMN list_price INTEGER CHECK(list_price>=0);
ALTER TABLE invoice_lines ADD COLUMN discount_rate INTEGER NOT NULL DEFAULT 0 CHECK(discount_rate BETWEEN 0 AND 10000);
CREATE TABLE quotations(
 id INTEGER PRIMARY KEY,number TEXT NOT NULL UNIQUE,party_id INTEGER REFERENCES parties(id),pos_id INTEGER NOT NULL REFERENCES pos_points(id),
 document_date TEXT NOT NULL,valid_until TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','cancelled')),
 lines TEXT NOT NULL,subtotal INTEGER NOT NULL CHECK(subtotal>=0),vat INTEGER NOT NULL CHECK(vat>=0),total INTEGER NOT NULL CHECK(total=subtotal+vat AND total>0),
 notes TEXT NOT NULL,company_snapshot TEXT NOT NULL,party_snapshot TEXT,created_by INTEGER NOT NULL REFERENCES users(id),
 invoice_id INTEGER UNIQUE REFERENCES invoices(id),request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER quote_transition BEFORE UPDATE ON quotations WHEN OLD.status!='open' OR NEW.status NOT IN ('accepted','cancelled') OR NEW.id!=OLD.id OR NEW.number!=OLD.number OR NEW.party_id IS NOT OLD.party_id OR NEW.pos_id!=OLD.pos_id OR NEW.document_date!=OLD.document_date OR NEW.valid_until!=OLD.valid_until OR NEW.lines!=OLD.lines OR NEW.subtotal!=OLD.subtotal OR NEW.vat!=OLD.vat OR NEW.total!=OLD.total OR NEW.notes!=OLD.notes OR NEW.company_snapshot!=OLD.company_snapshot OR NEW.party_snapshot IS NOT OLD.party_snapshot OR NEW.created_by!=OLD.created_by OR NEW.created_at!=OLD.created_at OR NEW.request_id!=OLD.request_id OR NEW.request_hash!=OLD.request_hash OR (NEW.status='accepted' AND NEW.invoice_id IS NULL) OR (NEW.status='cancelled' AND NEW.invoice_id IS NOT NULL) BEGIN SELECT RAISE(ABORT,'عرض السعر ثابت؛ أنشئ عرضًا جديدًا للتعديل');END;
CREATE TRIGGER quote_no_delete BEFORE DELETE ON quotations BEGIN SELECT RAISE(ABORT,'عرض السعر ثابت');END;
CREATE TABLE journal_reversals(original_id INTEGER PRIMARY KEY REFERENCES journal_entries(id),reversal_id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id));
CREATE TRIGGER reversal_no_update BEFORE UPDATE ON journal_reversals BEGIN SELECT RAISE(ABORT,'عكس القيد ثابت');END;
CREATE TRIGGER reversal_no_delete BEFORE DELETE ON journal_reversals BEGIN SELECT RAISE(ABORT,'عكس القيد ثابت');END;
UPDATE local_meta SET value='10' WHERE key='schema_version';
