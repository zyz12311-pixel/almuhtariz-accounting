CREATE TABLE IF NOT EXISTS price_levels(
 id INTEGER PRIMARY KEY,
 code TEXT UNIQUE NOT NULL CHECK(length(TRIM(code))>0 AND length(code)<=30),
 name_ar TEXT NOT NULL CHECK(length(TRIM(name_ar))>0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 is_builtin INTEGER NOT NULL DEFAULT 0 CHECK(is_builtin IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO price_levels(code,name_ar,active,is_builtin)
 SELECT 'retail','التجزئة',1,1 WHERE NOT EXISTS(SELECT 1 FROM price_levels WHERE code='retail');
INSERT INTO price_levels(code,name_ar,active,is_builtin)
 SELECT 'wholesale','الجملة',1,1 WHERE NOT EXISTS(SELECT 1 FROM price_levels WHERE code='wholesale');

-- سعر الصنف لكل مستوى سعري (تسعير ديناميكي مرن يتجاوز سعر التجزئة/الجملة الافتراضي)
CREATE TABLE IF NOT EXISTS item_price_levels(
 item_id INTEGER NOT NULL REFERENCES items(id),
 level_id INTEGER NOT NULL REFERENCES price_levels(id),
 unit_price INTEGER NOT NULL CHECK(unit_price>=0),
 PRIMARY KEY(item_id,level_id)
);
CREATE INDEX IF NOT EXISTS ix_item_price_levels_level ON item_price_levels(level_id);

UPDATE local_meta SET value='24' WHERE key='schema_version';
