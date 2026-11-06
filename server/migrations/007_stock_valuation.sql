INSERT OR IGNORE INTO accounts(code,name_ar,type,postable) VALUES('5298','فروق وتسويات المخزون','expense',1);
CREATE TABLE stock_values(
 movement_id INTEGER PRIMARY KEY REFERENCES stock_movements(id),value_delta INTEGER NOT NULL,
 quantity_after INTEGER NOT NULL CHECK(quantity_after>=0),value_after INTEGER NOT NULL CHECK(value_after>=0),
 complete INTEGER NOT NULL CHECK(complete IN (0,1)),costed INTEGER NOT NULL CHECK(costed IN (0,1)),
 CHECK(abs(value_delta)<=9007199254740991 AND value_after<=9007199254740991)
);
-- Do not invent values for legacy movements. Incomplete balances are explicitly flagged.
INSERT INTO stock_values(movement_id,value_delta,quantity_after,value_after,complete,costed)
SELECT id,0,SUM(delta_micro) OVER(PARTITION BY item_id,warehouse_id ORDER BY id),0,
 CASE WHEN SUM(delta_micro) OVER(PARTITION BY item_id,warehouse_id ORDER BY id)=0 THEN 1 ELSE 0 END,0 FROM stock_movements;
CREATE TRIGGER stock_values_no_update BEFORE UPDATE ON stock_values BEGIN SELECT RAISE(ABORT,'قيمة الحركة ثابتة');END;
CREATE TRIGGER stock_values_no_delete BEFORE DELETE ON stock_values BEGIN SELECT RAISE(ABORT,'قيمة الحركة ثابتة');END;
CREATE TABLE manual_journal_requests(request_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,id INTEGER NOT NULL UNIQUE REFERENCES journal_entries(id));
CREATE TRIGGER journal_request_no_update BEFORE UPDATE ON manual_journal_requests BEGIN SELECT RAISE(ABORT,'إقرار القيد ثابت');END;
CREATE TRIGGER journal_request_no_delete BEFORE DELETE ON manual_journal_requests BEGIN SELECT RAISE(ABORT,'إقرار القيد ثابت');END;
CREATE TABLE purchase_snapshots(purchase_id INTEGER PRIMARY KEY REFERENCES purchases(id),supplier TEXT NOT NULL);
INSERT INTO purchase_snapshots(purchase_id,supplier) SELECT p.id,json_object('name_ar',s.name_ar,'vat_number',s.vat_number,'address',s.address) FROM purchases p JOIN parties s ON s.id=p.supplier_id;
CREATE TRIGGER purchase_snapshot_no_update BEFORE UPDATE ON purchase_snapshots BEGIN SELECT RAISE(ABORT,'بيانات مستند الشراء ثابتة');END;
CREATE TRIGGER purchase_snapshot_no_delete BEFORE DELETE ON purchase_snapshots BEGIN SELECT RAISE(ABORT,'بيانات مستند الشراء ثابتة');END;
UPDATE local_meta SET value='7' WHERE key='schema_version';
