-- Clear bearer tokens issued by older releases. The next sign-in stores a digest.
DELETE FROM sessions;

-- Keep the exact in-flight payload and progress across connection loss and restarts.
CREATE TABLE sync_pending_snapshot (
 id INTEGER PRIMARY KEY CHECK(id=1),
 sequence INTEGER NOT NULL CHECK(sequence>0),
 payload TEXT NOT NULL,
 next_part INTEGER NOT NULL DEFAULT 0 CHECK(next_part>=0)
);
UPDATE local_meta SET value='18' WHERE key='schema_version';
