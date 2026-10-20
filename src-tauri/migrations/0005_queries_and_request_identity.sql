CREATE TABLE IF NOT EXISTS domain_command_payloads (
  command_id TEXT PRIMARY KEY NOT NULL,
  request_sha256 TEXT NOT NULL,
  FOREIGN KEY (command_id) REFERENCES domain_command_receipts(command_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS domain_upgrade_reports (
  version INTEGER PRIMARY KEY NOT NULL,
  backup_path TEXT,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIEW IF NOT EXISTS domain_meal_projection AS
SELECT entity_id AS id,
  json_extract(payload_json, '$.date') AS diary_date,
  json_extract(payload_json, '$.type') AS meal_type,
  MIN(1.0, MAX(0.0, COALESCE(json_extract(payload_json, '$.consumedRatio'), 1.0))) AS ratio,
  json_extract(payload_json, '$.nutrition') AS nutrition_json
FROM domain_entities WHERE collection = 'meals';

CREATE VIEW IF NOT EXISTS domain_inventory_projection AS
SELECT entity_id AS id,
  json_extract(payload_json, '$.foodId') AS food_id,
  json_extract(payload_json, '$.name') AS name,
  json_extract(payload_json, '$.remainingAmount') AS remaining_amount,
  json_extract(payload_json, '$.purchasedAmount') AS purchased_amount,
  json_extract(payload_json, '$.purchasePriceCny') AS price_cny,
  json_extract(payload_json, '$.unit') AS unit,
  json_extract(payload_json, '$.opened') AS opened,
  json_extract(payload_json, '$.expiresAt') AS expires_at,
  json_extract(payload_json, '$.purchasedAt') AS purchased_at,
  json_extract(payload_json, '$.source') AS source,
  json_extract(payload_json, '$.confidence') AS confidence
FROM domain_entities WHERE collection = 'inventory';

CREATE VIEW IF NOT EXISTS domain_measurement_projection AS
SELECT entity_id AS id,
  json_extract(payload_json, '$.date') AS measured_date,
  json_extract(payload_json, '$.weightKg') AS weight_kg,
  json_extract(payload_json, '$.isOutlier') AS is_outlier,
  json_extract(payload_json, '$.createdAt') AS created_at
FROM domain_entities WHERE collection = 'measurements'
  AND COALESCE(json_extract(payload_json, '$.status'), 'active') != 'superseded';

CREATE VIEW IF NOT EXISTS domain_checkin_projection AS
SELECT entity_id AS id, json_extract(payload_json, '$.date') AS diary_date,
  json_extract(payload_json, '$.complete') AS complete
FROM domain_entities WHERE collection = 'checkIns';

CREATE VIEW IF NOT EXISTS domain_workout_projection AS
SELECT entity_id AS id, json_extract(payload_json, '$.date') AS workout_date,
  json_extract(payload_json, '$.durationMinutes') AS duration_minutes,
  json_extract(payload_json, '$.caloriesKcal') AS calories_kcal
FROM domain_entities WHERE collection = 'workouts';
