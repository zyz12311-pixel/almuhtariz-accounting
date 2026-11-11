ALTER TABLE pos_points ADD COLUMN activity TEXT NOT NULL DEFAULT 'trade'
 CHECK(activity IN ('trade','events','engineering'));

-- Existing points inherit the activity used by the old POS routes.
UPDATE pos_points SET activity=COALESCE((
 SELECT json_extract(value,'$.activity') FROM settings
 WHERE key='company' AND json_valid(value)
   AND json_extract(value,'$.activity') IN ('trade','events','engineering')
),'trade');

UPDATE local_meta SET value='20' WHERE key='schema_version';
