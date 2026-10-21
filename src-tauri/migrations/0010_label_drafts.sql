CREATE TABLE IF NOT EXISTS nutrition_label_drafts (
 id TEXT PRIMARY KEY,
 revision INTEGER NOT NULL CHECK(revision >= 1),
 status TEXT NOT NULL CHECK(status IN ('draft','confirmed','discarded')),
 form_json TEXT NOT NULL,
 source_receipt_id TEXT REFERENCES input_receipts(id),
 source_artifact_id TEXT,
 food_id TEXT,
 food_version_id TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_label_drafts_status_updated ON nutrition_label_drafts(status,updated_at);
