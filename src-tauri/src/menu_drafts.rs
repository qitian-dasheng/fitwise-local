//! M3：AI 菜单草稿导入通道。
//!
//! 外部 Agent 只能产出菜单草稿，不能直写领域状态、不能删改正式记录、不能改目标：
//! 草稿先落 `menu_drafts` 表（0013 迁移），用户在应用内逐条确认后才通过
//! `confirm_menu_draft` 领域命令进入 plans 集合。确认是唯一入口，因此
//! 「草稿未确认不出现在任何统计里」由结构保证——统计只读 plans / meals。
//!
//! 导入时对每条菜目跑 0.6.2 的同一套三项校验（label_checks::run_all），
//! 结果存进 checks_json；确认前要求全部通过，想修就改上游后重新导入。

use crate::domain_commands::{array_mut, now_and_date, payload_str, CommandMutation};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use tauri::AppHandle;

const ITEM_KEYS: [&str; 7] = [
    "calories",
    "protein",
    "carbohydrates",
    "fat",
    "fiber",
    "sugar",
    "sodium",
];
const BASIS_UNITS: [&str; 5] = ["g", "ml", "piece", "serving", "package"];

/// 菜目营养的硬上限：单条菜目的标注能量超过 5000 kcal / 钠超过 50 g 只能是单位录错。
const ITEM_CALORIES_MAX: f64 = 5000.0;
const ITEM_SODIUM_MAX_MG: f64 = 50000.0;
/// NRV% 的可信上限，与标签草稿（label_drafts.rs）同一口径。
const NRV_PERCENT_MAX: f64 = 500.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuItem {
    name: String,
    /// 营养规格可选（0.8.1 简化）：给 nutrients 才要求规格并跑三项校验；
    /// 只给名字的菜目跳过校验（check_items 记「无营养数据，未校验」）。
    #[serde(default)]
    basis_quantity: Option<f64>,
    #[serde(default)]
    basis_unit: Option<String>,
    #[serde(default = "default_energy_unit")]
    energy_unit: String,
    #[serde(default)]
    nutrients: BTreeMap<String, f64>,
    /// NRV% 数字表。0.8.1 起与前端轻校验、格式示例同口径（数字）；0.7.0 误用
    /// 字符串表，导致 `{"protein": 40}` 这类合法输入被「expected a string」拒收。
    #[serde(default)]
    nrv: BTreeMap<String, f64>,
}

fn default_energy_unit() -> String {
    "kcal".into()
}

/// 外部 Agent 产出的菜单草稿。故意**不**用 deny_unknown_fields：
/// 草稿由外部模型生成，多余的说明字段应当被忽略而不是拒绝整个导入。
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuDraft {
    date: String,
    title: String,
    #[serde(default)]
    description: String,
    calories_kcal: f64,
    protein_g: f64,
    #[serde(default)]
    fiber_g: f64,
    #[serde(default)]
    estimated_cost_cny: f64,
    #[serde(default)]
    cooking_minutes: f64,
    #[serde(default)]
    inventory_coverage: f64,
    #[serde(default)]
    missing_ingredients: Vec<String>,
    #[serde(default)]
    reasons: Vec<String>,
    items: Vec<MenuItem>,
}

fn parse_draft(raw: &Value) -> Result<MenuDraft, String> {
    let draft: MenuDraft = serde_json::from_value(raw.clone())
        .map_err(|e| format!("草稿结构无效：{e}。请按应用给出的草稿格式让外部 AI 重新输出。"))?;
    if !is_iso_date(&draft.date) {
        return Err("草稿日期无效：需要 YYYY-MM-DD。".into());
    }
    if draft.title.trim().is_empty() || draft.title.chars().count() > 120 {
        return Err("草稿标题须为 1–120 字。".into());
    }
    if draft.description.chars().count() > 500 {
        return Err("草稿说明最多 500 字。".into());
    }
    if !(0.0..=8000.0).contains(&draft.calories_kcal) || !(0.0..=500.0).contains(&draft.protein_g) {
        return Err("草稿热量（≤8000 kcal）或蛋白（≤500 g）超出可信范围。".into());
    }
    if !(0.0..=200.0).contains(&draft.fiber_g)
        || !(0.0..=10000.0).contains(&draft.estimated_cost_cny)
        || !(0.0..=1440.0).contains(&draft.cooking_minutes)
        || !(0.0..=100.0).contains(&draft.inventory_coverage)
    {
        return Err("草稿纤维 / 成本 / 用时 / 库存覆盖超出可信范围。".into());
    }
    if draft.reasons.len() > 5 || draft.reasons.iter().any(|r| r.chars().count() > 200) {
        return Err("理由最多 5 条、每条 200 字。".into());
    }
    if draft.missing_ingredients.len() > 20
        || draft
            .missing_ingredients
            .iter()
            .any(|m| m.chars().count() > 60)
    {
        return Err("缺失食材最多 20 项、每项 60 字。".into());
    }
    if draft.items.is_empty() || draft.items.len() > 20 {
        return Err("草稿须包含 1–20 条菜目。".into());
    }
    for item in &draft.items {
        validate_item(item)?;
    }
    Ok(draft)
}

fn is_iso_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        })
        && text[..4]
            .parse::<u16>()
            .map(|year| (2000..=2100).contains(&year))
            .unwrap_or(false)
        && text[5..7]
            .parse::<u8>()
            .map(|month| (1..=12).contains(&month))
            .unwrap_or(false)
        && text[8..10]
            .parse::<u8>()
            .map(|day| (1..=31).contains(&day))
            .unwrap_or(false)
}

fn validate_item(item: &MenuItem) -> Result<(), String> {
    if item.name.trim().is_empty() || item.name.chars().count() > 120 {
        return Err("菜目名称须为 1–120 字。".into());
    }
    // 只给名字的菜目（无营养表）跳过规格与营养校验——三项校验依赖营养数据。
    if item.nutrients.is_empty() {
        return Ok(());
    }
    let basis_unit = item.basis_unit.as_deref().ok_or_else(|| {
        format!(
            "菜目「{}」提供了营养数据，须同时给出参考规格（basisQuantity + basisUnit）。",
            item.name
        )
    })?;
    if !BASIS_UNITS.contains(&basis_unit) {
        return Err(format!("菜目「{}」的参考单位无效。", item.name));
    }
    let basis_quantity = item.basis_quantity.ok_or_else(|| {
        format!(
            "菜目「{}」提供了营养数据，须同时给出参考规格（basisQuantity + basisUnit）。",
            item.name
        )
    })?;
    if !basis_quantity.is_finite() || basis_quantity <= 0.0 || basis_quantity > 5000.0 {
        return Err(format!(
            "菜目「{}」的参考数量须在 (0, 5000] 内。",
            item.name
        ));
    }
    if !["kcal", "kJ"].contains(&item.energy_unit.as_str()) {
        return Err(format!("菜目「{}」的能量单位无效。", item.name));
    }
    for (key, value) in &item.nutrients {
        if !ITEM_KEYS.contains(&key.as_str()) {
            return Err(format!("菜目「{}」存在未知营养项目 {key}。", item.name));
        }
        if !value.is_finite() || *value < 0.0 {
            return Err(format!(
                "菜目「{}」的营养值 {key} 须为非负有限数。",
                item.name
            ));
        }
        if key == "calories" && *value > ITEM_CALORIES_MAX {
            return Err(format!(
                "菜目「{}」标注能量 {value:.0} 超出可信范围（≤{ITEM_CALORIES_MAX:.0}），请核对单位。",
                item.name
            ));
        }
        if key == "sodium" && *value > ITEM_SODIUM_MAX_MG {
            return Err(format!(
                "菜目「{}」的钠 {value:.0} mg 超出可信范围（≤{ITEM_SODIUM_MAX_MG:.0}），请核对单位（应为 mg）。",
                item.name
            ));
        }
    }
    for (key, percent) in &item.nrv {
        if !ITEM_KEYS.contains(&key.as_str()) {
            return Err(format!("菜目「{}」的 NRV% 项目 {key} 无效。", item.name));
        }
        if !percent.is_finite() || *percent < 0.0 || *percent > NRV_PERCENT_MAX {
            return Err(format!(
                "菜目「{}」的 NRV%（{key}）超出可信范围（≤{NRV_PERCENT_MAX:.0}%）。",
                item.name
            ));
        }
    }
    Ok(())
}

/// 逐条菜目跑 0.6.2 的同一套三项校验。没有营养数据的菜目（例如只给了名字）
/// 记为通过但注明「无营养数据」，不假装校验过。
fn check_items(draft: &MenuDraft) -> Value {
    let mut results = Vec::new();
    for item in &draft.items {
        if item.nutrients.is_empty() {
            results.push(json!({"name": item.name, "ok": true, "note": "无营养数据，未校验"}));
            continue;
        }
        let mut nutrients = Map::new();
        for (key, value) in &item.nutrients {
            nutrients.insert(key.clone(), json!(value));
        }
        // 走到这里的菜目都提供了营养表，规格字段在 validate_item 已强制存在；
        // unwrap_or 只是防御默认，正常路径不会用到。
        let basis_unit = item.basis_unit.as_deref().unwrap_or("g");
        let basis_quantity = item.basis_quantity.unwrap_or(100.0);
        let input = json!({
            "name": item.name, "brand": "", "measurementBasis": "packaged",
            "basis": {"quantity": basis_quantity, "unit": basis_unit},
            "energyUnit": item.energy_unit, "nutrients": nutrients,
            "conversions": [], "source": "label"
        });
        let nrv = Value::Object(
            item.nrv
                .iter()
                .filter(|(_, percent)| percent.is_finite())
                .map(|(key, percent)| (key.clone(), json!(percent)))
                .collect::<Map<String, Value>>(),
        );
        let outcome =
            crate::food_library::preview_input(&json!({"input": input})).and_then(|preview| {
                crate::label_checks::run_all(&preview, basis_unit, basis_quantity, &nrv, None)
            });
        match outcome {
            Ok(()) => results.push(json!({"name": item.name, "ok": true})),
            Err(error) => results.push(json!({"name": item.name, "ok": false, "error": error})),
        }
    }
    Value::Array(results)
}

fn get(connection: &Connection, id: &str) -> Result<Value, String> {
    let record = connection
        .query_row(
            "SELECT id,revision,status,payload_json,checks_json,plan_id,plan_date,created_at,updated_at \
             FROM menu_drafts WHERE id=?1",
            [id],
            |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "revision": row.get::<_, i64>(1)?,
                    "status": row.get::<_, String>(2)?,
                    "draft": row.get::<_, String>(3)?,
                    "checks": row.get::<_, String>(4)?,
                    "planId": row.get::<_, Option<String>>(5)?,
                    "date": row.get::<_, Option<String>>(6)?,
                    "createdAt": row.get::<_, String>(7)?,
                    "updatedAt": row.get::<_, String>(8)?,
                }))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("菜单草稿不存在。")?;
    let mut record = record;
    record["draft"] =
        serde_json::from_str::<Value>(record["draft"].as_str().ok_or("草稿内容损坏。")?)
            .map_err(|e| format!("草稿内容损坏：{e}"))?;
    record["checks"] =
        serde_json::from_str::<Value>(record["checks"].as_str().ok_or("校验结果损坏。")?)
            .map_err(|e| format!("校验结果损坏：{e}"))?;
    Ok(record)
}

pub(crate) fn list(connection: &Connection, status: &str, offset: u32) -> Result<Value, String> {
    if !["draft", "confirmed", "discarded", "all"].contains(&status) {
        return Err("草稿筛选无效。".into());
    }
    let mut statement = connection
        .prepare(
            "SELECT id,revision,status,json_extract(payload_json,'$.title'),plan_id,plan_date,updated_at, \
             (SELECT COUNT(*) FROM json_each(checks_json) WHERE json_extract(value,'$.ok')=0), \
             (SELECT COUNT(*) FROM json_each(checks_json)) \
             FROM menu_drafts WHERE ?1='all' OR status=?1 ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?2",
        )
        .map_err(|e| e.to_string())?;
    let mut items = statement
        .query_map(params![status, offset], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "revision": row.get::<_, i64>(1)?,
                "status": row.get::<_, String>(2)?,
                "title": row.get::<_, Option<String>>(3)?,
                "planId": row.get::<_, Option<String>>(4)?,
                "date": row.get::<_, Option<String>>(5)?,
                "updatedAt": row.get::<_, String>(6)?,
                "failingChecks": row.get::<_, i64>(7)?,
                "totalChecks": row.get::<_, i64>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let more = items.len() > 50;
    items.truncate(50);
    Ok(json!({"items": items, "hasMore": more}))
}

pub(crate) fn apply(
    state: &mut Map<String, Value>,
    connection: &Connection,
    kind: &str,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let (now, _) = now_and_date();
    let mut result = json!({});
    let audit_id: String;
    match kind {
        "import_menu_draft" => {
            let draft = parse_draft(payload.get("draft").ok_or("缺少草稿内容。")?)?;
            let checks = check_items(&draft);
            let id = format!("menu-draft-{command_id}");
            connection
                .execute(
                    "INSERT INTO menu_drafts(id,revision,status,payload_json,checks_json,plan_date,created_at,updated_at) \
                     VALUES(?1,1,'draft',?2,?3,?4,?5,?5)",
                    params![
                        id,
                        serde_json::to_string(&draft).map_err(|e| e.to_string())?,
                        serde_json::to_string(&checks).map_err(|e| e.to_string())?,
                        draft.date,
                        now
                    ],
                )
                .map_err(|e| e.to_string())?;
            let blocking = checks
                .as_array()
                .map(|items| items.iter().any(|item| item["ok"] == json!(false)))
                .unwrap_or(false);
            result = json!({
                "menuDraftId": id,
                "allChecksPassed": !blocking,
                "checks": checks,
            });
            audit_id = id.to_string();
        }
        "confirm_menu_draft" => {
            let id = payload_str(payload, "draftId")?;
            if id.len() > 220 {
                return Err("草稿标识无效。".into());
            }
            let old = get(connection, id)?;
            if old["status"] != "draft" || old["revision"] != payload["expectedRevision"] {
                return Err("草稿已确认、已忽略或已变更，请刷新后继续。".into());
            }
            let blocking = old["checks"]
                .as_array()
                .map(|items| items.iter().any(|item| item["ok"] == json!(false)))
                .unwrap_or(false);
            if blocking {
                return Err("草稿里有菜目未通过三项校验（Atwater / NRV% / 规格量级），请修正后重新导入；不能带病确认。".into());
            }
            let draft: MenuDraft = serde_json::from_value(old["draft"].clone())
                .map_err(|e| format!("草稿内容损坏：{e}"))?;
            let plan = json!({
                "id": format!("plan-{command_id}"),
                "date": draft.date,
                "title": draft.title,
                "description": draft.description,
                "caloriesKcal": draft.calories_kcal,
                "proteinG": draft.protein_g,
                "fiberG": draft.fiber_g,
                "estimatedCostCny": draft.estimated_cost_cny,
                "cookingMinutes": draft.cooking_minutes,
                "inventoryCoverage": draft.inventory_coverage,
                "reasons": draft.reasons,
                "missingIngredients": draft.missing_ingredients,
                "status": "candidate",
                "origin": "ai-draft",
                "menuDraftId": id,
            });
            array_mut(state, "plans")?.push(plan);
            connection
                .execute(
                    "UPDATE menu_drafts SET status='confirmed',plan_id=?1,plan_date=?2,updated_at=?3 WHERE id=?4",
                    params![format!("plan-{command_id}"), draft.date, now, id],
                )
                .map_err(|e| e.to_string())?;
            result = json!({"planId": format!("plan-{command_id}")});
            audit_id = id.to_string();
        }
        "discard_menu_draft" => {
            let id = payload_str(payload, "draftId")?;
            if id.len() > 220 {
                return Err("草稿标识无效。".into());
            }
            let old = get(connection, id)?;
            if old["status"] != "draft" || old["revision"] != payload["expectedRevision"] {
                return Err("草稿已确认、已忽略或已变更，请刷新后继续。".into());
            }
            connection
                .execute(
                    "UPDATE menu_drafts SET status='discarded',updated_at=?1 WHERE id=?2",
                    params![now, id],
                )
                .map_err(|e| e.to_string())?;
            audit_id = id.to_string();
        }
        _ => return Err("未知的菜单草稿命令。".into()),
    }
    let after = get(connection, audit_id.as_str())?;
    array_mut(state, "auditEvents")?.push(json!({
        "id": format!("{command_id}:menu-draft-audit"),
        "eventType": kind,
        "entityType": "menu_draft",
        "entityId": after["id"],
        "createdAt": now,
        "payload": {"commandId": command_id, "before": Value::Null, "after": after, "method": "ai_draft"},
    }));
    Ok(CommandMutation {
        applied: true,
        result,
    })
}

#[tauri::command]
pub fn list_menu_drafts(app: AppHandle, status: String, offset: u32) -> Result<Value, String> {
    list(&crate::domain_store::open_database(&app)?, &status, offset)
}

#[tauri::command]
pub fn get_menu_draft(app: AppHandle, id: String) -> Result<Value, String> {
    get(&crate::domain_store::open_database(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item(name: &str, nutrients: Value) -> Value {
        json!({"name": name, "basisQuantity": 100, "basisUnit": "g", "energyUnit": "kcal", "nutrients": nutrients})
    }

    /// 自洽样本：碳水 30、蛋白 6、脂肪 10 → 234 kcal 与标注 300 kcal 相差 22%，在 25% 容差内。
    fn draft_json() -> Value {
        json!({
            "date": "2026-10-23", "title": "标准锅日", "description": "测试草稿",
            "caloriesKcal": 2015, "proteinG": 160, "fiberG": 12,
            "estimatedCostCny": 18.5, "cookingMinutes": 30, "inventoryCoverage": 90,
            "missingIngredients": ["白菜"], "reasons": ["库存齐备"],
            "items": [
                item("白菜豆腐炖里脊", json!({"calories": 300, "protein": 6, "carbohydrates": 30, "fat": 10, "sodium": 200})),
                item("米饭", json!({}))
            ]
        })
    }

    fn memory_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(include_str!("../migrations/0013_menu_drafts.sql"))
            .unwrap();
        connection
    }

    fn state() -> Map<String, Value> {
        let mut state = Map::new();
        state.insert("plans".into(), json!([]));
        state.insert("auditEvents".into(), json!([]));
        state
    }

    #[test]
    fn import_runs_label_checks_per_item_and_reports_blocking_failures() {
        let connection = memory_connection();
        let mut draft = draft_json();
        // 把菜目能量改成 1674（kJ 量级）当 kcal 录：Atwater 会拦。
        draft["items"][0]["nutrients"]["calories"] = json!(1674);
        let mutation = apply(
            &mut state(),
            &connection,
            "import_menu_draft",
            &json!({"draft": draft}),
            "cmd-import-0001",
        )
        .unwrap();
        assert_eq!(mutation.result["allChecksPassed"], json!(false));
        let checks = mutation.result["checks"].as_array().unwrap();
        assert_eq!(checks.len(), 2);
        assert_eq!(checks[0]["ok"], json!(false));
        assert!(
            checks[0]["error"].as_str().unwrap().contains("千焦")
                || checks[0]["error"].as_str().unwrap().contains("相差")
        );
        // 没有营养数据的米饭：放行但注明未校验。
        assert_eq!(checks[1]["ok"], json!(true));
        assert_eq!(checks[1]["note"], json!("无营养数据，未校验"));
    }

    #[test]
    fn confirm_pushes_plan_with_ai_draft_origin_and_marks_row_confirmed() {
        let connection = memory_connection();
        let mut state = state();
        let imported = apply(
            &mut state,
            &connection,
            "import_menu_draft",
            &json!({"draft": draft_json()}),
            "cmd-confirm-0001",
        )
        .unwrap();
        let id = imported.result["menuDraftId"].as_str().unwrap().to_string();
        let confirmed = apply(
            &mut state,
            &connection,
            "confirm_menu_draft",
            &json!({"draftId": id, "expectedRevision": 1}),
            "cmd-confirm-0002",
        )
        .unwrap();
        let plans = state["plans"].as_array().unwrap();
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0]["origin"], json!("ai-draft"));
        assert_eq!(plans[0]["status"], json!("candidate"));
        assert_eq!(plans[0]["date"], json!("2026-10-23"));
        assert_eq!(plans[0]["menuDraftId"], json!(id));
        assert_eq!(confirmed.result["planId"], plans[0]["id"]);
        let row = get(&connection, &id).unwrap();
        assert_eq!(row["status"], json!("confirmed"));
        assert_eq!(row["planId"], plans[0]["id"]);
    }

    #[test]
    fn confirm_is_blocked_while_any_item_check_fails() {
        let connection = memory_connection();
        let mut state = state();
        let mut draft = draft_json();
        draft["items"][0]["nutrients"]["calories"] = json!(1674);
        let imported = apply(
            &mut state,
            &connection,
            "import_menu_draft",
            &json!({"draft": draft}),
            "cmd-block-0001",
        )
        .unwrap();
        let id = imported.result["menuDraftId"].as_str().unwrap().to_string();
        let error = apply(
            &mut state,
            &connection,
            "confirm_menu_draft",
            &json!({"draftId": id, "expectedRevision": 1}),
            "cmd-block-0002",
        )
        .unwrap_err();
        assert!(error.contains("带病确认"), "{error}");
        // 拒绝确认后草稿仍在、状态未变，用户可以丢弃。
        assert_eq!(get(&connection, &id).unwrap()["status"], json!("draft"));
    }

    #[test]
    fn discard_marks_row_without_touching_plans() {
        let connection = memory_connection();
        let mut state = state();
        let imported = apply(
            &mut state,
            &connection,
            "import_menu_draft",
            &json!({"draft": draft_json()}),
            "cmd-discard-0001",
        )
        .unwrap();
        let id = imported.result["menuDraftId"].as_str().unwrap().to_string();
        apply(
            &mut state,
            &connection,
            "discard_menu_draft",
            &json!({"draftId": id, "expectedRevision": 1}),
            "cmd-discard-0002",
        )
        .unwrap();
        assert_eq!(get(&connection, &id).unwrap()["status"], json!("discarded"));
        assert!(state["plans"].as_array().unwrap().is_empty());
    }

    #[test]
    fn parse_draft_rejects_structural_garbage() {
        let mut draft = draft_json();
        draft["date"] = json!("23/10/2026");
        assert!(parse_draft(&draft).is_err());
        draft["date"] = json!("2026-10-23");
        draft["title"] = json!("");
        assert!(parse_draft(&draft).is_err());
        draft["title"] = json!("标准锅日");
        draft["items"] = json!([]);
        assert!(parse_draft(&draft).is_err());
        // 多余的外部字段被忽略，不拒绝导入。
        let mut lenient = draft_json();
        lenient["generatedBy"] = json!("外部 AI");
        assert!(parse_draft(&lenient).is_ok());
    }
}

#[cfg(test)]
mod slim_contract_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn integer_nrv_values_are_accepted_matching_the_frontend_contract() {
        // 0.8.0 回归：前端与格式示例用数字（{"protein":40}），Rust 误用字符串表导致
        // 「expected a string」拒收。0.8.1 起同口径。
        let draft = json!({
            "date": "2026-10-23", "title": "整数NRV", "caloriesKcal": 500, "proteinG": 30,
            "items": [{"name": "燕麦粥", "basisQuantity": 100, "basisUnit": "g",
                       "nutrients": {"calories": 120, "protein": 6}, "nrv": {"protein": 40}}]
        });
        let parsed = parse_draft(&draft).unwrap();
        assert_eq!(parsed.items[0].nrv["protein"], json!(40.0));
    }

    #[test]
    fn name_only_items_skip_spec_and_checks() {
        let draft = json!({
            "date": "2026-10-23", "title": "骨架菜单", "caloriesKcal": 1800, "proteinG": 125,
            "items": [{"name": "早餐：燕麦鸡蛋粥配苹果"}, {"name": "午餐：白菜豆腐炖里脊"}]
        });
        let parsed = parse_draft(&draft).unwrap();
        assert!(parsed.items[0].basis_unit.is_none());
        let checks = check_items(&parsed);
        assert_eq!(checks[0]["ok"], json!(true));
        assert_eq!(checks[0]["note"], json!("无营养数据，未校验"));
    }

    #[test]
    fn nutrients_without_basis_spec_is_rejected_with_a_pointed_error() {
        let draft = json!({
            "date": "2026-10-23", "title": "缺规格", "caloriesKcal": 500, "proteinG": 30,
            "items": [{"name": "燕麦粥", "nutrients": {"calories": 120}}]
        });
        let err = parse_draft(&draft).unwrap_err();
        assert!(err.contains("参考规格"), "{err}");
    }
}
