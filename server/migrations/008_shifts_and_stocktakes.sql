CREATE TABLE pos_shifts(
 id INTEGER PRIMARY KEY,pos_id INTEGER NOT NULL REFERENCES pos_points(id),user_id INTEGER NOT NULL REFERENCES users(id),
 opening_cash INTEGER NOT NULL CHECK(opening_cash>=0),opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 closed_at TEXT,counted_cash INTEGER CHECK(counted_cash>=0),expected_cash INTEGER,variance INTEGER,closed_by INTEGER REFERENCES users(id),
 request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,
 CHECK((closed_at IS NULL AND counted_cash IS NULL AND expected_cash IS NULL AND variance IS NULL AND closed_by IS NULL) OR (closed_at IS NOT NULL AND counted_cash IS NOT NULL AND expected_cash IS NOT NULL AND variance=counted_cash-expected_cash AND closed_by IS NOT NULL))
);
CREATE UNIQUE INDEX shift_one_open_pos ON pos_shifts(pos_id) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX shift_one_open_user ON pos_shifts(user_id) WHERE closed_at IS NULL;
CREATE TABLE pos_shift_invoices(invoice_id INTEGER PRIMARY KEY REFERENCES invoices(id),shift_id INTEGER NOT NULL REFERENCES pos_shifts(id));
CREATE TRIGGER shift_close_only BEFORE UPDATE ON pos_shifts WHEN OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL OR NEW.pos_id!=OLD.pos_id OR NEW.user_id!=OLD.user_id OR NEW.opening_cash!=OLD.opening_cash OR NEW.opened_at!=OLD.opened_at OR NEW.request_id!=OLD.request_id OR NEW.request_hash!=OLD.request_hash BEGIN SELECT RAISE(ABORT,'الوردية مقفلة أو تعديلها غير صالح');END;
CREATE TRIGGER shift_no_delete BEFORE DELETE ON pos_shifts BEGIN SELECT RAISE(ABORT,'الوردية ثابتة');END;
CREATE TRIGGER shift_link_no_update BEFORE UPDATE ON pos_shift_invoices BEGIN SELECT RAISE(ABORT,'ربط الوردية ثابت');END;
CREATE TRIGGER shift_link_no_delete BEFORE DELETE ON pos_shift_invoices BEGIN SELECT RAISE(ABORT,'ربط الوردية ثابت');END;
CREATE TRIGGER shift_link_closed BEFORE INSERT ON pos_shift_invoices WHEN EXISTS(SELECT 1 FROM pos_shifts WHERE id=NEW.shift_id AND closed_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'الوردية مقفلة');END;
CREATE TABLE pos_return_requests(request_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),request_hash TEXT NOT NULL,invoice_id INTEGER NOT NULL REFERENCES invoices(id));
CREATE TABLE stocktakes(id INTEGER PRIMARY KEY,warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),notes TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,approved_by INTEGER REFERENCES users(id),approved_at TEXT,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL);
CREATE TABLE stocktake_lines(stocktake_id INTEGER NOT NULL REFERENCES stocktakes(id),item_id INTEGER NOT NULL REFERENCES items(id),expected_micro INTEGER NOT NULL CHECK(expected_micro>=0),counted_micro INTEGER NOT NULL CHECK(counted_micro>=0),unit_cost INTEGER CHECK(unit_cost>=0),PRIMARY KEY(stocktake_id,item_id));
CREATE TRIGGER stocktake_approved_no_update BEFORE UPDATE ON stocktakes WHEN OLD.status='approved' BEGIN SELECT RAISE(ABORT,'الجرد المعتمد ثابت');END;
CREATE TRIGGER stocktake_approved_no_delete BEFORE DELETE ON stocktakes WHEN OLD.status='approved' BEGIN SELECT RAISE(ABORT,'الجرد المعتمد ثابت');END;
CREATE TRIGGER stocktake_lines_no_update BEFORE UPDATE ON stocktake_lines BEGIN SELECT RAISE(ABORT,'بنود الجرد ثابتة؛ أنشئ مسودة جديدة');END;
CREATE TRIGGER stocktake_lines_no_delete BEFORE DELETE ON stocktake_lines BEGIN SELECT RAISE(ABORT,'بنود الجرد ثابتة');END;
CREATE TRIGGER stocktake_no_late_lines BEFORE INSERT ON stocktake_lines WHEN (SELECT status FROM stocktakes WHERE id=NEW.stocktake_id)='approved' BEGIN SELECT RAISE(ABORT,'الجرد المعتمد ثابت');END;
UPDATE local_meta SET value='8' WHERE key='schema_version';
