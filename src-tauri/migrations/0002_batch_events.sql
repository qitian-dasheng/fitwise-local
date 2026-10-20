ALTER TABLE prepared_batches ADD COLUMN remaining_ratio REAL NOT NULL DEFAULT 0 CHECK (remaining_ratio BETWEEN 0 AND 1);
ALTER TABLE prepared_batches ADD COLUMN status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open','closed'));
ALTER TABLE prepared_batches ADD COLUMN closed_at TEXT;

CREATE TABLE IF NOT EXISTS consumption_events (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  diary_date TEXT NOT NULL,
  meal_type TEXT NOT NULL,
  ratio REAL NOT NULL CHECK (ratio > 0 AND ratio <= 1),
  ratio_is_estimated INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES prepared_batches(id)
);
CREATE INDEX IF NOT EXISTS idx_consumption_batch ON consumption_events(batch_id);

CREATE TABLE IF NOT EXISTS waste_events (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  ratio REAL NOT NULL CHECK (ratio > 0 AND ratio <= 1),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES prepared_batches(id)
);
CREATE INDEX IF NOT EXISTS idx_waste_batch ON waste_events(batch_id);

