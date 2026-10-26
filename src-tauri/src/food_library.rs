use crate::domain_commands::{array, array_mut, now_and_date, payload_str, CommandMutation};
use crate::domain_store::{import_legacy_state, load_envelope, open_database, STORAGE_NAME};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use tauri::AppHandle;

const NUTRIENTS: [&str; 7] = [
    "calories",
    "protein",
    "carbohydrates",
    "fat",
    "fiber",
    "sugar",
    "sodium",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum FoodUnit {
    G,
    Ml,
    Piece,
    Serving,
    Package,
}

impl FoodUnit {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::G => "克",
            Self::Ml => "毫升",
            Self::Piece => "个",
            Self::Serving => "份",
            Self::Package => "包装",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Basis {
    quantity: f64,
    unit: FoodUnit,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Conversion {
    unit: FoodUnit,
    quantity: f64,
    basis_quantity: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FoodInput {
    name: String,
    brand: Option<String>,
    measurement_basis: String,
    basis: Basis,
    energy_unit: String,
    nutrients: BTreeMap<String, Option<f64>>,
    conversions: Vec<Conversion>,
    source: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Definition {
    id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    brand: Option<String>,
    measurement_basis: String,
    active_version_id: String,
    favorite: bool,
    /// 归档：从日常挑选入口隐藏，历史记录与菜谱快照不受影响。
    /// 旧数据缺省 false；0.9.0 读取时忽略该字段、回写时原样保留。
    #[serde(default)]
    archived: bool,
    created_at: String,
    /// 内置目录来源标记（0.11.0）。必须显式声明：`search_state` 会把定义反序列化成本结构
    /// 再序列化返回，未声明的字段会被静默丢弃，前端就判不出「内置」、分组也失效。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    catalog_id: Option<String>,
    /// 内置目录分类（主食谷物/蛋奶/…），同样必须显式保留。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    category: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Version {
    id: String,
    food_id: String,
    version: u32,
    basis: Basis,
    energy_unit: String,
    label_nutrients: BTreeMap<String, f64>,
    conversions: Vec<Conversion>,
    nutrition: Value,
    source: String,
    confirmed_by: String,
    confirmed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    origin: Option<Value>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortionRequest {
    pub(crate) food_version_id: String,
    pub(crate) quantity: f64,
    pub(crate) unit: FoodUnit,
}

fn positive(value: f64) -> Result<f64, String> {
    if !value.is_finite() || value <= 0.0 {
        return Err("数量与换算规格必须是大于 0 的有限数值。".into());
    }
    Ok(value)
}

fn parse_input(payload: &Value) -> Result<(FoodInput, Value, BTreeMap<String, f64>), String> {
    let input: FoodInput =
        serde_json::from_value(payload.get("input").cloned().ok_or("缺少食材资料。")?)
            .map_err(|error| format!("食材资料格式无效：{error}"))?;
    if input.name.trim().is_empty()
        || input.name.chars().count() > 120
        || input
            .brand
            .as_ref()
            .is_some_and(|brand| brand.chars().count() > 120)
    {
        return Err("食物名称不能为空，名称和品牌最多 120 个字符。".into());
    }
    if !["raw", "cooked", "packaged", "edible"].contains(&input.measurement_basis.as_str()) {
        return Err("生熟或可食状态无效。".into());
    }
    if !["kcal", "kJ"].contains(&input.energy_unit.as_str()) {
        return Err("能量单位必须明确选择千卡或千焦。".into());
    }
    if !["manual", "label", "personal", "official", "fatsecret"].contains(&input.source.as_str()) {
        return Err("本版只接受人工确认的数据来源。".into());
    }
    positive(input.basis.quantity)?;
    if input.conversions.len() > 4 {
        return Err("换算规格最多四种。".into());
    }
    let mut seen = BTreeSet::new();
    for conversion in &input.conversions {
        positive(conversion.quantity)?;
        positive(conversion.basis_quantity)?;
        if conversion.unit == input.basis.unit || !seen.insert(conversion.unit) {
            return Err("换算单位不能与参考单位相同，也不能重复。".into());
        }
    }
    let mut nutrition = Map::new();
    let mut original = BTreeMap::new();
    for (key, value) in &input.nutrients {
        if !NUTRIENTS.contains(&key.as_str()) {
            return Err(format!("未知营养项目：{key}"));
        }
        if let Some(value) = value {
            if !value.is_finite() || *value < 0.0 {
                return Err("营养值必须是非负有限数值。".into());
            }
            original.insert(key.clone(), *value);
        }
    }
    for key in NUTRIENTS {
        let unit = match key {
            "calories" => "kcal",
            "sodium" => "mg",
            _ => "g",
        };
        let metric = if let Some(raw) = original.get(key) {
            let value = if key == "calories" && input.energy_unit == "kJ" {
                raw / 4.184
            } else {
                *raw
            };
            json!({"state":if value==0.0{"zero"}else{"known"},"value":value,"unit":unit,"source":input.source,"confidence":"high"})
        } else {
            json!({"state":"unknown","unit":unit,"source":input.source,"confidence":"low"})
        };
        nutrition.insert(key.into(), metric);
    }
    Ok((input, Value::Object(nutrition), original))
}

fn portion(version: &Version, quantity: f64, unit: FoodUnit) -> Result<Value, String> {
    positive(quantity)?;
    let basis_quantity = if unit == version.basis.unit {
        quantity
    } else {
        let conversion = version
            .conversions
            .iter()
            .find(|conversion| conversion.unit == unit)
            .ok_or("没有这个单位的换算关系，请补充并确认规格后再记录。")?;
        quantity / conversion.quantity * conversion.basis_quantity
    };
    positive(basis_quantity)?;
    let factor = positive(basis_quantity / version.basis.quantity)?;
    let mut nutrition = version.nutrition.clone();
    for key in NUTRIENTS {
        let metric = nutrition.get_mut(key).ok_or("食材版本缺少营养项目。")?;
        if metric["state"] != "unknown" {
            let value = metric["value"].as_f64().ok_or("营养版本缺少数值。")? * factor;
            if !value.is_finite() {
                return Err("换算结果过大，请核对输入单位和数量。".into());
            }
            metric["value"] = json!(value);
        }
    }
    Ok(json!({"nutrition":nutrition,"factor":factor,"basisQuantity":basis_quantity}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FoodIdentityInput {
    name: String,
    brand: Option<String>,
    measurement_basis: String,
}

/// 全量引用扫描：餐食（含作废/被更正条目）+ 菜谱（全部版本）。
/// 「当前日记看不到」不等于没有引用——作废条目和旧菜谱版本都带引用。
fn food_references(state: &Map<String, Value>, food_id: &str) -> Result<Vec<String>, String> {
    let version_ids: BTreeSet<String> = array(state, "foodDefinitionVersions")?
        .iter()
        .filter(|version| version["foodId"].as_str() == Some(food_id))
        .filter_map(|version| version["id"].as_str().map(str::to_owned))
        .collect();
    let mut references = Vec::new();
    for meal in array(state, "meals")? {
        let hit = meal["foodDefinitionId"].as_str() == Some(food_id)
            || meal["foodSnapshot"]["definition"]["id"].as_str() == Some(food_id)
            || meal["foodVersionId"]
                .as_str()
                .is_some_and(|id| version_ids.contains(id));
        if hit {
            references.push(format!(
                "餐食 {} {}",
                meal["date"].as_str().unwrap_or("未知日期"),
                meal["name"].as_str().unwrap_or("未命名")
            ));
        }
    }
    for recipe in array(state, "recipes")? {
        let name = recipe["name"].as_str().unwrap_or("未命名菜谱");
        let number = recipe["version"].as_u64().unwrap_or(0);
        let hit = recipe["ingredients"]
            .as_array()
            .ok_or("菜谱原料缺失。")?
            .iter()
            .any(|ingredient| {
                ingredient["foodId"].as_str() == Some(food_id)
                    || ingredient["foodSnapshot"]["definition"]["id"].as_str() == Some(food_id)
                    || ingredient["foodVersionId"]
                        .as_str()
                        .is_some_and(|id| version_ids.contains(id))
            });
        if hit {
            references.push(format!("菜谱 {name} v{number}"));
        }
    }
    Ok(references)
}

fn selected(state: &Map<String, Value>, version_id: &str) -> Result<(Definition, Version), String> {
    let raw = array(state, "foodDefinitionVersions")?
        .iter()
        .find(|version| version["id"] == version_id)
        .ok_or("找不到营养规格版本。")?;
    let version: Version =
        serde_json::from_value(raw.clone()).map_err(|error| error.to_string())?;
    let raw = array(state, "foodDefinitions")?
        .iter()
        .find(|food| food["id"] == version.food_id)
        .ok_or("找不到食材资料。")?;
    let definition: Definition =
        serde_json::from_value(raw.clone()).map_err(|error| error.to_string())?;
    if definition.active_version_id != version_id {
        return Err("此食物的营养规格已更新，请重新选择食物并核对数量。".into());
    }
    Ok((definition, version))
}

pub(crate) fn historical_portion(
    state: &Map<String, Value>,
    version_id: &str,
    quantity: f64,
    unit: &str,
) -> Result<Value, String> {
    let raw = array(state, "foodDefinitionVersions")?
        .iter()
        .find(|v| v["id"] == version_id)
        .ok_or("找不到营养版本。")?;
    let version: Version = serde_json::from_value(raw.clone()).map_err(|e| e.to_string())?;
    let definition = array(state, "foodDefinitions")?
        .iter()
        .find(|d| d["id"] == version.food_id)
        .ok_or("找不到食物身份。")?;
    let unit: FoodUnit = serde_json::from_value(json!(unit)).map_err(|_| "计量单位无效。")?;
    let preview = portion(&version, quantity, unit)?;
    Ok(
        json!({"definition":definition,"version":version,"quantity":quantity,"unit":unit,"factor":preview["factor"],"basisQuantity":preview["basisQuantity"],"nutrition":preview["nutrition"]}),
    )
}

pub(crate) fn apply(
    state: &mut Map<String, Value>,
    kind: &str,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let (now, today) = now_and_date();
    let result = match kind {
        "save_food_definition" | "revise_food_definition" => {
            let (input, nutrition, original) = parse_input(payload)?;
            let version_id = format!("food-version-{command_id}");
            let (food_id, number) = if kind == "revise_food_definition" {
                let food_id = payload_str(payload, "foodId")?.to_owned();
                let expected = payload_str(payload, "expectedVersionId")?;
                let (definition, version) = selected(state, expected)?;
                if definition.id != food_id
                    || definition.name != input.name.trim()
                    || definition.brand.as_deref().unwrap_or("")
                        != input.brand.as_deref().unwrap_or("").trim()
                    || definition.measurement_basis != input.measurement_basis
                {
                    return Err(
                        "修订只能更新营养和规格；更换名称、品牌或生熟状态请新建食物。".into(),
                    );
                }
                (
                    food_id,
                    version.version.checked_add(1).ok_or("版本号溢出。")?,
                )
            } else {
                (format!("food-{command_id}"), 1)
            };
            let version = Version {
                id: version_id.clone(),
                food_id: food_id.clone(),
                version: number,
                basis: input.basis,
                energy_unit: input.energy_unit,
                label_nutrients: original,
                conversions: input.conversions,
                nutrition,
                source: input.source,
                confirmed_by: state["profile"]["name"]
                    .as_str()
                    .unwrap_or("本地用户")
                    .into(),
                confirmed_at: now.clone(),
                origin: None,
            };
            // Reject unusable derived references before committing a version: otherwise
            // an extreme conversion could make the entire library search fail later.
            for unit in [FoodUnit::G, FoodUnit::Ml] {
                if unit == version.basis.unit
                    || version.conversions.iter().any(|item| item.unit == unit)
                {
                    portion(&version, 100.0, unit)?;
                }
            }
            if kind == "save_food_definition" {
                let definition = Definition {
                    id: food_id.clone(),
                    name: input.name.trim().into(),
                    brand: input
                        .brand
                        .map(|brand| brand.trim().to_owned())
                        .filter(|brand| !brand.is_empty()),
                    measurement_basis: input.measurement_basis,
                    active_version_id: version_id.clone(),
                    favorite: false,
                    archived: false,
                    created_at: now.clone(),
                    // 新建/副本一律不带目录标记（内置食材被修改 = 生成个人副本）。
                    catalog_id: None,
                    category: None,
                };
                array_mut(state, "foodDefinitions")?
                    .push(serde_json::to_value(definition).map_err(|error| error.to_string())?);
            } else {
                let definition = array_mut(state, "foodDefinitions")?
                    .iter_mut()
                    .find(|food| food["id"] == food_id)
                    .ok_or("食材不存在。")?;
                definition["activeVersionId"] = json!(version_id);
            }
            array_mut(state, "foodDefinitionVersions")?
                .push(serde_json::to_value(version).map_err(|error| error.to_string())?);
            json!({"foodId":food_id,"foodVersionId":version_id})
        }
        "set_food_favorite" => {
            let food_id = payload_str(payload, "foodId")?;
            let favorite = payload
                .get("favorite")
                .and_then(Value::as_bool)
                .ok_or("必须指定收藏状态。")?;
            let definition = array_mut(state, "foodDefinitions")?
                .iter_mut()
                .find(|food| food["id"] == food_id)
                .ok_or("找不到食物。")?;
            definition["favorite"] = json!(favorite);
            json!({})
        }
        "set_food_archived" => {
            let food_id = payload_str(payload, "foodId")?;
            let archived = payload
                .get("archived")
                .and_then(Value::as_bool)
                .ok_or("必须指定归档状态。")?;
            let definition = array_mut(state, "foodDefinitions")?
                .iter_mut()
                .find(|food| food["id"] == food_id)
                .ok_or("找不到食物。")?;
            // 只翻归档开关：不动营养版本、收藏与任何历史记录（同 set_food_favorite 模式）。
            definition["archived"] = json!(archived);
            json!({"foodId": food_id, "archived": archived})
        }
        "delete_food" => {
            let food_id = payload_str(payload, "foodId")?;
            let definition = array(state, "foodDefinitions")?
                .iter()
                .find(|food| food["id"] == food_id)
                .ok_or("找不到食物。")?
                .clone();
            let references = food_references(state, food_id)?;
            if !references.is_empty() {
                return Err(format!(
                    "该食物仍被 {} 处记录引用（如 {}），不能永久删除；可改用归档，从日常挑选中隐藏但保留历史。",
                    references.len(),
                    references[0]
                ));
            }
            let versions: Vec<Value> = array(state, "foodDefinitionVersions")?
                .iter()
                .filter(|version| version["foodId"].as_str() == Some(food_id))
                .cloned()
                .collect();
            if versions.is_empty() {
                return Err("食材缺少营养版本，数据异常，已终止删除。".into());
            }
            // 同一事务内完成删除与级联；被删完整内容放进 result，经审计与导出可手工恢复。
            array_mut(state, "foodDefinitions")?.retain(|food| food["id"] != food_id);
            array_mut(state, "foodDefinitionVersions")?
                .retain(|version| version["foodId"].as_str() != Some(food_id));
            // 内置目录条目删除时登记墓碑（0.11.0）：目录升级不复活已删除条目。
            if let Some(catalog_id) = definition["catalogId"].as_str() {
                crate::food_catalog::record_catalog_tombstone(state, catalog_id);
            }
            json!({
                "foodId": food_id,
                "deletedDefinition": definition,
                "deletedVersions": versions,
            })
        }
        "correct_food_identity" => {
            let food_id = payload_str(payload, "foodId")?;
            let input: FoodIdentityInput =
                serde_json::from_value(payload.get("input").cloned().ok_or("缺少食材身份资料。")?)
                    .map_err(|error| format!("食材身份资料无效：{error}"))?;
            if input.name.trim().is_empty()
                || input.name.chars().count() > 120
                || input
                    .brand
                    .as_ref()
                    .is_some_and(|brand| brand.chars().count() > 120)
            {
                return Err("食物名称不能为空，名称和品牌最多 120 个字符。".into());
            }
            let definition = array(state, "foodDefinitions")?
                .iter()
                .find(|food| food["id"] == food_id)
                .ok_or("找不到食物。")?
                .clone();
            // 生熟状态/计量基准纠错会改写历史版本的证明口径，本版不支持：
            // 与定义不一致一律引导「新建正确食材 + 归档旧项」。
            if definition["measurementBasis"].as_str() != Some(input.measurement_basis.as_str()) {
                return Err(
                    "生熟状态纠错暂不支持：请新建正确食材并归档旧项，避免改写历史版本口径。".into(),
                );
            }
            let references = food_references(state, food_id)?;
            if !references.is_empty() {
                return Err(format!(
                    "该食物仍被 {} 处记录引用（如 {}），名称/品牌纠错暂不支持；请新建正确食材并归档旧项。",
                    references.len(),
                    references[0]
                ));
            }
            let definition = array_mut(state, "foodDefinitions")?
                .iter_mut()
                .find(|food| food["id"] == food_id)
                .ok_or("找不到食物。")?;
            definition["name"] = json!(input.name.trim());
            match input
                .brand
                .map(|brand| brand.trim().to_owned())
                .filter(|brand| !brand.is_empty())
            {
                Some(brand) => definition["brand"] = json!(brand),
                None => {
                    if let Some(map) = definition.as_object_mut() {
                        map.remove("brand");
                    }
                }
            }
            json!({"foodId": food_id, "name": input.name.trim()})
        }
        "record_food_meal" => {
            let date = payload
                .get("date")
                .and_then(Value::as_str)
                .unwrap_or(&today);
            if date.len() != 10 || NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
                return Err("记餐日期无效。".into());
            }
            let meal_type = payload_str(payload, "type")?;
            if !["breakfast", "lunch", "dinner", "snack"].contains(&meal_type) {
                return Err("餐次无效。".into());
            }
            let entries: Vec<PortionRequest> =
                serde_json::from_value(payload.get("entries").cloned().ok_or("没有待记餐食物。")?)
                    .map_err(|error| format!("记餐份量无效：{error}"))?;
            if entries.is_empty() || entries.len() > 50 {
                return Err("一次可确认 1–50 项食物。".into());
            }
            let mut meals = Vec::new();
            let mut ids = Vec::new();
            for (index, entry) in entries.iter().enumerate() {
                let (definition, version) = selected(state, &entry.food_version_id)?;
                let preview = portion(&version, entry.quantity, entry.unit)?;
                let meal_id = format!("{command_id}:food-meal:{index}");
                ids.push(meal_id.clone());
                meals.push(json!({"id":meal_id,"date":date,"type":meal_type,"name":definition.name,"amountLabel":format!("{}{} · {}",entry.quantity,entry.unit.label(),definition.brand.as_deref().unwrap_or("个人食材库")),"nutrition":preview["nutrition"],"consumedRatio":1,"source":version.source,"confidence":"high","foodDefinitionId":definition.id,"foodVersionId":version.id,"foodSnapshot":{"definition":definition,"version":version,"quantity":entry.quantity,"unit":entry.unit,"factor":preview["factor"],"basisQuantity":preview["basisQuantity"]},"createdAt":now}));
            }
            array_mut(state, "meals")?.extend(meals);
            json!({"mealIds":ids})
        }
        _ => return Err("未知食材库命令。".into()),
    };
    array_mut(state,"auditEvents")?.push(json!({"id":format!("{command_id}:audit"),"eventType":kind,"entityType":"food_library","payload":{"commandId":command_id,"result":result},"createdAt":now}));
    Ok(CommandMutation {
        applied: true,
        result,
    })
}

pub(crate) fn search_state(
    state: &Map<String, Value>,
    query: &str,
    mode: &str,
) -> Result<Vec<Value>, String> {
    if !["all", "recent", "favorites", "archived"].contains(&mode) {
        return Err("食材库筛选条件无效。".into());
    }
    let query = query.trim().to_lowercase();
    let mut results = Vec::new();
    for raw in array(state, "foodDefinitions")? {
        let definition: Definition =
            serde_json::from_value(raw.clone()).map_err(|error| error.to_string())?;
        // 归档项只出现在「已归档」视图，其余模式一律隐藏。
        if definition.archived != (mode == "archived") {
            continue;
        }
        let searchable = format!(
            "{} {}",
            definition.name,
            definition.brand.as_deref().unwrap_or("")
        )
        .to_lowercase();
        if !searchable.contains(&query) || (mode == "favorites" && !definition.favorite) {
            continue;
        }
        let last_used = array(state, "meals")?
            .iter()
            .filter(|meal| meal["status"].as_str().is_none_or(|v| v == "active"))
            .filter(|meal| meal["foodDefinitionId"] == definition.id)
            .filter_map(|meal| meal["createdAt"].as_str())
            .max();
        if mode == "recent" && last_used.is_none() {
            continue;
        }
        let (_, version) = selected(state, &definition.active_version_id)?;
        let mut item = json!({"definition":definition,"version":version});
        if let Some(last_used) = last_used {
            item["lastUsedAt"] = json!(last_used);
        }
        for (key, unit) in [("per100g", FoodUnit::G), ("per100ml", FoodUnit::Ml)] {
            if unit == version.basis.unit
                || version
                    .conversions
                    .iter()
                    .any(|conversion| conversion.unit == unit)
            {
                item[key] = portion(&version, 100.0, unit)?["nutrition"].clone();
            }
        }
        results.push(item);
    }
    results.sort_by(|left, right| {
        let recent = if mode == "recent" {
            right["lastUsedAt"]
                .as_str()
                .cmp(&left["lastUsedAt"].as_str())
        } else {
            std::cmp::Ordering::Equal
        };
        recent
            .then_with(|| {
                right["definition"]["favorite"]
                    .as_bool()
                    .cmp(&left["definition"]["favorite"].as_bool())
            })
            .then_with(|| {
                left["definition"]["name"]
                    .as_str()
                    .cmp(&right["definition"]["name"].as_str())
            })
            .then_with(|| {
                left["definition"]["id"]
                    .as_str()
                    .cmp(&right["definition"]["id"].as_str())
            })
    });
    // 上限只作防御：内置目录 235 项，原来的 100 会把「全部」硬截断，
    // 用户既看不到全部条目、也发现不了少了东西。本地 IPC 传 1000 项仍很轻。
    results.truncate(1000);
    Ok(results)
}

fn read_state(app: &AppHandle) -> Result<Map<String, Value>, String> {
    let mut connection = open_database(app)?;
    if load_envelope(&connection)?.is_none() {
        import_legacy_state(&mut connection, STORAGE_NAME)?;
    }
    if let Some(raw) = load_envelope(&connection)? {
        let envelope: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        return envelope["state"]
            .as_object()
            .cloned()
            .ok_or("食材仓库格式无效。".into());
    }
    serde_json::from_value(json!({"foodDefinitions":[],"foodDefinitionVersions":[],"meals":[]}))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn search_food_library(
    app: AppHandle,
    query: String,
    mode: String,
) -> Result<Vec<Value>, String> {
    search_state(&read_state(&app)?, &query, &mode)
}

#[tauri::command]
pub fn preview_food_portion(app: AppHandle, entry: PortionRequest) -> Result<Value, String> {
    let state = read_state(&app)?;
    let (_, version) = selected(&state, &entry.food_version_id)?;
    portion(&version, entry.quantity, entry.unit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> Map<String, Value> {
        serde_json::from_value(json!({"profile":{"name":"test"},"foodDefinitions":[],"foodDefinitionVersions":[],"meals":[],"auditEvents":[]})).unwrap()
    }

    fn input(unit: &str, quantity: f64) -> Value {
        json!({"input":{"name":"燕麦","brand":"测试品牌","measurementBasis":"packaged","basis":{"unit":unit,"quantity":quantity},"energyUnit":"kcal","nutrients":{"calories":400,"protein":12,"fat":0},"conversions":[],"source":"label"}})
    }

    fn saved_version(payload: &Value) -> Version {
        let mut state = state();
        apply(&mut state, "save_food_definition", payload, "food-test-01").unwrap();
        selected(&state, "food-version-food-test-01").unwrap().1
    }

    #[test]
    fn native_units_scale_without_turning_unknown_into_zero() {
        for unit in ["g", "ml", "piece", "serving", "package"] {
            let version = saved_version(&input(unit, 100.0));
            let unit: FoodUnit = serde_json::from_value(json!(unit)).unwrap();
            let preview = portion(&version, 50.0, unit).unwrap();
            assert_eq!(preview["nutrition"]["calories"]["value"], 200.0);
            assert_eq!(preview["nutrition"]["protein"]["value"], 6.0);
            assert_eq!(preview["nutrition"]["fat"]["state"], "zero");
            assert_eq!(preview["nutrition"]["fiber"]["state"], "unknown");
            assert!(preview["nutrition"]["fiber"].get("value").is_none());
        }
    }

    #[test]
    fn explicit_conversions_work_in_both_label_directions() {
        let mut payload = input("g", 100.0);
        payload["input"]["conversions"] = json!([
            {"unit":"package","quantity":1,"basisQuantity":200},
            {"unit":"piece","quantity":1,"basisQuantity":50},
            {"unit":"serving","quantity":1,"basisQuantity":25}
        ]);
        let version = saved_version(&payload);
        assert_eq!(
            portion(&version, 0.5, FoodUnit::Package).unwrap()["nutrition"]["calories"]["value"],
            400.0
        );
        assert_eq!(
            portion(&version, 1.0, FoodUnit::Piece).unwrap()["nutrition"]["calories"]["value"],
            200.0
        );
        assert_eq!(
            portion(&version, 2.0, FoodUnit::Serving).unwrap()["nutrition"]["calories"]["value"],
            200.0
        );
        assert!(portion(&version, 50.0, FoodUnit::Ml)
            .unwrap_err()
            .contains("补充"));
        let mut payload = input("package", 1.0);
        payload["input"]["conversions"] = json!([{"unit":"g","quantity":200,"basisQuantity":1}]);
        let version = saved_version(&payload);
        assert_eq!(
            portion(&version, 50.0, FoodUnit::G).unwrap()["nutrition"]["calories"]["value"],
            100.0
        );
        assert_eq!(
            portion(&version, 100.0, FoodUnit::G).unwrap()["nutrition"]["protein"]["value"],
            6.0
        );
    }

    #[test]
    fn kilojoules_keep_the_original_label_and_convert_once() {
        let mut payload = input("ml", 100.0);
        payload["input"]["energyUnit"] = json!("kJ");
        payload["input"]["nutrients"]["calories"] = json!(836.8);
        let version = saved_version(&payload);
        assert_eq!(version.energy_unit, "kJ");
        assert_eq!(version.label_nutrients["calories"], 836.8);
        let preview = portion(&version, 50.0, FoodUnit::Ml).unwrap();
        assert!((preview["nutrition"]["calories"]["value"].as_f64().unwrap() - 100.0).abs() < 1e-9);
    }

    #[test]
    fn bad_specs_and_overflow_are_rejected() {
        let mut payload = input("g", 0.0);
        assert!(parse_input(&payload).is_err());
        payload = input("g", 100.0);
        payload["input"]["nutrients"]["protein"] = json!(-1);
        assert!(parse_input(&payload).is_err());
        payload = input("g", 100.0);
        payload["input"]["conversions"] = json!([{"unit":"g","quantity":1,"basisQuantity":50}]);
        assert!(parse_input(&payload).is_err());
        payload["input"]["conversions"] = json!([{"unit":"piece","quantity":1,"basisQuantity":50},{"unit":"piece","quantity":2,"basisQuantity":100}]);
        assert!(parse_input(&payload).is_err());
        let version = saved_version(&input("g", 1.0));
        assert!(portion(&version, f64::MAX, FoodUnit::G).is_err());
        assert!(portion(&version, 0.0, FoodUnit::G).is_err());
        assert!(portion(&version, f64::NAN, FoodUnit::G).is_err());
    }

    #[test]
    fn revision_retains_old_versions_and_existing_meal_snapshots() {
        let mut state = state();
        let payload = input("g", 100.0);
        apply(&mut state, "save_food_definition", &payload, "food-test-01").unwrap();
        assert!(state["meals"].as_array().unwrap().is_empty());
        apply(&mut state, "record_food_meal", &json!({"date":"2026-10-20","type":"lunch","entries":[{"foodVersionId":"food-version-food-test-01","quantity":50,"unit":"g"}]}), "meal-test-01").unwrap();
        let snapshot = state["meals"].clone();
        let old_version = state["foodDefinitionVersions"][0].clone();
        let mut revised = payload;
        revised["foodId"] = json!("food-food-test-01");
        revised["expectedVersionId"] = json!("food-version-food-test-01");
        revised["input"]["nutrients"]["calories"] = json!(600);
        apply(
            &mut state,
            "revise_food_definition",
            &revised,
            "revise-test-01",
        )
        .unwrap();
        assert_eq!(state["meals"], snapshot);
        assert_eq!(state["foodDefinitionVersions"][0], old_version);
        assert_eq!(state["foodDefinitionVersions"][1]["version"], 2);
        assert!(selected(&state, "food-version-food-test-01").is_err());
        assert_eq!(
            search_state(&state, "测试品牌", "all").unwrap()[0]["per100g"]["calories"]["value"],
            600.0
        );
        assert_eq!(search_state(&state, "", "recent").unwrap().len(), 1);
        assert!(search_state(&state, "", "favorites").unwrap().is_empty());
        apply(
            &mut state,
            "set_food_favorite",
            &json!({"foodId":"food-food-test-01","favorite":true}),
            "favorite-01",
        )
        .unwrap();
        assert_eq!(search_state(&state, "", "favorites").unwrap().len(), 1);
    }
}
