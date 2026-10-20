CREATE TABLE IF NOT EXISTS domain_command_receipts (
  command_id TEXT PRIMARY KEY NOT NULL,
  command_kind TEXT NOT NULL,
  result_json TEXT NOT NULL,
  applied_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_domain_command_receipts_created
  ON domain_command_receipts(created_at);
