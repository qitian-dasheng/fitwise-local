-- 0013: AI 菜单草稿通道（M3）。
--
-- 外部 Agent 只能产出菜单草稿，不能直写领域状态：草稿先落这张独立表，
-- 用户在应用内逐条确认后才通过正常领域命令进入 plans 集合（domain_entities）。
-- 结构与 0010 的 nutrition_label_drafts 同构：revision 乐观锁 + status 状态机
-- + payload_json 存内容 + plan_id 回填确认成果。
--
-- checks_json 存导入时逐条菜目的三项校验结果（menu_drafts.rs 导入时写入），
-- 确认前要求全部通过；想修就改上游后重新导入，不提供「带病确认」。

CREATE TABLE IF NOT EXISTS menu_drafts (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','discarded')),
  payload_json TEXT NOT NULL,
  checks_json TEXT NOT NULL DEFAULT '[]',
  plan_id TEXT,
  plan_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_menu_drafts_status_updated ON menu_drafts(status, updated_at);
