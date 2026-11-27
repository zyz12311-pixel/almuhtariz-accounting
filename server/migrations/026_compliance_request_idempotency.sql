CREATE TABLE invoice_issue_requests(
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=36),
 user_id INTEGER NOT NULL REFERENCES users(id),
 operation TEXT NOT NULL CHECK(operation IN ('invoice','credit_note','debit_note')),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),
 created_at TEXT NOT NULL
);
CREATE TRIGGER invoice_issue_requests_no_update BEFORE UPDATE ON invoice_issue_requests BEGIN SELECT RAISE(ABORT,'مفاتيح طلبات الإصدار ثابتة');END;
CREATE TRIGGER invoice_issue_requests_no_delete BEFORE DELETE ON invoice_issue_requests BEGIN SELECT RAISE(ABORT,'مفاتيح طلبات الإصدار ثابتة');END;
UPDATE local_meta SET value='26' WHERE key='schema_version';
