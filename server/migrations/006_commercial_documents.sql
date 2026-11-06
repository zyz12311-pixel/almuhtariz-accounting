INSERT OR IGNORE INTO accounts(code,name_ar,type,postable) VALUES('1401','المخزون','asset',1);
CREATE TABLE purchases(
 id INTEGER PRIMARY KEY,uuid TEXT NOT NULL UNIQUE,number TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('purchase','return')),supplier_id INTEGER NOT NULL REFERENCES parties(id),
 supplier_reference TEXT NOT NULL,document_date TEXT NOT NULL,warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
 payment TEXT NOT NULL CHECK(payment IN ('cash','bank','credit')),ref_purchase_id INTEGER REFERENCES purchases(id),
 subtotal INTEGER NOT NULL CHECK(subtotal>=0),vat INTEGER NOT NULL CHECK(vat>=0),total INTEGER NOT NULL CHECK(total=subtotal+vat),
 reason TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',created_by INTEGER NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,journal_id INTEGER REFERENCES journal_entries(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((kind='return' AND ref_purchase_id IS NOT NULL) OR (kind='purchase' AND ref_purchase_id IS NULL))
);
CREATE UNIQUE INDEX purchase_supplier_reference ON purchases(supplier_id,supplier_reference) WHERE kind='purchase';
CREATE TABLE purchase_lines(
 purchase_id INTEGER NOT NULL REFERENCES purchases(id),line_no INTEGER NOT NULL,item_id INTEGER REFERENCES items(id),
 description TEXT NOT NULL,qty_micro INTEGER NOT NULL CHECK(qty_micro>0),unit_price INTEGER NOT NULL CHECK(unit_price>=0),
 vat_rate INTEGER NOT NULL CHECK(vat_rate IN (0,1500)),net INTEGER NOT NULL CHECK(net>=0),vat INTEGER NOT NULL CHECK(vat>=0),
 unit_name TEXT NOT NULL,unit_factor_micro INTEGER NOT NULL CHECK(unit_factor_micro>0),stock_qty_micro INTEGER NOT NULL CHECK(stock_qty_micro>=0),
 account_code TEXT NOT NULL REFERENCES accounts(code),PRIMARY KEY(purchase_id,line_no)
);
ALTER TABLE stock_movements ADD COLUMN purchase_id INTEGER REFERENCES purchases(id);
CREATE UNIQUE INDEX stock_purchase_line ON stock_movements(purchase_id,line_no) WHERE purchase_id IS NOT NULL;
CREATE TABLE journal_party_links(line_id INTEGER PRIMARY KEY REFERENCES journal_lines(id),party_id INTEGER NOT NULL REFERENCES parties(id));
CREATE INDEX journal_party_lookup ON journal_party_links(party_id,line_id);
CREATE TABLE cash_vouchers(
 id INTEGER PRIMARY KEY,number TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('receipt','payment')),
 party_id INTEGER NOT NULL REFERENCES parties(id),voucher_date TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),
 cash_account TEXT NOT NULL REFERENCES accounts(code),notes TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,journal_id INTEGER NOT NULL REFERENCES journal_entries(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE voucher_allocations(
 voucher_id INTEGER NOT NULL REFERENCES cash_vouchers(id),invoice_id INTEGER REFERENCES invoices(id),purchase_id INTEGER REFERENCES purchases(id),
 amount INTEGER NOT NULL CHECK(amount>0),CHECK((invoice_id IS NULL)!=(purchase_id IS NULL))
);
CREATE TABLE accounting_locks(id INTEGER PRIMARY KEY CHECK(id=1),closed_through TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TRIGGER journal_period_lock BEFORE INSERT ON journal_entries WHEN NEW.entry_date<=(SELECT closed_through FROM accounting_locks WHERE id=1) BEGIN SELECT RAISE(ABORT,'الفترة المحاسبية مقفلة');END;
CREATE TRIGGER purchases_no_update BEFORE UPDATE ON purchases BEGIN SELECT RAISE(ABORT,'مستند الشراء ثابت؛ صحح بمرتجع');END;
CREATE TRIGGER purchases_no_delete BEFORE DELETE ON purchases BEGIN SELECT RAISE(ABORT,'مستند الشراء ثابت؛ صحح بمرتجع');END;
CREATE TRIGGER purchase_lines_no_update BEFORE UPDATE ON purchase_lines BEGIN SELECT RAISE(ABORT,'بنود الشراء ثابتة');END;
CREATE TRIGGER purchase_lines_no_delete BEFORE DELETE ON purchase_lines BEGIN SELECT RAISE(ABORT,'بنود الشراء ثابتة');END;
CREATE TRIGGER purchase_lines_no_late_insert BEFORE INSERT ON purchase_lines WHEN EXISTS(SELECT 1 FROM journal_entries e WHERE e.source_type='purchase' AND e.source_id=NEW.purchase_id) BEGIN SELECT RAISE(ABORT,'مستند الشراء مرحل');END;
CREATE TRIGGER vouchers_no_update BEFORE UPDATE ON cash_vouchers BEGIN SELECT RAISE(ABORT,'السند ثابت');END;
CREATE TRIGGER vouchers_no_delete BEFORE DELETE ON cash_vouchers BEGIN SELECT RAISE(ABORT,'السند ثابت');END;
CREATE TRIGGER allocations_no_update BEFORE UPDATE ON voucher_allocations BEGIN SELECT RAISE(ABORT,'تخصيص السند ثابت');END;
CREATE TRIGGER allocations_no_delete BEFORE DELETE ON voucher_allocations BEGIN SELECT RAISE(ABORT,'تخصيص السند ثابت');END;
CREATE TRIGGER party_links_no_update BEFORE UPDATE ON journal_party_links BEGIN SELECT RAISE(ABORT,'ربط الطرف ثابت');END;
CREATE TRIGGER party_links_no_delete BEFORE DELETE ON journal_party_links BEGIN SELECT RAISE(ABORT,'ربط الطرف ثابت');END;
UPDATE local_meta SET value='6' WHERE key='schema_version';
