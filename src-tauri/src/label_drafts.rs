use crate::domain_commands::{array, array_mut, now_and_date, payload_str, CommandMutation};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use tauri::AppHandle;

const KEYS: [&str; 7] = [
    "calories",
    "protein",
    "carbohydrates",
    "fat",
    "fiber",
    "sugar",
    "sodium",
];
const UNITS: [&str; 5] = ["g", "ml", "piece", "serving", "package"];
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawConversion {
    unit: String,
    quantity: String,
    basis_quantity: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LabelForm {
    name: String,
    brand: String,
    measurement_basis: String,
    basis_quantity: String,
    basis_unit: String,
    energy_unit: String,
    sodium_unit: String,
    nutrients: BTreeMap<String, String>,
    /// 标签 NRV%（GB 28050）。旧草稿没有该字段，serde(default) 保证向后兼容；空表 = 跳过 NRV 校验。
    #[serde(default)]
    nrv: BTreeMap<String, String>,
    conversions: Vec<RawConversion>,
    net_quantity: String,
    net_unit: String,
    drained_quantity: String,
    drained_unit: String,
    source_note: String,
}
/// NRV% 的可信上限：常规食品很难超过 500%（如鱼肝油的维生素类不在此表），超出基本是录错行。
const NRV_PERCENT_MAX: f64 = 500.0;
fn parse_nrv(f: &LabelForm) -> Result<Value, String> {
    let mut map = Map::new();
    for (key, raw) in &f.nrv {
        if !KEYS.contains(&key.as_str()) {
            return Err("NRV% 营养项目无效。".into());
        }
        if raw.len() > 16 {
            return Err("NRV% 数值过长。".into());
        }
        if raw.trim().is_empty() {
            continue;
        }
        let percent = number(raw, "NRV%", false)?;
        if percent > NRV_PERCENT_MAX {
            return Err(format!(
                "{key} 的 NRV% {percent:.0} 超出可信范围（≤{NRV_PERCENT_MAX:.0}%），请核对是否录错行或把含量当成了百分比。"
            ));
        }
        map.insert(key.clone(), json!(percent));
    }
    Ok(Value::Object(map))
}
fn parse_form(raw: &Value) -> Result<LabelForm, String> {
    let mut form: LabelForm =
        serde_json::from_value(raw.clone()).map_err(|e| format!("草稿字段无效：{e}"))?;
    for key in KEYS {
        form.nutrients.entry(key.into()).or_default();
    }
    if form.name.chars().count() > 120
        || form.brand.chars().count() > 120
        || form.source_note.chars().count() > 1000
        || form.nutrients.keys().any(|k| !KEYS.contains(&k.as_str()))
        || form.nutrients.values().any(|v| v.len() > 64)
        || [
            &form.basis_quantity,
            &form.net_quantity,
            &form.drained_quantity,
        ]
        .iter()
        .any(|v| v.len() > 64)
        || form.conversions.len() > 4
        || form.conversions.iter().any(|c| {
            c.quantity.len() > 64
                || c.basis_quantity.len() > 64
                || !UNITS.contains(&c.unit.as_str())
        })
    {
        return Err("草稿文字过长、营养项目无效或换算超过四项。".into());
    }
    if !UNITS.contains(&form.basis_unit.as_str())
        || !["g", "kg", "ml", "l"].contains(&form.net_unit.as_str())
        || !["g", "kg"].contains(&form.drained_unit.as_str())
        || !["kcal", "kJ"].contains(&form.energy_unit.as_str())
        || !["g", "mg"].contains(&form.sodium_unit.as_str())
        || !["raw", "cooked", "packaged", "edible"].contains(&form.measurement_basis.as_str())
    {
        return Err("计量或营养单位无效。".into());
    }
    Ok(form)
}
fn number(text: &str, field: &str, positive: bool) -> Result<f64, String> {
    let s = text.trim();
    if s.is_empty()
        || !s.chars().all(|c| c.is_ascii_digit() || c == '.')
        || s.chars().filter(|c| *c == '.').count() > 1
    {
        return Err(format!(
            "{field} 请输入明确小数，不接受逗号、范围或文字；未知营养请留空。"
        ));
    }
    let n = s
        .parse::<f64>()
        .map_err(|_| format!("{field} 数字无效。"))?;
    if !n.is_finite() || n < 0.0 || (positive && n == 0.0) {
        return Err(format!(
            "{field} 数量须为{}有限数值。",
            if positive { "正" } else { "非负" }
        ));
    }
    Ok(n)
}
pub(crate) fn preview_form(raw: &Value) -> Result<Value, String> {
    let f = parse_form(raw)?;
    let mut nutrients = Map::new();
    for key in KEYS {
        if let Some(s) = f.nutrients.get(key).filter(|s| !s.trim().is_empty()) {
            let n = number(s, key, false)?
                * if key == "sodium" && f.sodium_unit == "g" {
                    1000.0
                } else {
                    1.0
                };
            nutrients.insert(key.into(), json!(n));
        }
    }
    if nutrients.is_empty() {
        return Err("至少核对一项营养再确认；不完整资料可以先保存草稿。".into());
    }
    let basis = number(&f.basis_quantity, "标签参考数量", true)?;
    let conversions=f.conversions.iter().map(|c|Ok(json!({"unit":c.unit,"quantity":number(&c.quantity,"换算数量",true)?,"basisQuantity":number(&c.basis_quantity,"对应参考数量",true)?}))).collect::<Result<Vec<_>,String>>()?;
    let net = if f.net_quantity.trim().is_empty() {
        None
    } else {
        Some(number(&f.net_quantity, "净含量", true)?)
    };
    if !f.drained_quantity.trim().is_empty() {
        let drained = number(&f.drained_quantity, "沥干物量", true)?
            * if f.drained_unit == "kg" { 1000.0 } else { 1.0 };
        let mass = net.map(|n| n * if f.net_unit == "kg" { 1000.0 } else { 1.0 });
        if !["g", "kg"].contains(&f.net_unit.as_str()) || mass.is_none_or(|n| drained > n) {
            return Err("沥干物量需要已知重量净含量，且不能大于净含量；不猜测密度。".into());
        }
    }
    let input = json!({"name":f.name,"brand":f.brand,"measurementBasis":f.measurement_basis,"basis":{"quantity":basis,"unit":f.basis_unit},"energyUnit":f.energy_unit,"nutrients":nutrients,"conversions":conversions,"source":"label"});
    // 标注能量先按同一口径折成 kcal，再交给三项校验；原始 kJ 值仍原样留在 input 里。
    let declared = crate::label_checks::declared_kcal(
        nutrients.get("calories").and_then(Value::as_f64),
        &f.energy_unit,
    );
    let preview = crate::food_library::preview_input(&json!({"input":input}))?;
    // 三项交叉校验：能量上限、Atwater 自洽、NRV% 反推、每份规格量级。
    // 标签给了 NRV% 就交给 nrv_check 反推；没给传空表，整体跳过。
    let nrv = parse_nrv(&f)?;
    crate::label_checks::run_all(&preview, &f.basis_unit, basis, &nrv, None)?;
    Ok(json!({"input":input,"preview":preview,"declaredKcal":declared,"nrv":nrv}))
}

fn get(connection: &Connection, id: &str) -> Result<Value, String> {
    let raw:Option<Value>=connection.query_row("SELECT d.id,d.revision,d.status,d.form_json,d.source_receipt_id,d.source_artifact_id,d.food_id,d.food_version_id,d.created_at,d.updated_at,r.name,r.mime,r.unavailable FROM nutrition_label_drafts d LEFT JOIN (SELECT ir.id,a.name,a.mime,(a.original IS NULL OR a.trashed_at IS NOT NULL OR a.purged_at IS NOT NULL) AS unavailable FROM input_receipts ir LEFT JOIN input_artifact_objects a ON a.id=ir.artifact_id) r ON r.id=d.source_receipt_id WHERE d.id=?1",[id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"revision":r.get::<_,i64>(1)?,"status":r.get::<_,String>(2)?,"form":r.get::<_,String>(3)?,"sourceReceiptId":r.get::<_,Option<String>>(4)?,"sourceArtifactId":r.get::<_,Option<String>>(5)?,"foodId":r.get::<_,Option<String>>(6)?,"foodVersionId":r.get::<_,Option<String>>(7)?,"createdAt":r.get::<_,String>(8)?,"updatedAt":r.get::<_,String>(9)?,"sourceName":r.get::<_,Option<String>>(10)?,"sourceMime":r.get::<_,Option<String>>(11)?,"sourceUnavailable":r.get::<_,Option<bool>>(12)?.unwrap_or(false)}))).optional().map_err(|e|e.to_string())?;
    let mut record = raw.ok_or("营养草稿不存在。")?;
    let parsed = serde_json::from_str(record["form"].as_str().ok_or("草稿内容损坏。")?)
        .map_err(|e| format!("草稿内容损坏：{e}"))?;
    record["form"] =
        serde_json::to_value(parse_form(&parsed)?).map_err(|e| format!("草稿字段损坏：{e}"))?;
    Ok(record)
}
pub(crate) fn list(connection: &Connection, status: &str, offset: u32) -> Result<Value, String> {
    if !["draft", "confirmed", "discarded", "all"].contains(&status) {
        return Err("草稿筛选无效。".into());
    }
    let mut stmt=connection.prepare("SELECT id,revision,status,json_extract(form_json,'$.name'),source_receipt_id,food_id,updated_at FROM nutrition_label_drafts WHERE ?1='all' OR status=?1 ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?2").map_err(|e|e.to_string())?;
    let mut items=stmt.query_map(params![status,offset],|r|Ok(json!({"id":r.get::<_,String>(0)?,"revision":r.get::<_,i64>(1)?,"status":r.get::<_,String>(2)?,"name":r.get::<_,Option<String>>(3)?,"sourceReceiptId":r.get::<_,Option<String>>(4)?,"foodId":r.get::<_,Option<String>>(5)?,"updatedAt":r.get::<_,String>(6)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    let more = items.len() > 50;
    items.truncate(50);
    Ok(json!({"items":items,"hasMore":more}))
}
pub(crate) fn manifest(connection: &Connection) -> Result<Value, String> {
    let mut stmt = connection
        .prepare("SELECT id FROM nutrition_label_drafts ORDER BY id")
        .map_err(|e| e.to_string())?;
    let ids = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(json!(ids
        .iter()
        .map(|id| get(connection, id))
        .collect::<Result<Vec<_>, _>>()?))
}
pub(crate) fn apply(
    state: &mut Map<String, Value>,
    connection: &Connection,
    kind: &str,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let (now, _) = now_and_date();
    let id = payload
        .get("draftId")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("label-draft-{command_id}"));
    if id.len() > 220 {
        return Err("草稿标识无效。".into());
    }
    let before = match get(connection, &id) {
        Ok(v) => Some(v),
        Err(e)
            if e == "营养草稿不存在。"
                && kind == "save_label_draft"
                && payload.get("draftId").is_none() =>
        {
            None
        }
        Err(e) => return Err(e),
    };
    if let Some(old) = &before {
        if old["status"] != "draft" || old["revision"] != payload["expectedRevision"] {
            return Err("草稿已变更、已确认或已忽略，请刷新后继续；不会覆盖旧修改。".into());
        }
    }
    let mut result = json!({"draftId":id});
    match kind {
        "save_label_draft" => {
            let raw = payload.get("form").ok_or("缺少草稿内容。")?;
            let f = parse_form(raw)?;
            let source = payload.get("sourceReceiptId").and_then(Value::as_str);
            let source =
                source.or_else(|| before.as_ref().and_then(|v| v["sourceReceiptId"].as_str()));
            if let Some(old) = &before {
                if source != old["sourceReceiptId"].as_str() {
                    return Err("现有草稿的来源不能更换，请另建草稿。".into());
                }
            }
            let artifact: Option<String> = if let Some(source) = source {
                connection
                    .query_row(
                        "SELECT artifact_id FROM input_receipts WHERE id=?1",
                        [source],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?
                    .ok_or("来源接收记录不存在。")?
            } else {
                None
            };
            let revision = before
                .as_ref()
                .and_then(|v| v["revision"].as_i64())
                .unwrap_or(0)
                .checked_add(1)
                .ok_or("草稿版本溢出。")?;
            connection.execute("INSERT INTO nutrition_label_drafts(id,revision,status,form_json,source_receipt_id,source_artifact_id,created_at,updated_at) VALUES(?1,?2,'draft',?3,?4,?5,?6,?6) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,form_json=excluded.form_json,updated_at=excluded.updated_at",params![id,revision,serde_json::to_string(&f).map_err(|e|e.to_string())?,source,artifact,now]).map_err(|e|e.to_string())?;
            result["draftRevision"] = json!(revision);
        }
        "confirm_label_draft" => {
            let old = before.as_ref().ok_or("请先保存草稿。")?;
            for flag in ["energy", "basis", "packaging", "unknowns"] {
                if payload["review"][flag] != true {
                    return Err("请逐项核对千焦／千卡、参考规格、包装换算与未知营养。".into());
                }
            }
            let p = preview_form(&old["form"])?;
            let duplicate = array(state, "foodDefinitions")?.iter().any(|f| {
                f["name"].as_str().unwrap_or("").trim()
                    == p["input"]["name"].as_str().unwrap_or("").trim()
                    && f["brand"].as_str().unwrap_or("").trim()
                        == p["input"]["brand"].as_str().unwrap_or("").trim()
                    && f["measurementBasis"] == p["input"]["measurementBasis"]
            });
            if duplicate && payload["allowDuplicate"] != true {
                return Err(
                    "食材库已有同名、同品牌、同状态资料；请核对是否重复，或明确选择另建一份。"
                        .into(),
                );
            }
            let food = crate::food_library::apply(
                state,
                "save_food_definition",
                &json!({"input":p["input"]}),
                command_id,
            )?;
            let version_id = payload_str(&food.result, "foodVersionId")?;
            let origin = json!({"method":"manual_label","labelDraftId":id,"sourceReceiptId":old["sourceReceiptId"],"artifactId":old["sourceArtifactId"],"confirmedAt":now});
            let version = array_mut(state, "foodDefinitionVersions")?
                .iter_mut()
                .find(|v| v["id"] == version_id)
                .ok_or("食材版本未建立。")?;
            version["origin"] = origin;
            connection.execute("UPDATE nutrition_label_drafts SET status='confirmed',food_id=?1,food_version_id=?2,updated_at=?3 WHERE id=?4",params![payload_str(&food.result,"foodId")?,version_id,now,id]).map_err(|e|e.to_string())?;
            result["foodId"] = food.result["foodId"].clone();
            result["foodVersionId"] = food.result["foodVersionId"].clone();
        }
        "discard_label_draft" => {
            let reason = payload_str(payload, "reason")?;
            if reason.chars().count() > 500 {
                return Err("忽略原因最多 500 字。".into());
            }
            connection.execute("UPDATE nutrition_label_drafts SET status='discarded',updated_at=?1 WHERE id=?2",params![now,id]).map_err(|e|e.to_string())?;
        }
        _ => return Err("未知草稿命令。".into()),
    }
    if let Some(source) = get(connection, &id)?["sourceReceiptId"].as_str() {
        connection
            .execute(
                "UPDATE input_receipts SET status='drafted' WHERE id=?1 AND status='unreviewed'",
                [source],
            )
            .map_err(|e| e.to_string())?;
    }
    array_mut(state,"auditEvents")?.push(json!({"id":format!("{command_id}:label-audit"),"eventType":kind,"entityType":"nutrition_label_draft","entityId":id,"createdAt":now,"payload":{"commandId":command_id,"before":before,"after":get(connection,&id)?,"reason":payload.get("reason"),"method":"manual_label"}}));
    Ok(CommandMutation {
        applied: true,
        result,
    })
}
#[tauri::command]
pub fn list_label_drafts(app: AppHandle, status: String, offset: u32) -> Result<Value, String> {
    list(&crate::domain_store::open_database(&app)?, &status, offset)
}
#[tauri::command]
pub fn get_label_draft(app: AppHandle, id: String) -> Result<Value, String> {
    get(&crate::domain_store::open_database(&app)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn form_json(nrv: Value) -> Value {
        json!({
            "name": "测试燕麦", "brand": "", "measurementBasis": "packaged",
            "basisQuantity": "100", "basisUnit": "g", "energyUnit": "kcal", "sodiumUnit": "mg",
            "nutrients": {"calories": "300", "protein": "6", "carbohydrates": "30", "fat": "10", "fiber": "", "sugar": "", "sodium": "200"},
            "nrv": nrv,
            "conversions": [], "netQuantity": "", "netUnit": "g", "drainedQuantity": "", "drainedUnit": "g",
            "sourceNote": ""
        })
    }

    #[test]
    fn old_drafts_without_nrv_field_still_parse() {
        // 0.6.2 存量的草稿没有 nrv 字段：serde(default) 必须兜住，不能让升级后草稿打不开。
        let mut raw = form_json(json!({}));
        raw.as_object_mut().unwrap().remove("nrv");
        let f = parse_form(&raw).unwrap();
        assert!(f.nrv.is_empty());
    }

    #[test]
    fn preview_form_passes_consistent_nrv_and_echoes_it() {
        // 蛋白 6g / NRV 60g = 10%，与录入一致；返回值带回 nrv 供 UI 复核。
        let out = preview_form(&form_json(json!({"protein": "10"}))).unwrap();
        assert_eq!(out["nrv"]["protein"], json!(10.0));
    }

    #[test]
    fn preview_form_blocks_a_conflicting_nrv_label() {
        // 蛋白 30% NRV = 18g，与录入 6g 对不上：这就是「录错行」的典型样本。
        let err = preview_form(&form_json(json!({"protein": "30"}))).unwrap_err();
        assert!(err.contains("NRV"), "{err}");
        assert!(err.contains("protein"), "{err}");
    }

    #[test]
    fn nrv_percent_out_of_range_is_rejected() {
        let err = preview_form(&form_json(json!({"protein": "600"}))).unwrap_err();
        assert!(err.contains("超出可信范围"), "{err}");
        // 0% 与「未检出」互为印证，是合法标注。
        assert!(preview_form(&form_json(json!({"sugar": "0"}))).is_ok());
    }

    #[test]
    fn empty_nrv_keeps_the_check_skipped() {
        // 没给 NRV% 时行为与 0.6.2 完全一致：整体跳过，不按 0 处理。
        assert!(preview_form(&form_json(json!({}))).is_ok());
    }
}
