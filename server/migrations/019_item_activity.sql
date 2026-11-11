-- Activity tagging for items. A branch device sees only the items that match
-- its own company.activity, so trade / events / engineering stay isolated on
-- separate machines that share the same schema.
ALTER TABLE items ADD COLUMN activity TEXT NOT NULL DEFAULT 'trade'
  CHECK(activity IN ('trade','events','engineering'));
CREATE INDEX IF NOT EXISTS ix_items_activity ON items(activity);

-- Legacy rows keep the trade default; new items are created with the active
-- company activity and cannot be changed after they have movements or invoices.
UPDATE local_meta SET value='19' WHERE key='schema_version';
