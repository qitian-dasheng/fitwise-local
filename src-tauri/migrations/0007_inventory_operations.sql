CREATE INDEX IF NOT EXISTS idx_domain_inventory_purchase
ON domain_entities(json_extract(payload_json, '$.purchaseId'))
WHERE collection = 'inventory';

CREATE VIEW IF NOT EXISTS domain_purchase_projection AS
SELECT entity_id AS id,
  json_extract(payload_json, '$.platform') AS platform,
  json_extract(payload_json, '$.status') AS status,
  json_extract(payload_json, '$.orderedAt') AS ordered_at,
  json_extract(payload_json, '$.expectedArrival') AS expected_arrival,
  json_extract(payload_json, '$.paidCny') AS paid_cny
FROM domain_entities WHERE collection = 'purchases';
