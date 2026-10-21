-- 0012: 运动记录支持修订与作废。
--
-- 领域状态是 envelope 存储（domain_entities.payload_json），status 只存在于 JSON 里，
-- 因此这里不做 ALTER TABLE，也不回填任何默认值——回填会让升级对账的 before/after 不一致。
--
-- 唯一必须迁移的是投影视图，原因有两条：
--   1. 0005 定义的是 CREATE VIEW IF NOT EXISTS，无法覆盖已有定义，必须 DROP 再建；
--   2. 旧视图没有任何 status 过滤，一旦出现 void/superseded 的运动记录，
--      period_summary 的 SUM(duration_minutes) 仍会把作废的时长算进「近七日运动」，
--      等于改了命令却没改口径。所以过滤必须落在视图里，让所有查视图的地方自动生效。
--
-- 兼容性：0.4.8 及更早写入的运动 payload 没有 status 字段，
-- COALESCE(..., 'active') 会把它们一律当作有效记录，不需要数据迁移。
--
-- 索引：沿用 0005 的现状，不为 json_extract 建表达式索引（理由同 0011）。

DROP VIEW IF EXISTS domain_workout_projection;

CREATE VIEW IF NOT EXISTS domain_workout_projection AS
SELECT entity_id AS id,
  json_extract(payload_json, '$.date') AS workout_date,
  json_extract(payload_json, '$.durationMinutes') AS duration_minutes,
  json_extract(payload_json, '$.caloriesKcal') AS calories_kcal,
  COALESCE(json_extract(payload_json, '$.status'), 'active') AS status
FROM domain_entities WHERE collection = 'workouts'
  AND COALESCE(json_extract(payload_json, '$.status'), 'active') = 'active';
