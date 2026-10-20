use crate::domain_commands::{array, array_mut, now_and_date, CommandMutation};
use serde::Deserialize;
use serde_json::{json, Map, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ingredient {
    food_version_id: String,
    quantity: f64,
    unit: String,
    inventory_food_id: String,
    inventory_unit: String,
    inventory_confirmed: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecipeInput {
    name: String,
    total_minutes: f64,
    equipment: Vec<String>,
    ingredients: Vec<Ingredient>,
    recipe_id: Option<String>,
    expected_version_id: Option<String>,
}

pub(crate) fn apply(
    state: &mut Map<String, Value>,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let input: RecipeInput =
        serde_json::from_value(payload.clone()).map_err(|e| format!("菜谱字段无效：{e}"))?;
    if input.name.trim().is_empty() || input.name.chars().count() > 120 {
        return Err("菜谱名称必填，最多 120 字。".into());
    }
    if !input.total_minutes.is_finite()
        || input.total_minutes <= 0.0
        || input.total_minutes > 1440.0
    {
        return Err("烹饪时间应在 0–1440 分钟之间。".into());
    }
    if input.ingredients.is_empty() || input.ingredients.len() > 50 {
        return Err("一道菜需要 1–50 项原料。".into());
    }
    if input.equipment.is_empty() || input.equipment.len() > 10 {
        return Err("请选择实际使用的厨具。".into());
    }
    let allowed = state["profile"]["equipment"]
        .as_array()
        .cloned()
        .unwrap_or_else(|| {
            vec![
                json!("电饭煲"),
                json!("电磁炉"),
                json!("微波炉"),
                json!("基础锅具"),
            ]
        });
    if input
        .equipment
        .iter()
        .any(|e| !allowed.iter().any(|v| v == e))
    {
        return Err("菜谱使用了个人配置中未启用的厨具。".into());
    }
    let (recipe_id, number) = if let Some(id) = input.recipe_id.as_deref() {
        let latest = array(state, "recipes")?
            .iter()
            .filter(|v| v["recipeId"] == id)
            .max_by_key(|v| v["version"].as_u64().unwrap_or(0))
            .ok_or("菜谱不存在。")?;
        if latest["id"].as_str() != input.expected_version_id.as_deref() {
            return Err("菜谱已更新，请刷新后基于最新版本修订。".into());
        }
        (
            id.to_owned(),
            latest["version"]
                .as_u64()
                .unwrap_or(0)
                .checked_add(1)
                .ok_or("菜谱版本溢出。")?,
        )
    } else {
        (format!("recipe-{command_id}"), 1)
    };
    let mut ingredients = Vec::new();
    let mut totals = [0.0; 7];
    let mut complete = [true; 7];
    let keys = [
        "calories",
        "protein",
        "carbohydrates",
        "fat",
        "fiber",
        "sugar",
        "sodium",
    ];
    for item in input.ingredients {
        if !item.inventory_confirmed {
            return Err("请逐项核对库存品牌、生熟状态、净重和可食部分。".into());
        }
        if !["g", "ml", "piece"].contains(&item.inventory_unit.as_str()) {
            return Err("库存仅按克、毫升或个扣减，份和包装需要已确认换算。".into());
        }
        let snapshot = crate::food_library::historical_portion(
            state,
            &item.food_version_id,
            item.quantity,
            &item.unit,
        )?;
        let definition = &snapshot["definition"];
        let unit_preview = crate::food_library::historical_portion(
            state,
            &item.food_version_id,
            1.0,
            &item.inventory_unit,
        )?;
        let amount = snapshot["factor"].as_f64().ok_or("换算系数缺失。")?
            / unit_preview["factor"].as_f64().ok_or("库存换算缺失。")?;
        if !amount.is_finite() || !(0.0001..=1e9).contains(&amount) {
            return Err("库存扣减量过小或过大，请核对规格。".into());
        }
        let amount = (amount * 10000.0).round() / 10000.0;
        if item.inventory_food_id.is_empty() {
            return Err("每项原料需要明确库存身份，不按同名自动匹配。".into());
        }
        if item.inventory_food_id != definition["id"].as_str().unwrap_or("") {
            if array(state, "foodDefinitions")?
                .iter()
                .any(|v| v["id"] == item.inventory_food_id)
            {
                return Err(
                    "不能把另一食材或品牌的库存绑定到这款营养资料，请选择相应食材。".into(),
                );
            }
            let known = array(state, "inventory")?
                .iter()
                .any(|v| v["foodId"] == item.inventory_food_id && v["unit"] == item.inventory_unit)
                || array(state, "recipes")?
                    .iter()
                    .flat_map(|v| v["ingredients"].as_array().into_iter().flatten())
                    .any(|v| {
                        v["foodId"] == item.inventory_food_id && v["unit"] == item.inventory_unit
                    });
            if !known {
                return Err("所选库存关联不存在或单位不一致。".into());
            }
        }
        if ingredients.iter().any(|v: &Value| {
            v["foodId"] == item.inventory_food_id && v["unit"] != item.inventory_unit
        }) {
            return Err("同一库存食材不能使用不同基础单位。".into());
        }
        for (index, key) in keys.iter().enumerate() {
            let metric = &snapshot["nutrition"][key];
            if metric["state"] == "unknown" {
                complete[index] = false;
            } else {
                totals[index] += metric["value"].as_f64().ok_or("营养值缺失。")?;
                if !totals[index].is_finite() {
                    return Err("整锅营养溢出。".into());
                }
            }
        }
        let basis = definition["measurementBasis"].as_str().unwrap_or("raw");
        ingredients.push(json!({"foodId":item.inventory_food_id,"name":definition["name"],"amount":amount,"unit":item.inventory_unit,"measurementBasis":if basis=="packaged"{"package"}else{basis},"foodVersionId":item.food_version_id,"nutritionQuantity":item.quantity,"nutritionUnit":item.unit,"foodSnapshot":snapshot,"inventoryConfirmed":true}));
    }
    let mut nutrition = Map::new();
    for (index, key) in keys.iter().enumerate() {
        let unit = if *key == "calories" {
            "kcal"
        } else if *key == "sodium" {
            "mg"
        } else {
            "g"
        };
        let mut metric = json!({"state":if !complete[index]{"unknown"}else if totals[index]==0.0{"zero"}else{"known"},"unit":unit,"source":"personal","confidence":if complete[index]{"high"}else{"low"}});
        if complete[index] {
            metric["value"] = json!(totals[index]);
        }
        nutrition.insert((*key).into(), metric);
    }
    let (now, _) = now_and_date();
    let id = format!("recipe-version-{command_id}");
    let recipe = json!({"id":id,"recipeId":recipe_id,"name":input.name.trim(),"version":number,"ingredients":ingredients,"nutrition":nutrition,"totalMinutes":input.total_minutes,"equipment":input.equipment,"source":"personal","confirmedBy":state["profile"]["name"],"confirmedAt":now,"createdAt":now});
    array_mut(state, "recipes")?.push(recipe.clone());
    array_mut(state,"auditEvents")?.push(json!({"id":format!("{command_id}:audit"),"eventType":"save_recipe_version","entityType":"recipe","entityId":id,"createdAt":now,"payload":{"commandId":command_id,"previousVersionId":input.expected_version_id,"recipe":recipe}}));
    Ok(CommandMutation {
        applied: true,
        result: json!({"recipeVersionId":id,"recipeId":recipe_id}),
    })
}
