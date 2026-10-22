-- 0014: 精简废弃功能 —— DROP 废弃表/视图/索引 + 清理废弃领域集合数据。
-- 保持 0001–0013 原始定义不变；本迁移仅在 PRAGMA user_version < 14 时执行一次。

-- 1. 先删含外键的子表（引用 prepared_batches / inventory_lots / input_artifact_objects）
DROP TABLE IF EXISTS meal_entries;
DROP TABLE IF EXISTS consumption_events;
DROP TABLE IF EXISTS waste_events;
DROP TABLE IF EXISTS inventory_movements;
DROP TABLE IF EXISTS input_receipts;

-- 2. 再删被引用的父表
DROP TABLE IF EXISTS prepared_batches;
DROP TABLE IF EXISTS inventory_lots;

-- 3. 其余无外键的废弃表
DROP TABLE IF EXISTS recipe_versions;
DROP TABLE IF EXISTS purchase_lots;
DROP TABLE IF EXISTS input_artifact_objects;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS input_artifacts;
DROP TABLE IF EXISTS food_definitions;
DROP TABLE IF EXISTS daily_checkins;
DROP TABLE IF EXISTS body_measurements;
DROP TABLE IF EXISTS workout_sessions;
DROP TABLE IF EXISTS meal_plans;
DROP TABLE IF EXISTS preference_feedback;
DROP TABLE IF EXISTS consent_grants;
DROP TABLE IF EXISTS input_artifact_audit;
DROP TABLE IF EXISTS nutrition_label_drafts;
DROP TABLE IF EXISTS menu_drafts;

-- 4. 废弃投影视图（业务代码零引用）
DROP VIEW IF EXISTS domain_meal_projection;
DROP VIEW IF EXISTS domain_food_library_projection;
DROP VIEW IF EXISTS domain_inventory_projection;
DROP VIEW IF EXISTS domain_purchase_projection;

-- 5. 建在 domain_entities 上的废弃独立索引
DROP INDEX IF EXISTS idx_domain_inventory_purchase;
DROP INDEX IF EXISTS idx_domain_food_version_meals;

-- 6. 清理废弃领域集合数据 + 单例（envelope 数据）
DELETE FROM domain_entities WHERE collection IN
  ('batches','consumptionEvents','wasteEvents','inventory','inventoryMovements','purchases','inbox','plans');
DELETE FROM domain_singletons WHERE key = 'aiSettings';
