CREATE TABLE stock_cost_corrections(
 id INTEGER PRIMARY KEY,item_id INTEGER NOT NULL REFERENCES items(id),warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
 movement_id INTEGER NOT NULL UNIQUE REFERENCES stock_movements(id),quantity_micro INTEGER NOT NULL CHECK(quantity_micro>0),
 previous_value INTEGER NOT NULL CHECK(previous_value>=0),value_after INTEGER NOT NULL CHECK(value_after BETWEEN 0 AND 9007199254740991),
 unit_cost INTEGER NOT NULL CHECK(unit_cost BETWEEN 0 AND 9007199254740991),correction_date TEXT NOT NULL,reason TEXT NOT NULL,
 journal_id INTEGER UNIQUE REFERENCES journal_entries(id),actor_id INTEGER NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER stock_cost_correction_matches BEFORE INSERT ON stock_cost_corrections WHEN
 NOT EXISTS(SELECT 1 FROM stock_positions p JOIN stock_values v ON v.movement_id=p.last_movement_id WHERE p.item_id=NEW.item_id AND p.warehouse_id=NEW.warehouse_id AND p.last_movement_id=NEW.movement_id AND p.qty_micro=NEW.quantity_micro AND v.complete=0 AND v.value_after=NEW.previous_value)
 OR (NEW.value_after!=NEW.previous_value AND NOT EXISTS(SELECT 1 FROM journal_entries e WHERE e.id=NEW.journal_id AND e.source_type='stock_cost_correction' AND e.entry_date=NEW.correction_date AND (SELECT SUM(l.debit-l.credit) FROM journal_lines l WHERE l.entry_id=e.id AND l.account_code='1401')=NEW.value_after-NEW.previous_value))
 BEGIN SELECT RAISE(ABORT,'تصحيح التكلفة لا يطابق الرصيد الحالي أو قيده');END;
CREATE TRIGGER stock_cost_correction_no_update BEFORE UPDATE ON stock_cost_corrections BEGIN SELECT RAISE(ABORT,'تصحيح التكلفة ثابت');END;
CREATE TRIGGER stock_cost_correction_no_delete BEFORE DELETE ON stock_cost_corrections BEGIN SELECT RAISE(ABORT,'تصحيح التكلفة ثابت');END;
UPDATE local_meta SET value='14' WHERE key='schema_version';
