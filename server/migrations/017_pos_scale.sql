ALTER TABLE items ADD COLUMN scale_plu TEXT
  CHECK(scale_plu IS NULL OR scale_plu GLOB '[0-9][0-9][0-9][0-9][0-9]');
CREATE UNIQUE INDEX items_scale_plu ON items(scale_plu) WHERE scale_plu IS NOT NULL;
