ALTER TABLE items ADD COLUMN barcode TEXT;
ALTER TABLE items ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
CREATE UNIQUE INDEX ux_items_barcode ON items(barcode) WHERE barcode IS NOT NULL;
CREATE TABLE pos_user_access(user_id INTEGER NOT NULL REFERENCES users(id),pos_id INTEGER NOT NULL REFERENCES pos_points(id),PRIMARY KEY(user_id,pos_id));
INSERT INTO pos_user_access(user_id,pos_id) SELECT u.id,(SELECT MIN(id) FROM pos_points WHERE active=1) FROM users u WHERE u.role='staff' AND EXISTS(SELECT 1 FROM pos_points WHERE active=1);
CREATE TABLE local_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT INTO local_meta(key,value) VALUES('schema_version','2');
