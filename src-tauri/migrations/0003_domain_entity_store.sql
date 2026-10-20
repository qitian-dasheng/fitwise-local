CREATE TABLE IF NOT EXISTS domain_singletons (
  key TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS domain_entities (
  collection TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  sort_index INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (collection, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_domain_entities_order ON domain_entities(collection, sort_index);

CREATE TABLE IF NOT EXISTS domain_state_meta (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  persist_version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

