-- Derived quantity state. Movement history remains the immutable source of truth.
CREATE TABLE stock_positions(
 item_id INTEGER NOT NULL REFERENCES items(id),warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
 qty_micro INTEGER NOT NULL CHECK(qty_micro>=0 AND qty_micro<=9007199254740991),
 last_movement_id INTEGER NOT NULL UNIQUE REFERENCES stock_movements(id),PRIMARY KEY(item_id,warehouse_id)
);
INSERT INTO stock_positions(item_id,warehouse_id,qty_micro,last_movement_id)
 SELECT item_id,warehouse_id,SUM(delta_micro),MAX(id) FROM stock_movements GROUP BY item_id,warehouse_id;
DROP TRIGGER stock_nonnegative;
DROP TRIGGER stock_limit;
CREATE TRIGGER stock_nonnegative BEFORE INSERT ON stock_movements WHEN COALESCE((SELECT qty_micro FROM stock_positions WHERE item_id=NEW.item_id AND warehouse_id=NEW.warehouse_id),0)+NEW.delta_micro<0 BEGIN SELECT RAISE(ABORT,'الرصيد المخزني غير كاف في المستودع المحدد');END;
CREATE TRIGGER stock_limit BEFORE INSERT ON stock_movements WHEN COALESCE((SELECT qty_micro FROM stock_positions WHERE item_id=NEW.item_id AND warehouse_id=NEW.warehouse_id),0)+NEW.delta_micro>9007199254740991 BEGIN SELECT RAISE(ABORT,'الرصيد أكبر من المسموح');END;
CREATE TRIGGER position_guard_insert BEFORE INSERT ON stock_positions WHEN
 NOT EXISTS(SELECT 1 FROM stock_movements m WHERE m.id=NEW.last_movement_id AND m.item_id=NEW.item_id AND m.warehouse_id=NEW.warehouse_id AND m.delta_micro=NEW.qty_micro)
 OR EXISTS(SELECT 1 FROM stock_movements m WHERE m.item_id=NEW.item_id AND m.warehouse_id=NEW.warehouse_id AND m.id<NEW.last_movement_id)
 BEGIN SELECT RAISE(ABORT,'الرصيد مشتق من الحركة ولا يُدخل مباشرة');END;
CREATE TRIGGER position_guard_update BEFORE UPDATE ON stock_positions WHEN
 NEW.item_id!=OLD.item_id OR NEW.warehouse_id!=OLD.warehouse_id OR NEW.last_movement_id<=OLD.last_movement_id
 OR NOT EXISTS(SELECT 1 FROM stock_movements m WHERE m.id=NEW.last_movement_id AND m.item_id=OLD.item_id AND m.warehouse_id=OLD.warehouse_id AND NEW.qty_micro=OLD.qty_micro+m.delta_micro)
 OR NEW.last_movement_id!=(SELECT MAX(id) FROM stock_movements WHERE item_id=OLD.item_id AND warehouse_id=OLD.warehouse_id)
 BEGIN SELECT RAISE(ABORT,'الرصيد مشتق من الحركة ولا يُعدل مباشرة');END;
CREATE TRIGGER position_guard_delete BEFORE DELETE ON stock_positions BEGIN SELECT RAISE(ABORT,'الرصيد المشتق لا يُحذف مباشرة');END;
CREATE TRIGGER stock_position_after_insert AFTER INSERT ON stock_movements BEGIN
 UPDATE stock_positions SET qty_micro=qty_micro+NEW.delta_micro,last_movement_id=NEW.id WHERE item_id=NEW.item_id AND warehouse_id=NEW.warehouse_id;
 INSERT INTO stock_positions(item_id,warehouse_id,qty_micro,last_movement_id)
 SELECT NEW.item_id,NEW.warehouse_id,NEW.delta_micro,NEW.id WHERE NOT EXISTS(SELECT 1 FROM stock_positions WHERE item_id=NEW.item_id AND warehouse_id=NEW.warehouse_id);
END;
UPDATE local_meta SET value='11' WHERE key='schema_version';
