CREATE TABLE sync_connection(id INTEGER PRIMARY KEY CHECK(id=1),device_token TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),last_sequence INTEGER NOT NULL DEFAULT 0,last_synced_at TEXT,last_error TEXT);
UPDATE local_meta SET value='9' WHERE key='schema_version';
