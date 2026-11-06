CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters(name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('owner','accountant','staff')), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts(code TEXT PRIMARY KEY, name_ar TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','revenue','expense')), postable INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS journal_entries(id INTEGER PRIMARY KEY, entry_no INTEGER UNIQUE NOT NULL, entry_date TEXT NOT NULL,
  description TEXT, source_type TEXT, source_id INTEGER, branch_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS journal_lines(id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
  account_code TEXT NOT NULL REFERENCES accounts(code), debit INTEGER NOT NULL DEFAULT 0 CHECK(debit>=0),
  credit INTEGER NOT NULL DEFAULT 0 CHECK(credit>=0), CHECK(debit=0 OR credit=0));
CREATE TABLE IF NOT EXISTS parties(id INTEGER PRIMARY KEY, name_ar TEXT NOT NULL, vat_number TEXT, phone TEXT, address TEXT,
  kind TEXT NOT NULL DEFAULT 'customer' CHECK(kind IN ('customer','supplier','both')));
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, name_ar TEXT NOT NULL, unit_price INTEGER NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 15);
CREATE TABLE IF NOT EXISTS branches(id INTEGER PRIMARY KEY, name TEXT NOT NULL, cr_number TEXT, address TEXT);
CREATE TABLE IF NOT EXISTS pos_points(id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL, prefix TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS chain(branch_id INTEGER PRIMARY KEY REFERENCES branches(id), icv INTEGER NOT NULL, last_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY, uuid TEXT UNIQUE NOT NULL, number TEXT UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('388','381')), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued')),
  pos_id INTEGER NOT NULL REFERENCES pos_points(id), branch_id INTEGER NOT NULL REFERENCES branches(id),
  party_id INTEGER REFERENCES parties(id), payment TEXT NOT NULL DEFAULT 'cash' CHECK(payment IN ('cash','bank','credit')),
  issue_date TEXT, issue_time TEXT, icv INTEGER, pih TEXT, hash TEXT, qr TEXT,
  subtotal INTEGER NOT NULL, vat INTEGER NOT NULL, total INTEGER NOT NULL,
  ref_invoice_id INTEGER REFERENCES invoices(id), reason TEXT, notes TEXT, created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(branch_id, icv));
CREATE TABLE IF NOT EXISTS invoice_lines(id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  line_no INTEGER NOT NULL, description TEXT NOT NULL, qty REAL NOT NULL, unit_price INTEGER NOT NULL, vat_rate REAL NOT NULL,
  net INTEGER NOT NULL, vat INTEGER NOT NULL, total INTEGER NOT NULL, UNIQUE(invoice_id, line_no));
CREATE INDEX IF NOT EXISTS ix_inv_date ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS ix_jl_acc ON journal_lines(account_code);

-- حماية السجلات: القيود والفواتير الصادرة لا تُعدَّل ولا تُحذف (التصحيح بقيد عكسي/إشعار دائن)
CREATE TRIGGER IF NOT EXISTS je_nu BEFORE UPDATE ON journal_entries BEGIN SELECT RAISE(ABORT,'القيود غير قابلة للتعديل'); END;
CREATE TRIGGER IF NOT EXISTS je_nd BEFORE DELETE ON journal_entries BEGIN SELECT RAISE(ABORT,'القيود غير قابلة للحذف'); END;
CREATE TRIGGER IF NOT EXISTS jl_nu BEFORE UPDATE ON journal_lines BEGIN SELECT RAISE(ABORT,'القيود غير قابلة للتعديل'); END;
CREATE TRIGGER IF NOT EXISTS jl_nd BEFORE DELETE ON journal_lines BEGIN SELECT RAISE(ABORT,'القيود غير قابلة للحذف'); END;
CREATE TRIGGER IF NOT EXISTS inv_nu BEFORE UPDATE ON invoices WHEN OLD.status='issued' BEGIN SELECT RAISE(ABORT,'الفاتورة الصادرة غير قابلة للتعديل: أصدر إشعارًا دائنًا'); END;
CREATE TRIGGER IF NOT EXISTS inv_nd BEFORE DELETE ON invoices WHEN OLD.status='issued' BEGIN SELECT RAISE(ABORT,'الفاتورة الصادرة غير قابلة للحذف'); END;
CREATE TRIGGER IF NOT EXISTS il_ni BEFORE INSERT ON invoice_lines WHEN (SELECT status FROM invoices WHERE id=NEW.invoice_id)='issued' BEGIN SELECT RAISE(ABORT,'بنود الفاتورة الصادرة مقفلة'); END;
CREATE TRIGGER IF NOT EXISTS il_nu BEFORE UPDATE ON invoice_lines WHEN (SELECT status FROM invoices WHERE id=OLD.invoice_id)='issued' BEGIN SELECT RAISE(ABORT,'بنود الفاتورة الصادرة مقفلة'); END;
CREATE TRIGGER IF NOT EXISTS il_nd BEFORE DELETE ON invoice_lines WHEN (SELECT status FROM invoices WHERE id=OLD.invoice_id)='issued' BEGIN SELECT RAISE(ABORT,'بنود الفاتورة الصادرة مقفلة'); END;

CREATE TABLE IF NOT EXISTS invoice_snapshots(invoice_id INTEGER PRIMARY KEY REFERENCES invoices(id), company TEXT NOT NULL, party TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS snapshot_nu BEFORE UPDATE ON invoice_snapshots BEGIN SELECT RAISE(ABORT,'بيانات المستند محفوظة'); END;
CREATE TRIGGER IF NOT EXISTS snapshot_nd BEFORE DELETE ON invoice_snapshots BEGIN SELECT RAISE(ABORT,'بيانات المستند محفوظة'); END;

-- Local identity and transactional delivery queue. Transport is configured separately.
CREATE TABLE IF NOT EXISTS installation(id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_outbox(event_id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, aggregate_uuid TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(aggregate_uuid,event_type));
CREATE TABLE IF NOT EXISTS sync_receipts(event_id TEXT PRIMARY KEY REFERENCES sync_outbox(event_id), acknowledged_at TEXT NOT NULL, remote_receipt TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS outbox_nu BEFORE UPDATE ON sync_outbox BEGIN SELECT RAISE(ABORT,'سجل المزامنة ثابت'); END;
CREATE TRIGGER IF NOT EXISTS outbox_nd BEFORE DELETE ON sync_outbox BEGIN SELECT RAISE(ABORT,'سجل المزامنة ثابت'); END;
