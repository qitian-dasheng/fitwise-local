-- 0011: 体重记录支持同日多次称重、称重时刻/条件/备注、修订与作废。
--
-- 领域状态是 envelope 存储（domain_entities.payload_json），新增字段只存在于 JSON 里，
-- 因此这里不做 ALTER TABLE，也不回填任何默认值——回填会让升级对账的 before/after 不一致。
-- 唯一必须迁移的是投影视图：
--   1. 旧视图用 CREATE VIEW IF NOT EXISTS，无法覆盖已有定义；
--   2. 旧过滤条件 `!= 'superseded'` 是失败开放写法，会把新的 void 记录算进来；
--   3. 趋势需要按「当日代表值」折叠，得把 measured_at / day_representative 暴露出去。
--
-- 索引：domain_entities 主键为 (collection, entity_id)，投影是 collection 前缀扫描，
-- 量级在千行内；为 json_extract 建表达式索引会与 envelope 全量重写互相拖累，本轮不加。

DROP VIEW IF EXISTS domain_measurement_projection;

CREATE VIEW IF NOT EXISTS domain_measurement_projection AS
SELECT entity_id AS id,
  json_extract(payload_json, '$.date') AS measured_date,
  json_extract(payload_json, '$.weightKg') AS weight_kg,
  json_extract(payload_json, '$.isOutlier') AS is_outlier,
  json_extract(payload_json, '$.createdAt') AS created_at,
  json_extract(payload_json, '$.measuredAt') AS measured_at,
  json_extract(payload_json, '$.condition') AS condition,
  json_extract(payload_json, '$.dayRepresentative') AS day_representative
FROM domain_entities WHERE collection = 'measurements'
  AND COALESCE(json_extract(payload_json, '$.status'), 'active') = 'active';
