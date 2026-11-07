ALTER TABLE items ADD COLUMN wholesale_price INTEGER CHECK(wholesale_price >= 0);
ALTER TABLE item_units ADD COLUMN wholesale_price INTEGER CHECK(wholesale_price >= 0);
ALTER TABLE users ADD COLUMN pos_discount_limit INTEGER NOT NULL DEFAULT 0 CHECK(pos_discount_limit BETWEEN 0 AND 10000);
ALTER TABLE users ADD COLUMN pos_wholesale INTEGER NOT NULL DEFAULT 0 CHECK(pos_wholesale IN (0,1));
