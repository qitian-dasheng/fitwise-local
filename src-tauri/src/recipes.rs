use crate::domain_commands::{array, array_mut, now_and_date, CommandMutation};
use serde::Deserialize;
use serde_json::{json, Map, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ingredient {
    food_version_id: String,
    quantity: f64,
    unit: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecipeInput {
    name: String,
    total_minutes: f64,
    equipment: Vec<String>,
    ingredients: Vec<Ingredient>,
    /// 适用餐次（OBS-010，0.9.4）：breakfast/lunch/dinner/snack 的子集，可空 = 未分类。
    meal_tags: Option<Vec<String>>,
    recipe_id: Option<String>,
    copied_from_version_id: Option<String>,
    expected_version_id: Option<String>,
}

/// 餐次标签清洗：只认四个合法值，按固定顺序去重排序。
fn clean_meal_tags(raw: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    if raw.len() > 4 {
        return Err("适用餐次最多四项。".into());
    }
    let mut cleaned: Vec<String> = Vec::new();
    for tag in ["breakfast", "lunch", "dinner", "snack"] {
        if raw.iter().any(|item| item == tag) {
            cleaned.push(tag.to_owned());
        }
    }
    if cleaned.len() != raw.len() {
        return Err("适用餐次只能是早餐/午餐/晚餐/加餐。".into());
    }
    Ok(cleaned)
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
    let meal_tags = clean_meal_tags(input.meal_tags.clone())?;
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
    if let Some(source) = input.copied_from_version_id.as_deref() {
        if input.recipe_id.is_some() || !array(state, "recipes")?.iter().any(|r| r["id"] == source)
        {
            return Err("另存来源不存在，或不能同时覆盖原菜谱。".into());
        }
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
        let mut snapshot = crate::food_library::historical_portion(
            state,
            &item.food_version_id,
            item.quantity,
            &item.unit,
        )?;
        // Copy the historical identity metadata too, not today\'s activeVersionId/favorite.
        if let Some(source) = input.copied_from_version_id.as_deref() {
            if let Some(original) = array(state, "recipes")?
                .iter()
                .find(|r| r["id"] == source)
                .and_then(|r| r["ingredients"].as_array())
                .and_then(|items| {
                    items.iter().find(|i| {
                        i["foodVersionId"] == item.food_version_id
                            && i["foodSnapshot"]["definition"]["id"] == snapshot["definition"]["id"]
                    })
                })
            {
                snapshot["definition"] = original["foodSnapshot"]["definition"].clone();
            }
        }
        let definition = &snapshot["definition"];
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
        ingredients.push(json!({"foodId":definition["id"],"name":definition["name"],"measurementBasis":if basis=="packaged"{"package"}else{basis},"foodVersionId":item.food_version_id,"nutritionQuantity":item.quantity,"nutritionUnit":item.unit,"foodSnapshot":snapshot}));
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
    let mut recipe = json!({"id":id,"recipeId":recipe_id,"name":input.name.trim(),"version":number,"ingredients":ingredients,"nutrition":nutrition,"totalMinutes":input.total_minutes,"equipment":input.equipment,"source":"personal","confirmedBy":state["profile"]["name"],"confirmedAt":now,"createdAt":now});
    if !meal_tags.is_empty() {
        recipe["mealTags"] = json!(meal_tags);
    }
    if let Some(source) = input.copied_from_version_id {
        recipe["copiedFromVersionId"] = json!(source);
    }
    array_mut(state, "recipes")?.push(recipe.clone());
    array_mut(state,"auditEvents")?.push(json!({"id":format!("{command_id}:audit"),"eventType":"save_recipe_version","entityType":"recipe","entityId":id,"createdAt":now,"payload":{"commandId":command_id,"previousVersionId":input.expected_version_id,"recipe":recipe}}));
    Ok(CommandMutation {
        applied: true,
        result: json!({"recipeVersionId":id,"recipeId":recipe_id}),
    })
}
