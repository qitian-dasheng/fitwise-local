PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS input_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','text','link','pdf')),
  sha256 TEXT,
  original_path TEXT,
  preview_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('unreviewed','drafted','confirmed','discarded')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  received_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_hash ON input_artifacts(sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS food_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  basis_amount REAL NOT NULL DEFAULT 100,
  basis_unit TEXT NOT NULL,
  edible_ratio REAL,
  nutrients_json TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  retired_at TEXT
);

CREATE TABLE IF NOT EXISTS recipe_versions (
  id TEXT PRIMARY KEY NOT NULL,
  recipe_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  ingredients_json TEXT NOT NULL,
  nutrients_json TEXT NOT NULL,
  equipment_json TEXT NOT NULL,
  total_minutes INTEGER NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(recipe_id, version)
);

CREATE TABLE IF NOT EXISTS purchase_lots (
  id TEXT PRIMARY KEY NOT NULL,
  food_id TEXT,
  product_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  product_url TEXT,
  purchased_amount REAL NOT NULL,
  unit TEXT NOT NULL,
  paid_cny REAL NOT NULL,
  status TEXT NOT NULL,
  ordered_at TEXT,
  expected_arrival TEXT,
  received_at TEXT,
  expires_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_lots (
  id TEXT PRIMARY KEY NOT NULL,
  purchase_lot_id TEXT,
  food_id TEXT NOT NULL,
  name TEXT NOT NULL,
  original_amount REAL NOT NULL,
  remaining_amount REAL NOT NULL CHECK (remaining_amount >= 0),
  unit TEXT NOT NULL,
  opened INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  confidence TEXT NOT NULL,
  last_counted_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_lot_id) REFERENCES purchase_lots(id)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY NOT NULL,
  lot_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  related_entity_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (lot_id) REFERENCES inventory_lots(id)
);

CREATE TABLE IF NOT EXISTS prepared_batches (
  id TEXT PRIMARY KEY NOT NULL,
  recipe_version_id TEXT NOT NULL,
  prepared_date TEXT NOT NULL,
  consumed_ratio REAL NOT NULL CHECK (consumed_ratio BETWEEN 0 AND 1),
  wasted_ratio REAL NOT NULL CHECK (wasted_ratio BETWEEN 0 AND 1),
  ratio_is_estimated INTEGER NOT NULL DEFAULT 1,
  cooked_weight_g REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id)
);

CREATE TABLE IF NOT EXISTS meal_entries (
  id TEXT PRIMARY KEY NOT NULL,
  diary_date TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_label TEXT NOT NULL,
  nutrition_snapshot_json TEXT NOT NULL,
  consumed_ratio REAL NOT NULL CHECK (consumed_ratio BETWEEN 0 AND 1),
  prepared_batch_id TEXT,
  source TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (prepared_batch_id) REFERENCES prepared_batches(id)
);
CREATE INDEX IF NOT EXISTS idx_meal_date ON meal_entries(diary_date);

CREATE TABLE IF NOT EXISTS daily_checkins (
  diary_date TEXT PRIMARY KEY NOT NULL,
  hunger INTEGER CHECK (hunger BETWEEN 1 AND 5),
  energy INTEGER CHECK (energy BETWEEN 1 AND 5),
  complete INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS body_measurements (
  id TEXT PRIMARY KEY NOT NULL,
  measured_date TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  waist_cm REAL,
  body_fat_percent REAL,
  is_outlier INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  workout_date TEXT NOT NULL,
  name TEXT NOT NULL,
  workout_type TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  calories_kcal REAL,
  load REAL,
  average_heart_rate INTEGER,
  max_heart_rate INTEGER,
  source_fingerprint TEXT UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meal_plans (
  id TEXT PRIMARY KEY NOT NULL,
  plan_date TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  score_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS preference_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  recipe_id TEXT NOT NULL,
  preference TEXT NOT NULL,
  satiety INTEGER,
  effort INTEGER,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_grants (
  id TEXT PRIMARY KEY NOT NULL,
  grantee TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
