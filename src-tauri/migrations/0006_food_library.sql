CREATE VIEW IF NOT EXISTS domain_food_library_projection AS
SELECT entity_id AS id,
  json_extract(payload_json, '$.name') AS name,
  json_extract(payload_json, '$.brand') AS brand,
  json_extract(payload_json, '$.measurementBasis') AS measurement_basis,
  json_extract(payload_json, '$.activeVersionId') AS active_version_id,
  json_extract(payload_json, '$.favorite') AS favorite
FROM domain_entities WHERE collection = 'foodDefinitions';

CREATE INDEX IF NOT EXISTS idx_domain_food_version_meals
ON domain_entities(json_extract(payload_json, '$.foodVersionId'))
WHERE collection = 'meals';
