ALTER TABLE users ADD COLUMN pos_manual_price INTEGER NOT NULL DEFAULT 0 CHECK(pos_manual_price IN (0,1));
ALTER TABLE users ADD COLUMN pos_manual_price_cap INTEGER NOT NULL DEFAULT 0 CHECK(pos_manual_price_cap>=0);
