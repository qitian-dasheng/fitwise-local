-- Content-addressed attachments and durable intake receipts. Blobs are authoritative
-- SQLite data so metadata + originals + previews share one transaction and backup.
CREATE TABLE IF NOT EXISTS input_artifact_objects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, original BLOB,
 thumb BLOB, thumb_sha256 TEXT, width INTEGER, height INTEGER,
 privacy BLOB, privacy_sha256 TEXT, masks_json TEXT,
 original_bytes INTEGER NOT NULL, created_at TEXT NOT NULL,
 trashed_at TEXT, purged_at TEXT
);
CREATE TABLE IF NOT EXISTS input_receipts (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL, request_sha256 TEXT NOT NULL,
 artifact_id TEXT REFERENCES input_artifact_objects(id), note TEXT NOT NULL,
 source TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unreviewed'
);
CREATE INDEX IF NOT EXISTS idx_intake_request ON input_receipts(request_id);
CREATE INDEX IF NOT EXISTS idx_intake_created ON input_receipts(created_at);
CREATE TABLE IF NOT EXISTS input_artifact_audit (
 id INTEGER PRIMARY KEY, entity_id TEXT NOT NULL, action TEXT NOT NULL,
 details_json TEXT NOT NULL, created_at TEXT NOT NULL
);
