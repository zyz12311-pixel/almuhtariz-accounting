CREATE TABLE pos_sale_requests(request_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),pos_id INTEGER NOT NULL REFERENCES pos_points(id),invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),request_hash TEXT NOT NULL,created_at TEXT NOT NULL);
UPDATE local_meta SET value='3' WHERE key='schema_version';
