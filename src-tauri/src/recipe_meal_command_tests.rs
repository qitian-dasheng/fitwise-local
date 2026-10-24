// record_recipe_meal 的行为测试：复用 domain_commands 测试模块的脚手架
// （connection / request / bootstrap / food_payload / recipe_payload）。
// 由 domain_commands.rs 的 `mod tests` include! 进来。

fn saved_recipe_id(response: &crate::domain_commands::DomainCommandResponse) -> String {
    response.state["recipes"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn last_meal(response: &crate::domain_commands::DomainCommandResponse) -> &Value {
    response.state["meals"].as_array().unwrap().last().unwrap()
}

fn recipe_meal_payload(recipe_id: &str, quantity: f64) -> Value {
    json!({
        "date": now_and_date().1,
        "type": "breakfast",
        "recipeVersionId": recipe_id,
        "entries": [{"foodVersionId": "food-version-recipe-food", "quantity": quantity, "unit": "package"}],
    })
}

#[test]
fn records_a_recipe_meal_with_scaled_portions_and_provenance() {
    let mut c = connection();
    execute_with_connection(
        &mut c,
        request("recipe-food", "save_food_definition", food_payload(), Some(bootstrap())),
    )
    .unwrap();
    let saved = execute_with_connection(
        &mut c,
        request("recipe-version", "save_recipe_version", recipe_payload(2.0), None),
    )
    .unwrap();
    let recipe_id = saved_recipe_id(&saved);

    // ×1 语义 = 菜谱完整配方量（2 包装 = 400g → 1600 kcal），不代表一人份。
    let full = execute_with_connection(
        &mut c,
        request("recipe-meal-full", "record_recipe_meal", recipe_meal_payload(&recipe_id, 2.0), None),
    )
    .unwrap();
    let entry = last_meal(&full);
    assert_eq!(entry["nutrition"]["calories"]["value"], 1600.0);
    assert_eq!(entry["nutrition"]["protein"]["value"], 48.0);
    assert_eq!(entry["recipeVersionId"], recipe_id);
    assert_eq!(entry["foodVersionId"], "food-version-recipe-food");
    assert_eq!(entry["foodSnapshot"]["quantity"], 2.0);
    assert_eq!(entry["amountLabel"], "2包装 · example");
    assert_eq!(full.result["count"], 1);

    // ×0.5 = 半锅，与手录同一版本同一重量必得同一结果（AC1）。
    let half = execute_with_connection(
        &mut c,
        request("recipe-meal-half", "record_recipe_meal", recipe_meal_payload(&recipe_id, 1.0), None),
    )
    .unwrap();
    assert_eq!(last_meal(&half)["nutrition"]["calories"]["value"], 800.0);
    let manual = execute_with_connection(
        &mut c,
        request("recipe-meal-manual", "record_food_meal", json!({"date": now_and_date().1, "type": "lunch", "entries": [{"foodVersionId": "food-version-recipe-food", "quantity": 1, "unit": "package"}]}), None),
    )
    .unwrap();
    assert_eq!(last_meal(&manual)["nutrition"], last_meal(&half)["nutrition"]);
}

#[test]
fn appends_to_an_existing_meal_and_reopens_a_completed_day() {
    let mut c = connection();
    execute_with_connection(
        &mut c,
        request("recipe-food", "save_food_definition", food_payload(), Some(bootstrap())),
    )
    .unwrap();
    let saved = execute_with_connection(
        &mut c,
        request("recipe-version", "save_recipe_version", recipe_payload(1.0), None),
    )
    .unwrap();
    let recipe_id = saved_recipe_id(&saved);
    let today = now_and_date().1;
    execute_with_connection(
        &mut c,
        request("existing-meal", "record_food_meal", json!({"date": today, "type": "breakfast", "entries": [{"foodVersionId": "food-version-recipe-food", "quantity": 1, "unit": "package"}]}), None),
    )
    .unwrap();
    execute_with_connection(
        &mut c,
        request("complete-day", "set_day_complete", json!({"date": today, "complete": true}), None),
    )
    .unwrap();

    let appended = execute_with_connection(
        &mut c,
        request("recipe-append", "record_recipe_meal", recipe_meal_payload(&recipe_id, 1.0), None),
    )
    .unwrap();
    let day_meals: Vec<&Value> = appended.state["meals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["date"] == today && item["type"] == "breakfast")
        .collect();
    assert_eq!(day_meals.len(), 2);
    assert!(appended.state["checkIns"].as_array().unwrap().iter().all(|item| item["complete"] == false));
    assert!(appended.state["auditEvents"].as_array().unwrap().iter().any(|item| item["eventType"] == "diet_day_reopened"));
    assert!(appended.state["auditEvents"].as_array().unwrap().iter().any(|item| item["eventType"] == "recipe_meal_recorded"));
}

#[test]
fn pins_the_recipe_food_version_even_after_a_library_revision() {
    let mut c = connection();
    execute_with_connection(
        &mut c,
        request("recipe-food", "save_food_definition", food_payload(), Some(bootstrap())),
    )
    .unwrap();
    let saved = execute_with_connection(
        &mut c,
        request("recipe-version", "save_recipe_version", recipe_payload(1.0), None),
    )
    .unwrap();
    let recipe_id = saved_recipe_id(&saved);
    let mut revision = food_payload();
    revision["foodId"] = json!("food-recipe-food");
    revision["expectedVersionId"] = json!("food-version-recipe-food");
    revision["input"]["nutrients"]["calories"] = json!(800);
    let revised = execute_with_connection(
        &mut c,
        request("recipe-food-revision", "revise_food_definition", revision, None),
    )
    .unwrap();
    let active_id = revised.state["foodDefinitions"][0]["activeVersionId"].as_str().unwrap().to_owned();

    // 食材已修订（active 版 800/100g），菜谱仍钉住旧版本：1 包装=200g → 800 kcal。
    let recorded = execute_with_connection(
        &mut c,
        request("recipe-pinned", "record_recipe_meal", recipe_meal_payload(&recipe_id, 1.0), None),
    )
    .unwrap();
    let entry = last_meal(&recorded);
    assert_eq!(entry["nutrition"]["calories"]["value"], 800.0);
    assert_eq!(entry["foodVersionId"], "food-version-recipe-food");

    // 对照：同重量走当前 active 版本应得 1600——证明两者口径有意不同。
    let manual = execute_with_connection(
        &mut c,
        request("recipe-pinned-manual", "record_food_meal", json!({"date": now_and_date().1, "type": "lunch", "entries": [{"foodVersionId": active_id, "quantity": 1, "unit": "package"}]}), None),
    )
    .unwrap();
    assert_eq!(last_meal(&manual)["nutrition"]["calories"]["value"], 1600.0);
}

#[test]
fn rejects_foreign_entries_missing_recipes_and_future_dates() {
    let mut c = connection();
    execute_with_connection(
        &mut c,
        request("recipe-food", "save_food_definition", food_payload(), Some(bootstrap())),
    )
    .unwrap();
    let saved = execute_with_connection(
        &mut c,
        request("recipe-version", "save_recipe_version", recipe_payload(1.0), None),
    )
    .unwrap();
    let recipe_id = saved_recipe_id(&saved);
    let today = now_and_date().1;

    // 不属于该菜谱的食材版本一律拒绝，且不留下部分写入。
    let receipts_before: i64 = c.query_row("SELECT COUNT(*) FROM domain_command_receipts", [], |row| row.get(0)).unwrap();
    let meals_before = c.query_row("SELECT COUNT(*) FROM domain_entities WHERE collection = 'meals'", [], |row| row.get::<_, i64>(0)).unwrap();
    let foreign = json!({"date": today, "type": "breakfast", "recipeVersionId": recipe_id, "entries": [{"foodVersionId": "food-version-elsewhere", "quantity": 1, "unit": "g"}]});
    assert!(execute_with_connection(&mut c, request("recipe-foreign", "record_recipe_meal", foreign, None)).is_err());
    assert!(execute_with_connection(&mut c, request("recipe-missing", "record_recipe_meal", recipe_meal_payload("recipe-version-missing", 1.0), None)).is_err());
    let future = json!({"date": "2999-01-01", "type": "breakfast", "recipeVersionId": recipe_id, "entries": [{"foodVersionId": "food-version-recipe-food", "quantity": 1, "unit": "package"}]});
    assert!(execute_with_connection(&mut c, request("recipe-future", "record_recipe_meal", future, None)).is_err());
    // 失败的命令不写回执、不写餐食：拒绝必须无痕。
    assert_eq!(c.query_row("SELECT COUNT(*) FROM domain_command_receipts", [], |row| row.get::<_, i64>(0)).unwrap(), receipts_before);
    assert_eq!(c.query_row("SELECT COUNT(*) FROM domain_entities WHERE collection = 'meals'", [], |row| row.get::<_, i64>(0)).unwrap(), meals_before);
    // 空/超量条目拒绝。
    let empty = json!({"date": today, "type": "breakfast", "recipeVersionId": recipe_id, "entries": []});
    assert!(execute_with_connection(&mut c, request("recipe-empty", "record_recipe_meal", empty, None)).is_err());
    assert_eq!(c.query_row("SELECT COUNT(*) FROM domain_command_receipts", [], |row| row.get::<_, i64>(0)).unwrap(), receipts_before);
}

#[test]
fn replays_idempotently_and_allows_intentional_repeats() {
    let mut c = connection();
    execute_with_connection(
        &mut c,
        request("recipe-food", "save_food_definition", food_payload(), Some(bootstrap())),
    )
    .unwrap();
    let saved = execute_with_connection(
        &mut c,
        request("recipe-version", "save_recipe_version", recipe_payload(1.0), None),
    )
    .unwrap();
    let recipe_id = saved_recipe_id(&saved);

    // 同 commandId 同内容重放 = 回放，不重复写入。
    let first = execute_with_connection(
        &mut c,
        request("recipe-replay", "record_recipe_meal", recipe_meal_payload(&recipe_id, 1.0), None),
    )
    .unwrap();
    let replay = execute_with_connection(
        &mut c,
        request("recipe-replay", "record_recipe_meal", recipe_meal_payload(&recipe_id, 1.0), None),
    )
    .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.state["meals"], first.state["meals"]);
    // 同 commandId 不同内容 = 拒绝。
    let tampered = recipe_meal_payload(&recipe_id, 2.0);
    assert!(execute_with_connection(&mut c, request("recipe-replay", "record_recipe_meal", tampered, None)).is_err());
    // 用户主动重复加入同一菜谱 = 新 commandId，合法。
    let again = execute_with_connection(
        &mut c,
        request("recipe-again", "record_recipe_meal", recipe_meal_payload(&recipe_id, 1.0), None),
    )
    .unwrap();
    assert!(!again.replayed);
    assert_eq!(again.state["meals"].as_array().unwrap().len(), first.state["meals"].as_array().unwrap().len() + 1);
}

#[test]
fn keeps_unknown_nutrients_unknown_in_recipe_meals() {
    let mut c = connection();
    execute_with_connection(
        &mut c,
        request("recipe-food", "save_food_definition", food_payload(), Some(bootstrap())),
    )
    .unwrap();
    let saved = execute_with_connection(
        &mut c,
        request("recipe-version", "save_recipe_version", recipe_payload(1.0), None),
    )
    .unwrap();
    let recipe_id = saved_recipe_id(&saved);
    let recorded = execute_with_connection(
        &mut c,
        request("recipe-unknown", "record_recipe_meal", recipe_meal_payload(&recipe_id, 1.0), None),
    )
    .unwrap();
    let entry = last_meal(&recorded);
    assert_eq!(entry["nutrition"]["fiber"]["state"], "unknown");
    assert!(entry["nutrition"]["fiber"].get("value").is_none());
    assert_eq!(entry["nutrition"]["fat"]["state"], "zero");
    // 整锅汇总同样不得把未知提升为已知。
    assert_eq!(recorded.state["recipes"].as_array().unwrap().last().unwrap()["nutrition"]["fiber"]["state"], "unknown");
}
