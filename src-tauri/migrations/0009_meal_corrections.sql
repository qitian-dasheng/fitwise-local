-- Keep the immutable source entities; aggregates must ignore superseded/void rows.
CREATE VIEW IF NOT EXISTS domain_active_meal_projection AS
SELECT entity_id AS id,
  json_extract(payload_json, '$.date') AS diary_date,
  json_extract(payload_json, '$.type') AS meal_type,
  MIN(1.0, MAX(0.0, COALESCE(json_extract(payload_json, '$.consumedRatio'), 1.0))) AS ratio,
  json_extract(payload_json, '$.nutrition') AS nutrition_json
FROM domain_entities WHERE collection = 'meals'
  AND COALESCE(json_extract(payload_json, '$.status'), 'active') = 'active';
