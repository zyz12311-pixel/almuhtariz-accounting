-- صلاحيات الموظف على المستويات السعرية المخصصة (JSON array من الأكواد المسموح بها)
ALTER TABLE users ADD COLUMN allowed_price_levels TEXT NOT NULL DEFAULT '[]';

-- سعر مستقل لكل وحدة من الصنف لكل مستوى سعري
CREATE TABLE IF NOT EXISTS unit_price_levels(
 unit_id INTEGER NOT NULL REFERENCES item_units(id),
 level_id INTEGER NOT NULL REFERENCES price_levels(id),
 unit_price INTEGER NOT NULL CHECK(unit_price>=0),
 PRIMARY KEY(unit_id,level_id)
);
CREATE INDEX IF NOT EXISTS ix_unit_price_levels_level ON unit_price_levels(level_id);

-- قوائم أسعار مرتبطة بالعملاء مع مدة صلاحية
CREATE TABLE IF NOT EXISTS party_price_lists(
 id INTEGER PRIMARY KEY,
 party_id INTEGER NOT NULL REFERENCES parties(id),
 level_id INTEGER NOT NULL REFERENCES price_levels(id),
 valid_from TEXT NOT NULL,
 valid_to TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_party_price_lists_party ON party_price_lists(party_id);
CREATE INDEX IF NOT EXISTS ix_party_price_lists_level ON party_price_lists(level_id);

UPDATE local_meta SET value='25' WHERE key='schema_version';