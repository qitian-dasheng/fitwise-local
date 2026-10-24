use crate::domain_commands::{array, array_mut, now_and_date, payload_str, CommandMutation};
use crate::food_library::{historical_portion, PortionRequest};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

/// 菜谱快速入餐：把菜谱版本里的原料按本次实际份量带入目标日期与餐次。
///
/// 与 record_food_meal 的关键区别：逐项走 historical_portion，钉住菜谱快照
/// 里的食材版本——菜谱创建后食材被修订，带入的仍是原口径。因此条目必须来自
/// 该菜谱版本本身，不接受自由食材清单（防止借菜谱溯源写入任意版本）。
/// 与 copy_meal 的区别：目标餐次允许已有记录，按需追加；同一菜谱可在不同
/// 日期/餐次重复加入，重复加入是新的 commandId，合法。
pub(crate) fn apply(
    state: &mut Map<String, Value>,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let (now, today) = now_and_date();
    let date = crate::record_commands::date(payload)?;
    if date > today {
        return Err("记餐日期不能晚于今天。".into());
    }
    let meal_type = payload_str(payload, "type")?;
    if !["breakfast", "lunch", "dinner", "snack"].contains(&meal_type) {
        return Err("餐次无效。".into());
    }
    let recipe_version_id = payload_str(payload, "recipeVersionId")?;
    let entries: Vec<PortionRequest> = serde_json::from_value(
        payload.get("entries").cloned().ok_or("没有待记餐食物。")?,
    )
    .map_err(|error| format!("记餐份量无效：{error}"))?;
    if entries.is_empty() || entries.len() > 50 {
        return Err("一次可确认 1–50 项食物。".into());
    }

    // 菜谱版本必须存在；条目只能来自它的原料快照（含历史版本）。
    let recipe = array(state, "recipes")?
        .iter()
        .find(|item| item["id"] == recipe_version_id)
        .ok_or("找不到菜谱版本，请刷新后重新加入。")?
        .clone();
    let allowed: BTreeSet<String> = recipe["ingredients"]
        .as_array()
        .ok_or("菜谱原料缺失。")?
        .iter()
        .filter_map(|item| item["foodVersionId"].as_str().map(str::to_owned))
        .collect();
    if allowed.is_empty() {
        return Err("菜谱没有可带入的原料。".into());
    }

    let mut meals = Vec::new();
    let mut ids = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        if !allowed.contains(&entry.food_version_id) {
            return Err("草稿中的食材不属于该菜谱版本，请刷新后重新加入。".into());
        }
        let unit = serde_json::to_value(entry.unit)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .ok_or("计量单位无效。")?;
        let preview = historical_portion(state, &entry.food_version_id, entry.quantity, &unit)?;
        let definition = &preview["definition"];
        let meal_id = format!("{command_id}:recipe-meal:{index}");
        ids.push(meal_id.clone());
        meals.push(json!({
            "id": meal_id,
            "date": date,
            "type": meal_type,
            "name": definition["name"],
            "amountLabel": format!("{}{} · {}", entry.quantity, entry.unit.label(), definition["brand"].as_str().unwrap_or("个人食材库")),
            "nutrition": preview["nutrition"],
            "consumedRatio": 1,
            "source": preview["version"]["source"],
            "confidence": "high",
            "foodDefinitionId": definition["id"],
            "foodVersionId": preview["version"]["id"],
            "recipeVersionId": recipe_version_id,
            "foodSnapshot": {
                "definition": definition,
                "version": preview["version"],
                "quantity": entry.quantity,
                "unit": entry.unit,
                "factor": preview["factor"],
                "basisQuantity": preview["basisQuantity"],
            },
            "createdAt": now,
        }));
    }
    array_mut(state, "meals")?.extend(meals);

    crate::record_commands::audit(
        state,
        command_id,
        "recipe_meal_recorded",
        "meal",
        &format!("{date}:{meal_type}"),
        json!({
            "date": date,
            "type": meal_type,
            "recipeVersionId": recipe_version_id,
            "count": ids.len(),
            "entryIds": &ids,
        }),
    )?;
    Ok(CommandMutation {
        applied: true,
        result: json!({
            "date": date,
            "type": meal_type,
            "recipeVersionId": recipe_version_id,
            "count": ids.len(),
            "entryIds": ids,
        }),
    })
}
